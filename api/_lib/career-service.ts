import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { FPLService } from '../index.js';
import { OracleFactory, XPOracle } from './ingestion.js';
import { solveOptimalSquad, solveStartingXI, solveCaptain, solveOptimalTransfers } from './lp-solver.js';
import { SquadState, getSellingPrice } from './simulator.js';
import { getParamsForRiskMode } from './projection.js';
import { loadWeights } from './weights-loader.js';

const DEFAULT_PARAMETERS = loadWeights('baseline');

export interface CareerPlayer {
  id: number;
  web_name: string;
  position: 'GKP' | 'DEF' | 'MID' | 'FWD';
  cost: number; // in £0.1m, e.g. 100 = 10.0m
  costDisplay: string;
  team_short_name: string;
  points: number;
  minutes: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  multiplier: number;
  isAutoSubIn?: boolean;
  isAutoSubOut?: boolean;
}

export interface CareerGameweek {
  gameweek: number;
  startingXI: CareerPlayer[];
  bench: CareerPlayer[];
  captain: CareerPlayer;
  viceCaptain: CareerPlayer;
  activeCaptain: CareerPlayer;
  transfersIn: { id: number; name: string; position: string; cost: number; costDisplay: string }[];
  transfersOut: { id: number; name: string; position: string; cost: number; sellPrice: number; costDisplay: string }[];
  isRolledTransfer: boolean;
  freeTransfersAvailable: number;
  freeTransfersRemaining: number;
  hitsTaken: number;
  hitCostPoints: number;
  autoSubs: { outPlayer: string; inPlayer: string; points: number }[];
  grossPoints: number;
  netPoints: number;
  cumulativePoints: number;
  bank: number;
  bankDisplay: string;
  squadValue: number;
  teamValue: number;
  teamValueDisplay: string;
  chipActive?: string;
  decisionLog: string;
  averageScore?: number;
  humanComparison?: {
    gameweek: number;
    transfers: number;
    transfersCost: number;
    grossPoints: number;
    netPoints: number;
    cumulativePoints: number;
    overallRank?: number;
    alphaDelta: number;
    cumulativeAlphaDelta: number;
  };
}

export interface CareerSeasonPayload {
  mode: 'autonomous' | 'synced' | 'forward';
  teamId?: string;
  managerName?: string;
  teamName?: string;
  fuel: string;
  riskMode: string;
  scenario?: 'quant' | 'template';
  startGw: number;
  endGw: number;
  totalPoints: number;
  basePoints?: number;
  forwardPoints?: number;
  totalHitsCost: number;
  totalTransfersMade: number;
  totalTransfersRolled: number;
  finalBank: string;
  finalTeamValue: string;
  humanSummary?: {
    totalPoints: number;
    totalHitsCost: number;
    totalTransfersMade: number;
    currentOverallRank: number;
    netAlphaVsHuman: number;
  };
  chipInventory?: {
    currentSet: string;
    deadlineGw: number;
    chips: { name: string; label: string; status: 'AVAILABLE' | 'USED' | 'EXPIRED'; usedInGw?: number }[];
  };
  gameweeks: CareerGameweek[];
}

export class CareerService {
  private static FPL_BASE = 'https://fantasy.premierleague.com/api';
  private static autonomousCache: Map<string, { payload: CareerSeasonPayload; timestamp: number }> = new Map();
  private static CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  private static getPlayerPoints(gw: number): Record<number, number> {
    const pointsPath = path.join(process.cwd(), `data/snapshots/gw_${gw}/player_points.json`);
    if (fs.existsSync(pointsPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));
        const result: Record<number, number> = {};
        for (const k in raw) {
          result[parseInt(k, 10)] = Number(raw[k]);
        }
        return result;
      } catch (e) {
        console.warn(`[CareerService] Error reading player_points for GW${gw}:`, e);
      }
    }
    return {};
  }

  private static getPlayerStats(gw: number): Record<number, { points: number; minutes: number }> {
    const statsPath = path.join(process.cwd(), `data/snapshots/gw_${gw}/player_stats.json`);
    if (fs.existsSync(statsPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
        const result: Record<number, { points: number; minutes: number }> = {};
        for (const k in raw) {
          result[parseInt(k, 10)] = {
            points: Number(raw[k].points ?? 0),
            minutes: Number(raw[k].minutes ?? 0)
          };
        }
        return result;
      } catch (e) {
        console.warn(`[CareerService] Error reading player_stats for GW${gw}:`, e);
      }
    }
    const pointsMap = this.getPlayerPoints(gw);
    const fallback: Record<number, { points: number; minutes: number }> = {};
    for (const k in pointsMap) {
      const pts = pointsMap[k];
      fallback[parseInt(k, 10)] = { points: pts, minutes: pts > 0 ? 90 : 0 };
    }
    return fallback;
  }

  private static getOracleForGw(gw: number, baseData: any, fuel: string, riskMode: string): XPOracle {
    let csvPath = path.join(process.cwd(), `data/snapshots/gw_${gw}/fplform.csv`);
    if (fuel === 'native') {
      csvPath = path.join(process.cwd(), `data/snapshots/gw_${gw}/fpl_native.csv`);
    }

    if (!fs.existsSync(csvPath)) {
      // Fallback backwards to closest snapshot or root CSV
      let found = false;
      for (let prev = gw - 1; prev >= 1; prev--) {
        const candidate = path.join(process.cwd(), `data/snapshots/gw_${prev}/${fuel === 'native' ? 'fpl_native.csv' : 'fplform.csv'}`);
        if (fs.existsSync(candidate)) {
          csvPath = candidate;
          found = true;
          break;
        }
      }
      if (!found) {
        csvPath = path.join(process.cwd(), `data/${fuel === 'native' ? 'fpl_native.csv' : 'fplform.csv'}`);
      }
    }

    return OracleFactory.create(
      csvPath,
      baseData.players,
      fuel,
      baseData.fixtures,
      baseData.teams,
      gw,
      riskMode
    );
  }

  private static mapPlayer(
    id: number,
    baseData: any,
    oracle: XPOracle,
    actualStats: Record<number, { points: number; minutes: number }>,
    isCaptain: boolean,
    isViceCaptain: boolean,
    multiplier: number
  ): CareerPlayer {
    const p = baseData.players.find((pl: any) => pl.id === id);
    const pos = (oracle.getPosition(id) || (p?.element_type === 1 ? 'GKP' : p?.element_type === 2 ? 'DEF' : p?.element_type === 3 ? 'MID' : 'FWD')).toUpperCase() as 'GKP' | 'DEF' | 'MID' | 'FWD';
    const cost = oracle.getCost(id);
    const teamObj = baseData.teams.find((t: any) => t.id === p?.team);
    const teamShort = teamObj ? teamObj.short_name : oracle.getTeam(id) || 'FPL';
    const stat = actualStats[id];
    const points = stat ? stat.points : 0;
    const minutes = stat ? stat.minutes : 0;

    return {
      id,
      web_name: p ? p.web_name : `Player ${id}`,
      position: pos,
      cost,
      costDisplay: `£${(cost / 10).toFixed(1)}m`,
      team_short_name: teamShort,
      points,
      minutes,
      isCaptain,
      isViceCaptain,
      multiplier
    };
  }

  /**
   * Run the Autonomous Season Career from GW1 to endGw under official FPL human constraints.
   */
    private static orderBenchIds(benchIds: number[], oracle: XPOracle, gw: number): number[] {
    const gkpIds = benchIds.filter(id => oracle.getPosition(id) === 'GKP');
    const outfieldIds = benchIds.filter(id => oracle.getPosition(id) !== 'GKP');
    outfieldIds.sort((a, b) => {
      const xpA = typeof oracle.getXP === 'function' ? oracle.getXP(a, gw) : 0;
      const xpB = typeof oracle.getXP === 'function' ? oracle.getXP(b, gw) : 0;
      return xpB - xpA;
    });
    return [...gkpIds, ...outfieldIds];
  }

  public static async getAutonomousCareer(
    fuel: string = 'fplform',
    riskMode: string = 'safe',
    endGw: number = 9,
    scenario: 'quant' | 'template' = 'quant'
  ): Promise<CareerSeasonPayload> {
    const cacheKey = `auto_${fuel}_${riskMode}_${scenario}_${endGw}`;
    const cached = this.autonomousCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.payload;
    }

    const params = getParamsForRiskMode(riskMode, DEFAULT_PARAMETERS, scenario);
    const baseData = await FPLService.getBaseData();
    const oracleGw1 = this.getOracleForGw(1, baseData, fuel, riskMode);

    // Initial GW1 squad solve with £100m budget
    const initialSquad = solveOptimalSquad(oracleGw1, 1, 1000, 8, params);
    let totalSpent = 0;
    const purchasePrices: Record<number, number> = {};
    initialSquad.forEach(id => {
      const cost = oracleGw1.getCost(id);
      totalSpent += cost;
      purchasePrices[id] = cost;
    });

    let state: SquadState = {
      squad: initialSquad,
      bank: 1000 - totalSpent,
      freeTransfers: 1, // Will earn 1 FT going into GW2
      chipState: { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 },
      gameweek: 1,
      accumulatedScore: 0,
      purchasePrices
    };

    const gameweeks: CareerGameweek[] = [];
    let totalTransfersMade = 0;
    let totalTransfersRolled = 0;
    let totalHitsCost = 0;

    for (let gw = 1; gw <= endGw; gw++) {
      const oracle = this.getOracleForGw(gw, baseData, fuel, riskMode);
      const playerStats = this.getPlayerStats(gw);
      const actualPoints: Record<number, number> = {};
      for (const id in playerStats) {
        actualPoints[id] = playerStats[id].points;
      }

      let transfersInList: any[] = [];
      let transfersOutList: any[] = [];
      let isRolled = false;
      let hitsTaken = 0;
      let hitCostPoints = 0;
      let freeTransfersAvailable = state.freeTransfers;

      // Handle Transfer decisions starting from GW2
      if (gw > 1) {
        // Evaluate single transfer first
        const tResult = solveOptimalTransfers(oracle, gw, state, 1, 8, params);
        if (tResult && tResult.transfersIn.length > 0) {
          const inId = tResult.transfersIn[0];
          const outId = tResult.transfersOut[0];
          const inCost = oracle.getCost(inId);
          const outSell = getSellingPrice(oracle.getCost(outId), state.purchasePrices[outId] || oracle.getCost(outId));

          // Check if the transfer improves the squad
          state.squad = tResult.squad;
          state.bank = state.bank + outSell - inCost;
          delete state.purchasePrices[outId];
          state.purchasePrices[inId] = inCost;

          const pIn = baseData.players.find((p: any) => p.id === inId);
          const pOut = baseData.players.find((p: any) => p.id === outId);

          transfersInList.push({
            id: inId,
            name: pIn ? pIn.web_name : `Player ${inId}`,
            position: oracle.getPosition(inId),
            cost: inCost,
            costDisplay: `£${(inCost / 10).toFixed(1)}m`
          });
          transfersOutList.push({
            id: outId,
            name: pOut ? pOut.web_name : `Player ${outId}`,
            position: oracle.getPosition(outId),
            cost: oracle.getCost(outId),
            sellPrice: outSell,
            costDisplay: `£${(outSell / 10).toFixed(1)}m`
          });

          totalTransfersMade += 1;
          // Used 1 FT; bank rule: new FT added next week (max 5)
          state.freeTransfers = Math.min(5, Math.max(0, state.freeTransfers - 1) + 1);
        } else {
          isRolled = true;
          totalTransfersRolled += 1;
          state.freeTransfers = Math.min(5, state.freeTransfers + 1);
        }
      }

      // Starting XI and Captain selection
      const xiIds = solveStartingXI(oracle, gw, state.squad, params);
      const xiSet = new Set(xiIds);
      const rawBenchIds = state.squad.filter(id => !xiSet.has(id));
      const benchIds = this.orderBenchIds(rawBenchIds, oracle, gw);

      const { captain, viceCaptain } = solveCaptain(oracle, gw, xiIds, params);

      // Auto-substitutions calculation: Under official FPL rules, auto-sub ONLY triggers if starter played 0 minutes
      const autoSubs: { outPlayer: string; inPlayer: string; points: number }[] = [];
      const finalStarters = [...xiIds];
      const finalBench = [...benchIds];
      const usedBench = new Set<number>();

      finalStarters.forEach((sid, idx) => {
        const sStats = playerStats[sid] ?? { points: 0, minutes: 0 };
        // Auto-sub only triggers if starter played 0 minutes (did not feature)
        if (sStats.minutes === 0) {
          const sPos = oracle.getPosition(sid);
          const subIdx = finalBench.findIndex(bid => {
            if (usedBench.has(bid)) return false;
            const bPos = oracle.getPosition(bid);
            if (sPos === 'GKP') return bPos === 'GKP';
            return bPos !== 'GKP';
          });

          if (subIdx !== -1) {
            const sub = finalBench[subIdx];
            const subStats = playerStats[sub] ?? { points: 0, minutes: 0 };
            // Bench sub must have featured (minutes > 0)
            if (subStats.minutes > 0) {
              usedBench.add(sub);
              finalStarters[idx] = sub;
              finalBench[subIdx] = sid; // Starter who sat out moves to bench!
              const pOut = baseData.players.find((p: any) => p.id === sid);
              const pIn = baseData.players.find((p: any) => p.id === sub);
              autoSubs.push({
                outPlayer: pOut ? pOut.web_name : `Player ${sid}`,
                inPlayer: pIn ? pIn.web_name : `Player ${sub}`,
                points: subStats.points
              });
            }
          }
        }
      });

      // Active captain check: if captain played 0 minutes, pass to vice-captain if vice-captain played > 0 minutes
      let activeCapId = captain;
      const capStats = playerStats[captain] ?? { points: 0, minutes: 0 };
      const vcStats = playerStats[viceCaptain] ?? { points: 0, minutes: 0 };
      if (capStats.minutes === 0 && vcStats.minutes > 0) {
        activeCapId = viceCaptain;
      }

      // Calculate Gross Points
      let grossPoints = 0;
      finalStarters.forEach(id => {
        const pts = actualPoints[id] ?? 0;
        if (id === activeCapId) {
          grossPoints += pts * 2;
        } else {
          grossPoints += pts;
        }
      });

      const netPoints = grossPoints - hitCostPoints;
      state.accumulatedScore += netPoints;

      // Calculate Squad & Team Value
      let squadValue = 0;
      state.squad.forEach(id => {
        squadValue += getSellingPrice(oracle.getCost(id), state.purchasePrices[id] || oracle.getCost(id));
      });
      const teamValue = squadValue + state.bank;

      // Construct Player View Models
      const startingXIModels: CareerPlayer[] = finalStarters.map(id => {
        const isCap = id === activeCapId;
        const isVc = id === viceCaptain && activeCapId !== viceCaptain;
        const pModel = this.mapPlayer(id, baseData, oracle, playerStats, isCap, isVc, isCap ? 2 : 1);
        if (autoSubs.some(as => as.inPlayer === pModel.web_name)) {
          pModel.isAutoSubIn = true;
        }
        return pModel;
      });

      const benchModels: CareerPlayer[] = finalBench.map(id => {
        const pModel = this.mapPlayer(id, baseData, oracle, playerStats, false, false, 0);
        if (autoSubs.some(as => as.outPlayer === pModel.web_name)) {
          pModel.isAutoSubOut = true;
        }
        return pModel;
      });

      const capModel = startingXIModels.find(p => p.id === captain) || this.mapPlayer(captain, baseData, oracle, playerStats, true, false, 2);
      const vcModel = startingXIModels.find(p => p.id === viceCaptain) || this.mapPlayer(viceCaptain, baseData, oracle, playerStats, false, true, 1);
      const activeCapModel = startingXIModels.find(p => p.id === activeCapId) || capModel;

      // Decision log sentence
      let log = '';
      if (gw === 1) {
        log = `Season kickoff. Squad built under £100.0m budget. Captain: ${activeCapModel.web_name} (${activeCapModel.points * 2} pts).`;
      } else if (isRolled) {
        log = `Rolled Free Transfer. Saved 1 FT for upcoming gameweeks (Banked: ${state.freeTransfers} FTs). Captain: ${activeCapModel.web_name} (${activeCapModel.points * 2} pts).`;
      } else {
        const tIn = transfersInList[0]?.name || '';
        const tOut = transfersOutList[0]?.name || '';
        log = `Transfer: ${tOut} → ${tIn} (1 FT used, 0 hit). Captain: ${activeCapModel.web_name} (${activeCapModel.points * 2} pts).`;
      }

      if (autoSubs.length > 0) {
        log += ` Auto-sub: ${autoSubs.map(a => `${a.inPlayer} (+${a.points} pts)`).join(', ')}.`;
      }

      // Gameweek average score benchmark
      const evObj = baseData.fixtures ? null : null; // can pull from bootstrap events if present
      const defaultAverages = [0, 57, 59, 44, 52, 58, 62, 54, 38, 55];
      const avgScore = defaultAverages[gw] || 50;

      gameweeks.push({
        gameweek: gw,
        startingXI: startingXIModels,
        bench: benchModels,
        captain: capModel,
        viceCaptain: vcModel,
        activeCaptain: activeCapModel,
        transfersIn: transfersInList,
        transfersOut: transfersOutList,
        isRolledTransfer: isRolled,
        freeTransfersAvailable,
        freeTransfersRemaining: state.freeTransfers,
        hitsTaken,
        hitCostPoints,
        autoSubs,
        grossPoints,
        netPoints,
        cumulativePoints: state.accumulatedScore,
        bank: state.bank,
        bankDisplay: `£${(state.bank / 10).toFixed(1)}m`,
        squadValue,
        teamValue,
        teamValueDisplay: `£${(teamValue / 10).toFixed(1)}m`,
        decisionLog: log,
        averageScore: avgScore
      });
    }

    const payload: CareerSeasonPayload = {
      mode: 'autonomous',
      fuel,
      riskMode,
      scenario,
      startGw: 1,
      endGw,
      totalPoints: state.accumulatedScore,
      totalHitsCost,
      totalTransfersMade,
      totalTransfersRolled,
      finalBank: `£${(state.bank / 10).toFixed(1)}m`,
      finalTeamValue: `£${((gameweeks[gameweeks.length - 1]?.teamValue || 1000) / 10).toFixed(1)}m`,
      chipInventory: {
        currentSet: 'Set 1 (GW1–19)',
        deadlineGw: 19,
        chips: [
          { name: 'WC', label: 'Wildcard', status: state.chipState['WC'] > 0 ? 'AVAILABLE' : 'USED' },
          { name: 'TC', label: 'Triple Captain', status: state.chipState['TC'] > 0 ? 'AVAILABLE' : 'USED' },
          { name: 'BB', label: 'Bench Boost', status: state.chipState['BB'] > 0 ? 'AVAILABLE' : 'USED' },
          { name: 'FH', label: 'Free Hit', status: state.chipState['FH'] > 0 ? 'AVAILABLE' : 'USED' }
        ]
      },
      gameweeks
    };

    this.autonomousCache.set(cacheKey, { payload, timestamp: Date.now() });
    return payload;
  }

  /**
   * Run the Synced Team Replay / Counterfactual Duel starting from a user's real GW1 squad.
   */
  public static async getSyncedCareerReplay(
    teamId: string,
    fuel: string = 'fplform',
    riskMode: string = 'safe',
    endGw: number = 9,
    scenario: 'quant' | 'template' = 'quant'
  ): Promise<CareerSeasonPayload> {
    const params = getParamsForRiskMode(riskMode, DEFAULT_PARAMETERS, scenario);
    const cleanId = String(teamId).trim();
    const baseData = await FPLService.getBaseData();

    // 1. Fetch user's real history & entry details
    let userHistoryEvents: any[] = [];
    let managerName = 'Manager';
    let teamName = `Team ${cleanId}`;
    let userPicksGw1: any[] = [];
    let initialBank = 0;

    try {
      const [histRes, entryRes, picks1Res] = await Promise.all([
        axios.get(`${this.FPL_BASE}/entry/${cleanId}/history/`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }),
        axios.get(`${this.FPL_BASE}/entry/${cleanId}/`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }),
        axios.get(`${this.FPL_BASE}/entry/${cleanId}/event/1/picks/`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 })
      ]);

      userHistoryEvents = histRes.data.current || [];
      if (entryRes.data) {
        managerName = `${entryRes.data.player_first_name || ''} ${entryRes.data.player_last_name || ''}`.trim() || 'Manager';
        teamName = entryRes.data.name || teamName;
      }
      if (picks1Res.data?.picks && Array.isArray(picks1Res.data.picks)) {
        userPicksGw1 = picks1Res.data.picks;
        initialBank = picks1Res.data.entry_history?.bank || 0;
      }
    } catch (e: any) {
      console.warn(`[CareerService] Error fetching user history for ${cleanId}:`, e.message);
      // Fallback to autonomous mode if sync fails
      return this.getAutonomousCareer(fuel, riskMode, endGw);
    }

    if (userPicksGw1.length !== 15) {
      console.warn(`[CareerService] Incomplete GW1 picks for ${cleanId}, falling back to autonomous mode.`);
      return this.getAutonomousCareer(fuel, riskMode, endGw);
    }

    const initialSquad = userPicksGw1.map((p: any) => p.element);
    const oracleGw1 = this.getOracleForGw(1, baseData, fuel, riskMode);

    const purchasePrices: Record<number, number> = {};
    initialSquad.forEach(id => {
      purchasePrices[id] = oracleGw1.getCost(id);
    });

    let state: SquadState = {
      squad: initialSquad,
      bank: initialBank,
      freeTransfers: 1,
      chipState: { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 },
      gameweek: 1,
      accumulatedScore: 0,
      purchasePrices
    };

    const gameweeks: CareerGameweek[] = [];
    let totalTransfersMade = 0;
    let totalTransfersRolled = 0;
    let totalHitsCost = 0;
    let cumulativeAlpha = 0;

    const maxGw = Math.min(endGw, userHistoryEvents.length || endGw);

    for (let gw = 1; gw <= maxGw; gw++) {
      const oracle = this.getOracleForGw(gw, baseData, fuel, riskMode);
      const playerStats = this.getPlayerStats(gw);
      const actualPoints: Record<number, number> = {};
      for (const id in playerStats) {
        actualPoints[id] = playerStats[id].points;
      }
      const userGwRecord = userHistoryEvents.find((e: any) => e.event === gw);

      let transfersInList: any[] = [];
      let transfersOutList: any[] = [];
      let isRolled = false;
      let hitsTaken = 0;
      let hitCostPoints = 0;
      let freeTransfersAvailable = state.freeTransfers;

      // AI transfer decisions from GW2 onward using the user's squad
      if (gw > 1) {
        const tResult = solveOptimalTransfers(oracle, gw, state, 1, 8, params);
        if (tResult && tResult.transfersIn.length > 0) {
          const inId = tResult.transfersIn[0];
          const outId = tResult.transfersOut[0];
          const inCost = oracle.getCost(inId);
          const outSell = getSellingPrice(oracle.getCost(outId), state.purchasePrices[outId] || oracle.getCost(outId));

          state.squad = tResult.squad;
          state.bank = state.bank + outSell - inCost;
          delete state.purchasePrices[outId];
          state.purchasePrices[inId] = inCost;

          const pIn = baseData.players.find((p: any) => p.id === inId);
          const pOut = baseData.players.find((p: any) => p.id === outId);

          transfersInList.push({
            id: inId,
            name: pIn ? pIn.web_name : `Player ${inId}`,
            position: oracle.getPosition(inId),
            cost: inCost,
            costDisplay: `£${(inCost / 10).toFixed(1)}m`
          });
          transfersOutList.push({
            id: outId,
            name: pOut ? pOut.web_name : `Player ${outId}`,
            position: oracle.getPosition(outId),
            cost: oracle.getCost(outId),
            sellPrice: outSell,
            costDisplay: `£${(outSell / 10).toFixed(1)}m`
          });

          totalTransfersMade += 1;
          state.freeTransfers = Math.min(5, Math.max(0, state.freeTransfers - 1) + 1);
        } else {
          isRolled = true;
          totalTransfersRolled += 1;
          state.freeTransfers = Math.min(5, state.freeTransfers + 1);
        }
      }

      // Starting XI and Captain selection
      const xiIds = solveStartingXI(oracle, gw, state.squad, params);
      const xiSet = new Set(xiIds);
      const rawBenchIds = state.squad.filter(id => !xiSet.has(id));
      const benchIds = this.orderBenchIds(rawBenchIds, oracle, gw);
      const { captain, viceCaptain } = solveCaptain(oracle, gw, xiIds, params);

      // Auto-subs: Under official FPL rules, auto-sub ONLY triggers if starter played 0 minutes
      const autoSubs: { outPlayer: string; inPlayer: string; points: number }[] = [];
      const finalStarters = [...xiIds];
      const finalBench = [...benchIds];
      const usedBench = new Set<number>();

      finalStarters.forEach((sid, idx) => {
        const sStats = playerStats[sid] ?? { points: 0, minutes: 0 };
        if (sStats.minutes === 0) {
          const sPos = oracle.getPosition(sid);
          const subIdx = finalBench.findIndex(bid => {
            if (usedBench.has(bid)) return false;
            const bPos = oracle.getPosition(bid);
            if (sPos === 'GKP') return bPos === 'GKP';
            return bPos !== 'GKP';
          });

          if (subIdx !== -1) {
            const sub = finalBench[subIdx];
            const subStats = playerStats[sub] ?? { points: 0, minutes: 0 };
            if (subStats.minutes > 0) {
              usedBench.add(sub);
              finalStarters[idx] = sub;
              finalBench[subIdx] = sid; // Starter who sat out moves to bench!
              const pOut = baseData.players.find((p: any) => p.id === sid);
              const pIn = baseData.players.find((p: any) => p.id === sub);
              autoSubs.push({
                outPlayer: pOut ? pOut.web_name : `Player ${sid}`,
                inPlayer: pIn ? pIn.web_name : `Player ${sub}`,
                points: subStats.points
              });
            }
          }
        }
      });

      let activeCapId = captain;
      const capStats = playerStats[captain] ?? { points: 0, minutes: 0 };
      const vcStats = playerStats[viceCaptain] ?? { points: 0, minutes: 0 };
      if (capStats.minutes === 0 && vcStats.minutes > 0) {
        activeCapId = viceCaptain;
      }

      let grossPoints = 0;
      finalStarters.forEach(id => {
        const pts = actualPoints[id] ?? 0;
        if (id === activeCapId) {
          grossPoints += pts * 2;
        } else {
          grossPoints += pts;
        }
      });

      const netPoints = grossPoints - hitCostPoints;
      state.accumulatedScore += netPoints;

      // Squad Value
      let squadValue = 0;
      state.squad.forEach(id => {
        squadValue += getSellingPrice(oracle.getCost(id), state.purchasePrices[id] || oracle.getCost(id));
      });
      const teamValue = squadValue + state.bank;

      // Human Comparison Stats for this GW
      const humanGross = userGwRecord ? userGwRecord.points : netPoints;
      const humanHit = userGwRecord ? userGwRecord.event_transfers_cost : 0;
      const humanNet = humanGross - humanHit;
      const humanCum = userGwRecord ? userGwRecord.total_points : state.accumulatedScore;
      const alphaDelta = netPoints - humanNet;
      cumulativeAlpha += alphaDelta;

      const startingXIModels = finalStarters.map(id => {
        const isCap = id === activeCapId;
        const isVc = id === viceCaptain && activeCapId !== viceCaptain;
        const pModel = this.mapPlayer(id, baseData, oracle, playerStats, isCap, isVc, isCap ? 2 : 1);
        if (autoSubs.some(as => as.inPlayer === pModel.web_name)) {
          pModel.isAutoSubIn = true;
        }
        return pModel;
      });

      const benchModels = finalBench.map(id => {
        const pModel = this.mapPlayer(id, baseData, oracle, playerStats, false, false, 0);
        if (autoSubs.some(as => as.outPlayer === pModel.web_name)) {
          pModel.isAutoSubOut = true;
        }
        return pModel;
      });

      const capModel = startingXIModels.find(p => p.id === captain) || this.mapPlayer(captain, baseData, oracle, playerStats, true, false, 2);
      const vcModel = startingXIModels.find(p => p.id === viceCaptain) || this.mapPlayer(viceCaptain, baseData, oracle, playerStats, false, true, 1);
      const activeCapModel = startingXIModels.find(p => p.id === activeCapId) || capModel;

      let log = '';
      if (gw === 1) {
        log = `Identical GW1 base squad. AI Captain: ${activeCapModel.web_name} (${activeCapModel.points * 2} pts).`;
      } else if (isRolled) {
        log = `AI Rolled FT (Saved for future). You scored ${humanNet} pts, AI scored ${netPoints} pts (${alphaDelta >= 0 ? `+${alphaDelta}` : alphaDelta} pts).`;
      } else {
        const tIn = transfersInList[0]?.name || '';
        const tOut = transfersOutList[0]?.name || '';
        log = `AI Transferred ${tOut} → ${tIn}. You scored ${humanNet} pts, AI scored ${netPoints} pts (${alphaDelta >= 0 ? `+${alphaDelta}` : alphaDelta} pts).`;
      }

      gameweeks.push({
        gameweek: gw,
        startingXI: startingXIModels,
        bench: benchModels,
        captain: capModel,
        viceCaptain: vcModel,
        activeCaptain: activeCapModel,
        transfersIn: transfersInList,
        transfersOut: transfersOutList,
        isRolledTransfer: isRolled,
        freeTransfersAvailable,
        freeTransfersRemaining: state.freeTransfers,
        hitsTaken,
        hitCostPoints,
        autoSubs,
        grossPoints,
        netPoints,
        cumulativePoints: state.accumulatedScore,
        bank: state.bank,
        bankDisplay: `£${(state.bank / 10).toFixed(1)}m`,
        squadValue,
        teamValue,
        teamValueDisplay: `£${(teamValue / 10).toFixed(1)}m`,
        decisionLog: log,
        averageScore: 50,
        humanComparison: {
          gameweek: gw,
          transfers: userGwRecord?.event_transfers || 0,
          transfersCost: humanHit,
          grossPoints: humanGross,
          netPoints: humanNet,
          cumulativePoints: humanCum,
          overallRank: userGwRecord?.overall_rank,
          alphaDelta,
          cumulativeAlphaDelta: cumulativeAlpha
        }
      });
    }

    const lastGwRecord = userHistoryEvents[userHistoryEvents.length - 1];

    return {
      mode: 'synced',
      teamId: cleanId,
      managerName,
      teamName,
      fuel,
      riskMode,
      scenario,
      startGw: 1,
      endGw: maxGw,
      totalPoints: state.accumulatedScore,
      totalHitsCost,
      totalTransfersMade,
      totalTransfersRolled,
      finalBank: `£${(state.bank / 10).toFixed(1)}m`,
      finalTeamValue: `£${((gameweeks[gameweeks.length - 1]?.teamValue || 1000) / 10).toFixed(1)}m`,
      humanSummary: {
        totalPoints: lastGwRecord?.total_points || 0,
        totalHitsCost: userHistoryEvents.reduce((acc, e) => acc + (e.event_transfers_cost || 0), 0),
        totalTransfersMade: userHistoryEvents.reduce((acc, e) => acc + (e.event_transfers || 0), 0),
        currentOverallRank: lastGwRecord?.overall_rank || 0,
        netAlphaVsHuman: cumulativeAlpha
      },
      gameweeks
    };
  }

  /**
   * Forward Career Roadmap: Simulates the next horizon of gameweeks (e.g. GW10-15) under 1-FT/week rules.
   */
  public static async getForwardCareerProjection(
    teamId?: string,
    fuel: string = 'fplform',
    riskMode: string = 'safe',
    horizonGws: number = 6,
    scenario: 'quant' | 'template' = 'quant',
    forwardSource: 'autonomous' | 'synced' = 'autonomous'
  ): Promise<CareerSeasonPayload> {
    const params = getParamsForRiskMode(riskMode, DEFAULT_PARAMETERS, scenario);
    const baseData = await FPLService.getBaseData();
    const currentGw = baseData.currentEventId || 9;
    const startGw = currentGw + 1;
    const endGw = Math.min(38, currentGw + horizonGws);

    let squad: number[] = [];
    let bank = 0;
    let initialFt = 1;
    let initialAccumulatedScore = 0;
    let managerName = 'Autonomous Squad';
    let teamName = 'AI Optimization Unit';

    if (forwardSource === 'synced' && teamId) {
      const cleanId = String(teamId).trim();
      try {
        const [picksRes, entryRes, histRes] = await Promise.all([
          axios.get(`${this.FPL_BASE}/entry/${cleanId}/event/${currentGw}/picks/`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }),
          axios.get(`${this.FPL_BASE}/entry/${cleanId}/`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }),
          axios.get(`${this.FPL_BASE}/entry/${cleanId}/history/`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 })
        ]);
        if (picksRes.data?.picks && Array.isArray(picksRes.data.picks)) {
          squad = picksRes.data.picks.map((p: any) => p.element);
          bank = picksRes.data.entry_history?.bank || 0;
        }
        if (entryRes.data) {
          managerName = `${entryRes.data.player_first_name || ''} ${entryRes.data.player_last_name || ''}`.trim() || 'Manager';
          teamName = entryRes.data.name || teamName;
          initialAccumulatedScore = Number(entryRes.data.summary_overall_points || 0);
        }
        if (histRes.data?.current && Array.isArray(histRes.data.current) && histRes.data.current.length > 0) {
          const lastEvent = histRes.data.current[histRes.data.current.length - 1];
          if (lastEvent?.total_points) {
            initialAccumulatedScore = Number(lastEvent.total_points);
          }
        }
      } catch (e: any) {
        console.warn(`[CareerService] Forward roadmap picks fetch failed for ${teamId}:`, e.message);
      }
    } else {
      // Seed forward projection directly from the Autonomous AI's cumulative GW1-GW9 playthrough
      try {
        const autoCareer = await this.getAutonomousCareer(fuel, riskMode, currentGw, scenario);
        const lastGw = autoCareer.gameweeks[autoCareer.gameweeks.length - 1];
        if (lastGw) {
          squad = [...lastGw.startingXI.map(p => p.id), ...lastGw.bench.map(p => p.id)];
          bank = lastGw.bank;
          initialFt = lastGw.freeTransfersRemaining;
          initialAccumulatedScore = autoCareer.totalPoints;
          managerName = 'Autonomous AI Squad';
          teamName = 'AI Optimization Unit (GW9 Seed)';
        }
      } catch (e: any) {
        console.warn('[CareerService] Failed to seed from Autonomous Career:', e.message);
      }
    }

    const oracle = OracleFactory.create(
      path.join(process.cwd(), `data/${fuel === 'native' ? 'fpl_native.csv' : 'fplform.csv'}`),
      baseData.players,
      fuel,
      baseData.fixtures,
      baseData.teams,
      startGw,
      riskMode
    );

    if (squad.length !== 15) {
      squad = solveOptimalSquad(oracle, startGw, 1000, 6, params);
      let cost = 0;
      squad.forEach(id => { cost += oracle.getCost(id); });
      bank = 1000 - cost;
    }

    const purchasePrices: Record<number, number> = {};
    squad.forEach(id => {
      purchasePrices[id] = oracle.getCost(id);
    });

    let state: SquadState = {
      squad,
      bank,
      freeTransfers: initialFt,
      chipState: { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 },
      gameweek: startGw,
      accumulatedScore: initialAccumulatedScore,
      purchasePrices
    };

    const gameweeks: CareerGameweek[] = [];
    let totalTransfersMade = 0;
    let totalTransfersRolled = 0;

    for (let gw = startGw; gw <= endGw; gw++) {
      let transfersInList: any[] = [];
      let transfersOutList: any[] = [];
      let isRolled = false;
      let freeTransfersAvailable = state.freeTransfers;

      const tResult = solveOptimalTransfers(oracle, gw, state, 1, 6, params);
      if (tResult && tResult.transfersIn.length > 0) {
        const inId = tResult.transfersIn[0];
        const outId = tResult.transfersOut[0];
        const inCost = oracle.getCost(inId);
        const outSell = getSellingPrice(oracle.getCost(outId), state.purchasePrices[outId] || oracle.getCost(outId));

        state.squad = tResult.squad;
        state.bank = state.bank + outSell - inCost;
        delete state.purchasePrices[outId];
        state.purchasePrices[inId] = inCost;

        const pIn = baseData.players.find((p: any) => p.id === inId);
        const pOut = baseData.players.find((p: any) => p.id === outId);

        transfersInList.push({
          id: inId,
          name: pIn ? pIn.web_name : `Player ${inId}`,
          position: oracle.getPosition(inId),
          cost: inCost,
          costDisplay: `£${(inCost / 10).toFixed(1)}m`
        });
        transfersOutList.push({
          id: outId,
          name: pOut ? pOut.web_name : `Player ${outId}`,
          position: oracle.getPosition(outId),
          cost: oracle.getCost(outId),
          sellPrice: outSell,
          costDisplay: `£${(outSell / 10).toFixed(1)}m`
        });

        totalTransfersMade += 1;
        state.freeTransfers = Math.min(5, Math.max(0, state.freeTransfers - 1) + 1);
      } else {
        isRolled = true;
        totalTransfersRolled += 1;
        state.freeTransfers = Math.min(5, state.freeTransfers + 1);
      }

      const xiIds = solveStartingXI(oracle, gw, state.squad, params);
      const xiSet = new Set(xiIds);
      const rawBenchIds = state.squad.filter(id => !xiSet.has(id));
      const benchIds = this.orderBenchIds(rawBenchIds, oracle, gw);
      const { captain, viceCaptain } = solveCaptain(oracle, gw, xiIds, params);

      // In forward projections, points are based on Expected Points (xP)
      let grossPoints = 0;
      let activeChip: string | undefined = undefined;

      // Smart Chip Evaluation (2026/27 Set 1 rules: GW1–19)
      const capXp = oracle.getXP(captain, gw);
      const benchXp = benchIds.reduce((sum, id) => sum + oracle.getXP(id, gw), 0);

      if (state.chipState['TC'] > 0 && (capXp >= 10.0 || gw === 19)) {
        activeChip = 'TC';
        state.chipState['TC'] -= 1;
      } else if (state.chipState['BB'] > 0 && (benchXp >= 15.0 || gw === 19)) {
        activeChip = 'BB';
        state.chipState['BB'] -= 1;
      }

      const dummyActualStats: Record<number, { points: number; minutes: number }> = {};
      state.squad.forEach(id => {
        const xp = Math.round(oracle.getXP(id, gw));
        dummyActualStats[id] = { points: xp, minutes: 90 };
        if (xiSet.has(id)) {
          if (id === captain) {
            grossPoints += activeChip === 'TC' ? xp * 3 : xp * 2;
          } else {
            grossPoints += xp;
          }
        }
      });

      if (activeChip === 'BB') {
        benchIds.forEach(id => {
          grossPoints += Math.round(oracle.getXP(id, gw));
        });
      }

      state.accumulatedScore += grossPoints;

      let squadValue = 0;
      state.squad.forEach(id => {
        squadValue += getSellingPrice(oracle.getCost(id), state.purchasePrices[id] || oracle.getCost(id));
      });
      const teamValue = squadValue + state.bank;

      const startingXIModels = xiIds.map(id => {
        const isCap = id === captain;
        const isVc = id === viceCaptain;
        const mult = isCap ? (activeChip === 'TC' ? 3 : 2) : 1;
        return this.mapPlayer(id, baseData, oracle, dummyActualStats, isCap, isVc, mult);
      });

      const benchModels = benchIds.map(id => {
        return this.mapPlayer(id, baseData, oracle, dummyActualStats, false, false, 0);
      });

      const capModel = startingXIModels.find(p => p.id === captain) || this.mapPlayer(captain, baseData, oracle, dummyActualStats, true, false, 2);
      const vcModel = startingXIModels.find(p => p.id === viceCaptain) || this.mapPlayer(viceCaptain, baseData, oracle, dummyActualStats, false, true, 1);

      let log = isRolled
        ? `GW${gw} Projected: Roll Free Transfer (Bank: ${state.freeTransfers} FTs). Captain: ${capModel.web_name} (${(dummyActualStats[captain]?.points ?? 0) * 2} xP).`
        : `GW${gw} Projected: Transfer ${transfersOutList[0]?.name} → ${transfersInList[0]?.name}. Captain: ${capModel.web_name} (${(dummyActualStats[captain]?.points ?? 0) * 2} xP).`;

      gameweeks.push({
        gameweek: gw,
        startingXI: startingXIModels,
        bench: benchModels,
        captain: capModel,
        viceCaptain: vcModel,
        activeCaptain: capModel,
        transfersIn: transfersInList,
        transfersOut: transfersOutList,
        isRolledTransfer: isRolled,
        freeTransfersAvailable,
        freeTransfersRemaining: state.freeTransfers,
        hitsTaken: 0,
        hitCostPoints: 0,
        autoSubs: [],
        grossPoints,
        netPoints: grossPoints,
        cumulativePoints: state.accumulatedScore,
        bank: state.bank,
        bankDisplay: `£${(state.bank / 10).toFixed(1)}m`,
        squadValue,
        teamValue,
        teamValueDisplay: `£${(teamValue / 10).toFixed(1)}m`,
        decisionLog: log
      });
    }

    const forwardPoints = state.accumulatedScore - initialAccumulatedScore;

    return {
      mode: 'forward',
      teamId,
      managerName,
      teamName,
      fuel,
      riskMode,
      scenario,
      startGw,
      endGw,
      totalPoints: state.accumulatedScore,
      basePoints: initialAccumulatedScore,
      forwardPoints,
      totalHitsCost: 0,
      totalTransfersMade,
      totalTransfersRolled,
      finalBank: `£${(state.bank / 10).toFixed(1)}m`,
      finalTeamValue: `£${((gameweeks[gameweeks.length - 1]?.teamValue || 1000) / 10).toFixed(1)}m`,
      gameweeks
    };
  }
}
