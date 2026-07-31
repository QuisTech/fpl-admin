import { loadWeights } from './weights-loader.js';
const DEFAULT_PARAMETERS = loadWeights('baseline');
import { XPOracle } from './ingestion.js';
import { solveOptimalSquad, solveStartingXI, solveCaptain, solveOptimalTransfers } from './lp-solver.js';
import { calculateUtility } from './utility.js';
import { UtilityParameters, } from './projection.js';

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
  purchasePrices: Record<number, number>; // Maps player ID to purchase price
}

export function getSellingPrice(currentPrice: number, purchasePrice: number): number {
  if (currentPrice > purchasePrice) {
    return purchasePrice + Math.floor((currentPrice - purchasePrice) / 2);
  }
  return currentPrice;
}

export function applyAction(
  currentState: SquadState, 
  action: Action, 
  oracle: XPOracle, 
  gw: number, 
  params: UtilityParameters
): SquadState {
  // Deep clone the state to avoid reference mutations
  const nextState: SquadState = {
    ...currentState,
    squad: [...currentState.squad],
    chipState: { ...currentState.chipState },
    purchasePrices: { ...currentState.purchasePrices },
    gameweek: gw + 1,
    accumulatedScore: currentState.accumulatedScore,
    activeChip: undefined
  };

  if (currentState.activeChip === 'FH' && currentState.preFhSquad) {
    nextState.squad = [...currentState.preFhSquad];
    nextState.bank = currentState.preFhBank ?? currentState.bank;
    nextState.preFhSquad = undefined;
    nextState.preFhBank = undefined;
    nextState.freeTransfers = 1;
  }

  if (action.type === 'CHIP' && action.chipName) {
    nextState.activeChip = action.chipName;
    nextState.chipState[action.chipName] -= 1;
    
    if (action.chipName === 'WC') {
      let squadSellValue = 0;
      nextState.squad.forEach(id => {
        squadSellValue += getSellingPrice(oracle.getCost(id), nextState.purchasePrices[id] || oracle.getCost(id));
      });
      const availableBudget = squadSellValue + nextState.bank;
      nextState.squad = solveOptimalSquad(oracle, gw, availableBudget, 8, params);
      nextState.freeTransfers = 1; 
      
      // Update bank and purchase prices for new squad
      let newSquadCost = 0;
      nextState.squad.forEach(id => {
        const cost = oracle.getCost(id);
        newSquadCost += cost;
        nextState.purchasePrices[id] = cost;
      });
      nextState.bank = availableBudget - newSquadCost;
      
    } else if (action.chipName === 'FH') {
      nextState.preFhSquad = [...currentState.squad];
      nextState.preFhBank = currentState.bank;
      
      let squadSellValue = 0;
      nextState.squad.forEach(id => {
        squadSellValue += getSellingPrice(oracle.getCost(id), nextState.purchasePrices[id] || oracle.getCost(id));
      });
      const availableBudget = squadSellValue + nextState.bank;
      
      nextState.squad = solveOptimalSquad(oracle, gw, availableBudget, 1, params);
      let newSquadCost = 0;
      nextState.squad.forEach(id => {
        newSquadCost += oracle.getCost(id);
      });
      nextState.bank = availableBudget - newSquadCost;
    }
  }

  if (action.type === 'TRANSFER' && action.transfersIn && action.transfersOut) {
    const outSet = new Set(action.transfersOut);
    nextState.squad = nextState.squad.filter(id => !outSet.has(id));
    nextState.squad.push(...action.transfersIn);
    
    let moneyGained = 0;
    action.transfersOut.forEach(id => {
      moneyGained += getSellingPrice(oracle.getCost(id), nextState.purchasePrices[id] || oracle.getCost(id));
      delete nextState.purchasePrices[id];
    });

    let moneySpent = 0;
    action.transfersIn.forEach(id => {
      const cost = oracle.getCost(id);
      moneySpent += cost;
      nextState.purchasePrices[id] = cost;
    });

    nextState.bank = nextState.bank + moneyGained - moneySpent;
  }

  const usedFTs = (action.type === 'TRANSFER' && action.transfersIn) ? action.transfersIn.length : 0;
  const remainingFTs = Math.max(0, currentState.freeTransfers - usedFTs);
  nextState.freeTransfers = Math.min(5, remainingFTs + 1);

  // Invariants
  if (nextState.squad.length !== 15) throw new Error(`Invalid squad size: ${nextState.squad.length}`);
  if (nextState.bank < 0) throw new Error(`Budget constraint violated: Bank=${nextState.bank}`);
  
  return nextState;
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

  public simulateMatchday(state: SquadState, gw: number, oracle: XPOracle, params: UtilityParameters = DEFAULT_PARAMETERS): { score: number; variance: number; xiXP: number; benchXP: number; capXP: number } {
    let startersCount = state.activeChip === 'BB' ? 15 : 11;
    let xiIds = state.squad;
    
    if (startersCount === 11) {
      xiIds = solveStartingXI(oracle, gw, state.squad, params);
    }
    
    const { captain, viceCaptain } = solveCaptain(oracle, gw, xiIds, params);

    let gwScore = 0;
    let gwVariance = 0;
    let xiXP = 0;
    let benchXP = 0;
    let capXP = 0;
    
    const xiSet = new Set(xiIds);

    state.squad.forEach(id => {
      const xp = oracle.getXP(id, gw);
      const variance = oracle.getVariance?.(id, gw) ?? (xp * 1.5);
      
      if (xiSet.has(id)) {
        let multiplier = 1;
        if (id === captain) {
          multiplier = state.activeChip === 'TC' ? 3 : 2;
          capXP = xp * (multiplier - 1); // Extra points gained from captaincy
        }
        gwScore += xp * multiplier;
        gwVariance += variance * (multiplier * multiplier);
        xiXP += xp;
      } else {
        benchXP += xp;
      }
    });

    return { score: gwScore, variance: gwVariance, xiXP, benchXP, capXP };
  }

  private getChipResidual(chip: string, gw: number): number {
    const remaining = Math.max(0, 38 - gw);
    // Linear decay of chip value based on remaining opportunity horizon
    if (chip === 'WC') return 25.0 * (remaining / 38);
    if (chip === 'FH') return 18.0 * (remaining / 38);
    if (chip === 'BB') return 14.0 * (remaining / 38);
    if (chip === 'TC') return 10.0 * (remaining / 38);
    return 0;
  }

  public calculateFitness(state: SquadState, oracle: XPOracle, params: UtilityParameters = DEFAULT_PARAMETERS): number {
    let fitness = state.accumulatedScore;
    
    // Learned Chip Residuals
    fitness += (state.chipState['WC'] || 0) * this.getChipResidual('WC', state.gameweek);
    fitness += (state.chipState['FH'] || 0) * this.getChipResidual('FH', state.gameweek);
    fitness += (state.chipState['BB'] || 0) * this.getChipResidual('BB', state.gameweek);
    fitness += (state.chipState['TC'] || 0) * this.getChipResidual('TC', state.gameweek);
    
    // Residual Bank Value (Bank money is worth ~0.2 points per million per remaining GW)
    const remainingGws = Math.max(0, 38 - state.gameweek);
    fitness += (state.bank / 10) * 0.2 * remainingGws;

    // Terminal squad value evaluated via true Expected GW score (XI + Captain) over a residual horizon (e.g. next 4 GWs)
    let terminalSquadValue = 0;
    for (let i = 0; i < 4; i++) {
      const residualGw = state.gameweek + i;
      if (residualGw <= 38) {
        const { score } = this.simulateMatchday(state, residualGw, oracle, params);
        terminalSquadValue += score;
      }
    }
    
    fitness += terminalSquadValue;
    return fitness;
  }

  public generateValidActions(
    state: SquadState, 
    oracle: XPOracle, 
    gw: number, 
    allowLpTransfers: boolean = true,
    step: number = 0,
    params: UtilityParameters = DEFAULT_PARAMETERS
  ): Action[] {
    const actions: Action[] = [];
    
    actions.push({ type: 'ROLL', hitCost: 0 });

    if (step === 0) {
      if (state.chipState['WC'] > 0) actions.push({ type: 'CHIP', chipName: 'WC', hitCost: 0 });
      if (state.chipState['FH'] > 0) actions.push({ type: 'CHIP', chipName: 'FH', hitCost: 0 });
      if (state.chipState['BB'] > 0) actions.push({ type: 'CHIP', chipName: 'BB', hitCost: 0 });
      if (state.chipState['TC'] > 0) actions.push({ type: 'CHIP', chipName: 'TC', hitCost: 0 });
    }
    
    const squadSet = new Set(state.squad);
    const horizon = this.maxDepth;
    const candidateIds = this.getFilteredCandidates(oracle, gw, horizon, params);
    const potentialSwaps: { outId: number; inId: number; diff: number }[] = [];

    const candidateXPs: Record<number, number> = {};
    candidateIds.forEach(inId => {
      let inXP = 0, inVar = 0;
      for (let i = 0; i < horizon; i++) {
        inXP += oracle.getXP(inId, gw + i);
        inVar += oracle.getVariance(inId, gw + i);
      }
      const eo = oracle.getTop1kEO?.(inId) ?? 0;
      candidateXPs[inId] = calculateUtility(inXP, inVar, eo, params, inId);
    });

    state.squad.forEach(outId => {
      const outPos = oracle.getPosition(outId);
      const outCost = getSellingPrice(oracle.getCost(outId), state.purchasePrices[outId] || oracle.getCost(outId));
      
      let outXP = 0, outVar = 0;
      for (let i = 0; i < horizon; i++) {
        outXP += oracle.getXP(outId, gw + i);
        outVar += oracle.getVariance(outId, gw + i);
      }
      const eo = oracle.getTop1kEO?.(outId) ?? 0;
      const currentUtility = calculateUtility(outXP, outVar, eo, params, outId);

      candidateIds.forEach(inId => {
        if (squadSet.has(inId)) return;
        if (oracle.getPosition(inId) !== outPos) return;

        const inCost = oracle.getCost(inId);
        if (inCost > outCost + state.bank) return;

        // Using a fast proxy for net expected gain in candidate generation step
        const netExpectedGain = candidateXPs[inId] - currentUtility - (state.freeTransfers > 0 ? 0 : 4);
        
        if (netExpectedGain > 1.0) { 
          potentialSwaps.push({ outId, inId, diff: netExpectedGain });
        }
      });
    });

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

    if (allowLpTransfers) {
      for (let k = 1; k <= 3; k++) {
        const lpResult = solveOptimalTransfers(oracle, gw, state, k, horizon, params);
        if (lpResult && lpResult.transfersIn.length > 0) {
          const transfersCount = lpResult.transfersIn.length;
          const hitCost = Math.max(0, transfersCount - state.freeTransfers) * 4;
          
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

  public simulateHorizon(initialState: SquadState, oracle: XPOracle, params: UtilityParameters = DEFAULT_PARAMETERS): SquadState[] {
    let currentBeam = [initialState];

    for (let step = 0; step < this.maxDepth; step++) {
      const gw = initialState.gameweek + step;
      let nextBeam: SquadState[] = [];

      for (const state of currentBeam) {
        let currentState = { ...state, activeChip: undefined };
        
        if (state.activeChip === 'FH' && state.preFhSquad) {
          currentState.squad = state.preFhSquad;
          currentState.bank = state.preFhBank ?? state.bank;
          currentState.preFhSquad = undefined;
          currentState.preFhBank = undefined;
          currentState.freeTransfers = 1;
        }

        const actions = this.generateValidActions(currentState, oracle, gw, step === 0, step, params);
        
        for (const action of actions) {
          const nextState = applyAction(currentState, action, oracle, gw, params);
          
          if (step === 0) {
            nextState.firstAction = action.type === 'CHIP' ? action.chipName : action.type;
            nextState.firstTransfersIn = action.transfersIn;
            nextState.firstTransfersOut = action.transfersOut;
          } else {
            nextState.firstAction = currentState.firstAction;
            nextState.firstTransfersIn = currentState.firstTransfersIn;
            nextState.firstTransfersOut = currentState.firstTransfersOut;
          }

          const { score: gwUtility, variance: gwVariance } = this.simulateMatchday(nextState, gw, oracle, params);
          nextState.accumulatedScore += (gwUtility - action.hitCost);

          nextBeam.push(nextState);
        }
      }

      nextBeam.sort((a, b) => this.calculateFitness(b, oracle, params) - this.calculateFitness(a, oracle, params));
      currentBeam = nextBeam.slice(0, this.beamWidth);
    }

    return currentBeam;
  }

  private getFilteredCandidates(oracle: XPOracle, gw: number, horizon: number, params: UtilityParameters): number[] {
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

