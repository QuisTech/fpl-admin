import { XPOracle } from './ingestion.js';
import { solveOptimalSquad, solveOptimalTransfers } from './lp-solver.js';

export interface SquadState {
  squad: number[]; // Array of 15 player IDs
  bank: number;
  freeTransfers: number;
  chipState: Record<string, number>; // e.g. { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 }
  gameweek: number;
  accumulatedScore: number;
  activeChip?: string; // e.g. 'WC' active for this week
  firstAction?: string; // Tracks initial step 0 action (ROLL, TRANSFER, WC, etc.)
  preFhSquad?: number[];
  preFhBank?: number;
  firstTransfersIn?: number[];
  firstTransfersOut?: number[];
}

export interface Action {
  type: 'ROLL' | 'TRANSFER' | 'CHIP';
  transfersIn?: number[];
  transfersOut?: number[];
  chipName?: string;
  hitCost: number;
}

export class Simulator {
  private beamWidth: number;
  private maxDepth: number;

  constructor(isVercel: boolean = false) {
    if (isVercel) {
      this.beamWidth = 50;
      this.maxDepth = 8;
    } else {
      this.beamWidth = 500;
      this.maxDepth = 8;
    }
  }

  public simulateMatchday(state: SquadState, gw: number, oracle: XPOracle): { score: number; variance: number } {
    const playerProjections = state.squad.map(id => ({
      id,
      xp: oracle.getXP(id, gw),
      variance: oracle.getVariance?.(id, gw) ?? (oracle.getXP(id, gw) * 1.5),
      pos: oracle.getPosition(id)
    }));

    playerProjections.sort((a, b) => b.xp - a.xp);

    let gwScore = 0;
    let gwVariance = 0;
    if (playerProjections.length > 0) {
      // Triple Captain Chip Check
      if (state.activeChip === 'TC') {
        gwScore += playerProjections[0].xp * 3;
        gwVariance += playerProjections[0].variance * 9; // 3^2 = 9
      } else {
        gwScore += playerProjections[0].xp * 2;
        gwVariance += playerProjections[0].variance * 4; // 2^2 = 4
      }
    }

    // Bench Boost check: Add all 15 players
    const startersCount = state.activeChip === 'BB' ? 15 : 11;
    for (let i = 1; i < Math.min(startersCount, playerProjections.length); i++) {
      gwScore += playerProjections[i].xp;
      gwVariance += playerProjections[i].variance;
    }

    return { score: gwScore, variance: gwVariance };
  }

  public calculateFitness(state: SquadState): number {
    return state.accumulatedScore;
  }

  public generateValidActions(
    state: SquadState, 
    oracle: XPOracle, 
    gw: number, 
    allowLpTransfers: boolean = true,
    step: number = 0,
    riskMode: string = 'safe'
  ): Action[] {
    const actions: Action[] = [];
    
    // 1. Always consider rolling (doing nothing)
    actions.push({ type: 'ROLL', hitCost: 0 });

    // 2. Consider Chips (only at step 0 to prevent combinatoric explosion/LP solver timeouts)
    if (step === 0) {
      if (state.chipState['WC'] > 0) {
        actions.push({ type: 'CHIP', chipName: 'WC', hitCost: 0 });
      }
      if (state.chipState['FH'] > 0) {
        actions.push({ type: 'CHIP', chipName: 'FH', hitCost: 0 });
      }
      if (state.chipState['BB'] > 0) {
        actions.push({ type: 'CHIP', chipName: 'BB', hitCost: 0 });
      }
      if (state.chipState['TC'] > 0) {
        actions.push({ type: 'CHIP', chipName: 'TC', hitCost: 0 });
      }
    }
    
    // 3. Generate valid single transfers (1-for-1 swaps)
    const squadSet = new Set(state.squad);
    const horizon = this.maxDepth;
    const candidateIds = this.getFilteredCandidates(oracle, gw, horizon);
    const potentialSwaps: { outId: number; inId: number; diff: number }[] = [];

    // Precompute candidate scores over the horizon to avoid redundant calculations inside the nested loop
    const candidateXPs: Record<number, number> = {};
    candidateIds.forEach(inId => {
      let inXP = 0;
      for (let i = 0; i < horizon; i++) {
        inXP += oracle.getXP(inId, gw + i);
      }
      if (riskMode !== 'value') {
        const inCost = oracle.getCost(inId);
        const costInMillions = inCost / 10;
        if (costInMillions >= 10.0) inXP *= 1.15;
        else if (costInMillions >= 8.0) inXP *= 1.08;

        const eo = oracle.getTop1kEO?.(inId) ?? 0;
        if (riskMode === 'safe') inXP *= (1 + 0.15 * (eo / 100));
        else if (riskMode === 'aggressive') inXP *= (1 + 0.25 * (1 - eo / 100));
      }
      candidateXPs[inId] = inXP;
    });

    state.squad.forEach(outId => {
      const outPos = oracle.getPosition(outId);
      const outCost = oracle.getCost(outId);
      
      // Sum expected points over the lookahead horizon
      let outXP = 0;
      for (let i = 0; i < horizon; i++) {
        outXP += oracle.getXP(outId, gw + i);
      }
      if (riskMode !== 'value') {
        const costInMillions = outCost / 10;
        if (costInMillions >= 10.0) outXP *= 1.15;
        else if (costInMillions >= 8.0) outXP *= 1.08;

        const eo = oracle.getTop1kEO?.(outId) ?? 0;
        if (riskMode === 'safe') outXP *= (1 + 0.15 * (eo / 100));
        else if (riskMode === 'aggressive') outXP *= (1 + 0.25 * (1 - eo / 100));
      }

      candidateIds.forEach(inId => {
        if (squadSet.has(inId)) return;
        if (oracle.getPosition(inId) !== outPos) return;

        const inCost = oracle.getCost(inId);
        if (inCost > outCost + state.bank) return;

        const inXP = candidateXPs[inId];
        
        // Normalize difference to a per-gameweek average
        const totalDiff = inXP - outXP;
        const diff = totalDiff / horizon;
        
        if (diff > 0.2) { // Only consider meaningful expected points improvements
          potentialSwaps.push({ outId, inId, diff });
        }
      });
    });

    // Sort by expected points improvement and take top 5
    potentialSwaps.sort((a, b) => b.diff - a.diff);
    const topSwaps = potentialSwaps.slice(0, 5);

    topSwaps.forEach(swap => {
      actions.push({
        type: 'TRANSFER',
        transfersIn: [swap.inId],
        transfersOut: [swap.outId],
        hitCost: state.freeTransfers > 0 ? 0 : 4
      });
    });

    // 4. Generate LP-optimized multi-transfer packages (K = 1, 2, 3 transfers)
    if (allowLpTransfers) {
      for (let k = 1; k <= 3; k++) {
        const lpResult = solveOptimalTransfers(oracle, gw, state.squad, state.bank, k, horizon, riskMode);
        if (lpResult && lpResult.transfersIn.length > 0) {
          const transfersCount = lpResult.transfersIn.length;
          const hitCost = Math.max(0, transfersCount - state.freeTransfers) * 4;
          
          // Add to actions if not a duplicate of an existing action
          const isDuplicate = actions.some(a => 
            a.type === 'TRANSFER' && 
            a.transfersIn && 
            a.transfersIn.length === transfersCount &&
            a.transfersIn.every(id => lpResult.transfersIn.includes(id)) &&
            a.transfersOut &&
            a.transfersOut.every(id => lpResult.transfersOut.includes(id))
          );

          if (!isDuplicate) {
            actions.push({
              type: 'TRANSFER',
              transfersIn: lpResult.transfersIn,
              transfersOut: lpResult.transfersOut,
              hitCost
            });
          }
        }
      }
    }

    return actions;
  }

  public simulateHorizon(initialState: SquadState, oracle: XPOracle, riskMode: string = 'safe'): SquadState[] {
    let currentBeam = [initialState];

    // Determine risk-aversion lambda based on riskMode
    let lambda = 0.05; // default balanced
    if (riskMode === 'safe') {
      lambda = 0.15;
    } else if (riskMode === 'aggressive') {
      lambda = 0.02;
    }

    for (let step = 0; step < this.maxDepth; step++) {
      const gw = initialState.gameweek + step;
      let nextBeam: SquadState[] = [];

      for (const state of currentBeam) {
        // Reset active chip from previous week
        let currentState = { ...state, activeChip: undefined };
        
        // Revert Free Hit squad and bank, and set freeTransfers to 1
        if (state.activeChip === 'FH' && state.preFhSquad) {
          currentState.squad = state.preFhSquad;
          currentState.bank = state.preFhBank ?? state.bank;
          currentState.preFhSquad = undefined;
          currentState.preFhBank = undefined;
          currentState.freeTransfers = 1;
        }

        const actions = this.generateValidActions(currentState, oracle, gw, step === 0, step, riskMode);
        
        for (const action of actions) {
          const nextState: SquadState = {
            ...currentState,
            squad: [...currentState.squad],
            chipState: { ...currentState.chipState },
            gameweek: gw + 1,
            accumulatedScore: currentState.accumulatedScore
          };

          // Track first action of trajectory
          if (step === 0) {
            nextState.firstAction = action.type === 'CHIP' ? action.chipName : action.type;
            nextState.firstTransfersIn = action.transfersIn;
            nextState.firstTransfersOut = action.transfersOut;
          } else {
            nextState.firstAction = currentState.firstAction;
            nextState.firstTransfersIn = currentState.firstTransfersIn;
            nextState.firstTransfersOut = currentState.firstTransfersOut;
          }

          if (action.type === 'CHIP' && action.chipName) {
            nextState.activeChip = action.chipName;
            nextState.chipState[action.chipName] -= 1;
            
            if (action.chipName === 'WC') {
              // Execute the LP Solver to completely rebuild the squad
              let squadValue = 0;
              nextState.squad.forEach(id => squadValue += oracle.getCost(id));
              const availableBudget = squadValue + nextState.bank;
              
              // Wildcard squad should optimize over the full lookahead depth
              nextState.squad = solveOptimalSquad(oracle, gw, availableBudget, this.maxDepth, riskMode);
              nextState.freeTransfers = 1; // Wildcard resets FTs
            } else if (action.chipName === 'FH') {
              // Save the pre-Free Hit squad and bank value
              nextState.preFhSquad = currentState.squad;
              nextState.preFhBank = currentState.bank;
              
              // Rebuild the temporary squad using LP solver (Free Hit is a single-GW chip: horizon = 1)
              let squadValue = 0;
              nextState.squad.forEach(id => squadValue += oracle.getCost(id));
              const availableBudget = squadValue + nextState.bank;
              
              nextState.squad = solveOptimalSquad(oracle, gw, availableBudget, 1, riskMode);
            }
          }

          if (action.type === 'TRANSFER' && action.transfersIn && action.transfersOut) {
            // Apply player swap (multi-transfers: remove all out, push all in)
            const outSet = new Set(action.transfersOut);
            nextState.squad = nextState.squad.filter(id => !outSet.has(id));
            nextState.squad.push(...action.transfersIn);
            
            // Update bank
            const costOut = action.transfersOut.reduce((sum, id) => sum + oracle.getCost(id), 0);
            const costIn = action.transfersIn.reduce((sum, id) => sum + oracle.getCost(id), 0);
            nextState.bank = nextState.bank + costOut - costIn;
          }

          // Calculate next week's free transfers
          const usedFTs = (action.type === 'TRANSFER' && action.transfersIn) ? action.transfersIn.length : 0;
          const remainingFTs = Math.max(0, currentState.freeTransfers - usedFTs);
          nextState.freeTransfers = Math.min(5, remainingFTs + 1);

          // Simulate Matchday (Expected Value + Analytical Variance)
          const { score: gwPoints, variance: gwVariance } = this.simulateMatchday(nextState, gw, oracle);
          
          // Risk-adjusted Expected Utility: Score - (lambda * Variance)
          const gwUtility = gwPoints - (lambda * gwVariance) - action.hitCost;
          nextState.accumulatedScore += gwUtility;

          nextBeam.push(nextState);
        }
      }

      nextBeam.sort((a, b) => this.calculateFitness(b) - this.calculateFitness(a));
      currentBeam = nextBeam.slice(0, this.beamWidth);
    }

    return currentBeam;
  }

  private getFilteredCandidates(oracle: XPOracle, gw: number, horizon: number): number[] {
    const allIds = oracle.getAllPlayerIds();
    const scoredCandidates = allIds.map(id => {
      let totalXP = 0;
      for (let i = 0; i < horizon; i++) {
        totalXP += oracle.getXP(id, gw + i);
      }
      return { id, xp: totalXP, pos: oracle.getPosition(id) };
    });

    const gkps = scoredCandidates.filter(p => p.pos === 'GKP').sort((a, b) => b.xp - a.xp).slice(0, 10).map(p => p.id);
    const defs = scoredCandidates.filter(p => p.pos === 'DEF').sort((a, b) => b.xp - a.xp).slice(0, 20).map(p => p.id);
    const mids = scoredCandidates.filter(p => p.pos === 'MID').sort((a, b) => b.xp - a.xp).slice(0, 25).map(p => p.id);
    const fwds = scoredCandidates.filter(p => p.pos === 'FWD').sort((a, b) => b.xp - a.xp).slice(0, 15).map(p => p.id);

    return [...gkps, ...defs, ...mids, ...fwds];
  }
}
