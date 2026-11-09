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
  private static CACHE_TTL = 60 * 1000; // 1 minute
  private static liveStatsCache: Map<number, { stats: Record<number, { points: number; minutes: number }>; timestamp: number }> = new Map();
  private static LIVE_CACHE_TTL = 45 * 1000; // 45 seconds for live matchday updates

  private static async getLiveOrStoredPlayerStats(
    gw: number,
    currentEventId?: number
  ): Promise<Record<number, { points: number; minutes: number }>> {
    const diskStats = this.getPlayerStats(gw);
    const hasNonZeroDiskStats = Object.values(diskStats).some(s => s.points !== 0 || s.minutes > 0);

    // Fetch live from official FPL API if this is the active gameweek or local snapshot has only 0s
    if (gw === currentEventId || !hasNonZeroDiskStats) {
      const cachedLive = this.liveStatsCache.get(gw);
      if (cachedLive && Date.now() - cachedLive.timestamp < this.LIVE_CACHE_TTL) {
        return cachedLive.stats;
      }

      try {
        const res = await axios.get(`${this.FPL_BASE}/event/${gw}/live/`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 6000
        });
        const elements = res.data?.elements || [];
        if (Array.isArray(elements) && elements.length > 0) {
          const liveStats: Record<number, { points: number; minutes: number }> = {};
          const pointsMap: Record<number, number> = {};
          for (const el of elements) {
            const pts = Number(el.stats?.total_points ?? 0);
            const mins = Number(el.stats?.minutes ?? 0);
            liveStats[el.id] = { points: pts, minutes: mins };
            pointsMap[el.id] = pts;
          }

          if (Object.values(liveStats).some(s => s.points !== 0 || s.minutes > 0)) {
            this.liveStatsCache.set(gw, { stats: liveStats, timestamp: Date.now() });
            try {
              const dir = path.join(process.cwd(), `data/snapshots/gw_${gw}`);
              if (fs.existsSync(dir)) {
                fs.writeFileSync(path.join(dir, 'player_points.json'), JSON.stringify(pointsMap, null, 2));
                fs.writeFileSync(path.join(dir, 'player_stats.json'), JSON.stringify(liveStats, null, 2));
              }
            } catch {
              // Ignore write errors in read-only serverless environments
            }
            return liveStats;
          }
        }
      } catch (e: any) {
        console.warn(`[CareerService] Live points fetch fallback for GW${gw}:`, e.message);
      }
    }

    return diskStats;
  }

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
    const pointsMap = this.getPlayerPoints(gw);
    const result: Record<number, { points: number; minutes: number }> = {};

    if (fs.existsSync(statsPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
        for (const k in raw) {
          result[parseInt(k, 10)] = {
            points: Number(raw[k].points ?? 0),
            minutes: Number(raw[k].minutes ?? 0)
          };
        }
      } catch (e) {
        console.warn(`[CareerService] Error reading player_stats for GW${gw}:`, e);
      }
    }

    // Defensive Reconciliation:
    // If player_points has positive points for a player (> 0), they unquestionably featured in real life.
    // If player_stats recorded 0 minutes and 0 points (e.g. from an incomplete/stale matchday snapshot),
    // self-heal from player_points so genuine point scorers are never falsely marked as 0-minute non-players.
    for (const k in pointsMap) {
      const id = parseInt(k, 10);
      const pts = pointsMap[id] ?? 0;
      if (pts > 0 && (!result[id] || (result[id].minutes === 0 && result[id].points === 0))) {
        result[id] = { points: pts, minutes: 90 };
      }
    }

    if (Object.keys(result).length === 0) {
      for (const k in pointsMap) {
        const pts = pointsMap[k];
        result[parseInt(k, 10)] = { points: pts, minutes: pts > 0 ? 90 : 0 };
      }
    }

    return result;
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
    endGw?: number,
    scenario: 'quant' | 'template' = 'quant'
  ): Promise<CareerSeasonPayload> {
    const baseData = await FPLService.getBaseData();
    const effectiveEndGw = (endGw !== undefined && !isNaN(endGw)) ? endGw : (baseData.currentEventId || 9);
    const cacheKey = `auto_${fuel}_${riskMode}_${scenario}_${effectiveEndGw}`;
    const cached = this.autonomousCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.payload;
    }

    // 1. Check for locked historical decisions to ensure permanent historical immutability
    const historyFile = path.join(process.cwd(), 'data/snapshots/autonomous_career_history.json');
    let lockedGameweeks: CareerGameweek[] = [];
    if (fs.existsSync(historyFile)) {
      try {
        const histData = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        const normFuel = fuel === 'eye-test' ? 'eye_test' : fuel;
        const key = `${normFuel}_${riskMode}_${scenario}`;
        if (Array.isArray(histData[key])) {
          lockedGameweeks = JSON.parse(JSON.stringify(histData[key]));
        } else if (Array.isArray(histData[`${fuel}_${riskMode}_${scenario}`])) {
          lockedGameweeks = JSON.parse(JSON.stringify(histData[`${fuel}_${riskMode}_${scenario}`]));
        }
      } catch (e) {
        console.warn('[CareerService] Failed to read autonomous_career_history.json:', e);
      }
    }

    // If requested gameweek range is fully within locked historical decisions, return locked records directly
    if (lockedGameweeks.length > 0 && effectiveEndGw <= lockedGameweeks.length) {
      const gws = lockedGameweeks.slice(0, effectiveEndGw);

      // Update actual match points using live FPL API or stored player_stats.json for live/recent gameweeks
      for (const g of gws) {
        const stats = await this.getLiveOrStoredPlayerStats(g.gameweek, baseData.currentEventId);
        if (Object.keys(stats).length > 0) {
          let gross = 0;
          let hasStats = false;
          g.startingXI.forEach(p => {
            if (stats[p.id]) {
              p.points = stats[p.id].points;
              p.minutes = stats[p.id].minutes;
              hasStats = true;
            }
            gross += p.points * p.multiplier;
          });
          g.bench.forEach(p => {
            if (stats[p.id]) {
              p.points = stats[p.id].points;
              p.minutes = stats[p.id].minutes;
            }
          });
          if (g.captain && stats[g.captain.id]) {
            g.captain.points = stats[g.captain.id].points;
            g.captain.minutes = stats[g.captain.id].minutes;
          }
          if (g.viceCaptain && stats[g.viceCaptain.id]) {
            g.viceCaptain.points = stats[g.viceCaptain.id].points;
            g.viceCaptain.minutes = stats[g.viceCaptain.id].minutes;
          }
          if (g.activeCaptain && stats[g.activeCaptain.id]) {
            g.activeCaptain.points = stats[g.activeCaptain.id].points;
            g.activeCaptain.minutes = stats[g.activeCaptain.id].minutes;
          }
          if (hasStats) {
            g.grossPoints = gross;
            g.netPoints = gross - (g.hitCostPoints || 0);
            if (g.decisionLog && g.activeCaptain) {
              const capPts = g.activeCaptain.points * (g.activeCaptain.multiplier || 2);
              g.decisionLog = g.decisionLog.replace(
                /Captain:\s*([^(\n]+)\(\d+\s*pts\)/,
                `Captain: ${g.activeCaptain.web_name} (${capPts} pts)`
              );
            }
          }
        }
      }

      let runningTotal = 0;
      gws.forEach(g => {
        runningTotal += g.netPoints;
        g.cumulativePoints = runningTotal;
      });

      const lastGw = gws[gws.length - 1];
      const payload: CareerSeasonPayload = {
        mode: 'autonomous',
        fuel,
        riskMode,
        scenario,
        startGw: 1,
        endGw: effectiveEndGw,
        totalPoints: runningTotal,
        totalHitsCost: gws.reduce((acc, g) => acc + (g.hitCostPoints || 0), 0),
        totalTransfersMade: gws.reduce((acc, g) => acc + (g.transfersIn?.length || 0), 0),
        totalTransfersRolled: gws.filter(g => g.isRolledTransfer).length,
        finalBank: lastGw ? lastGw.bankDisplay : '£0.0m',
        finalTeamValue: lastGw ? lastGw.teamValueDisplay : '£100.0m',
        chipInventory: {
          currentSet: (lastGw?.gameweek || 1) <= 19 ? 'Set 1 (GW1–19)' : 'Set 2 (GW20–38)',
          deadlineGw: (lastGw?.gameweek || 1) <= 19 ? 19 : 38,
          chips: [
            { name: 'WC', label: 'Wildcard', status: 'AVAILABLE' },
            { name: 'TC', label: 'Triple Captain', status: 'AVAILABLE' },
            { name: 'BB', label: 'Bench Boost', status: 'AVAILABLE' },
            { name: 'FH', label: 'Free Hit', status: 'AVAILABLE' }
          ]
        },
        gameweeks: gws
      };

      this.autonomousCache.set(cacheKey, { payload, timestamp: Date.now() });
      return payload;
    }

    const params = getParamsForRiskMode(riskMode, DEFAULT_PARAMETERS, scenario);
    let state: SquadState;
    const gameweeks: CareerGameweek[] = [];
    let totalTransfersMade = 0;
    let totalTransfersRolled = 0;
    let totalHitsCost = 0;
    let startGw = 1;

    if (lockedGameweeks.length > 0) {
      gameweeks.push(...lockedGameweeks);
      startGw = lockedGameweeks.length + 1;
      const lastLocked = lockedGameweeks[lockedGameweeks.length - 1];
      const lastLockedSquad = [...lastLocked.startingXI.map(p => p.id), ...lastLocked.bench.map(p => p.id)];
      const purchasePrices: Record<number, number> = {};
      const lastOracle = this.getOracleForGw(lockedGameweeks.length, baseData, fuel, riskMode);
      lastLockedSquad.forEach(id => {
        purchasePrices[id] = lastOracle.getCost(id);
      });

      state = {
        squad: lastLockedSquad,
        bank: lastLocked.bank,
        freeTransfers: lastLocked.freeTransfersRemaining,
        chipState: { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 },
        gameweek: lockedGameweeks.length,
        accumulatedScore: lastLocked.cumulativePoints,
        purchasePrices
      };

      totalTransfersMade = lockedGameweeks.reduce((acc, g) => acc + (g.transfersIn?.length || 0), 0);
      totalTransfersRolled = lockedGameweeks.filter(g => g.isRolledTransfer).length;
      totalHitsCost = lockedGameweeks.reduce((acc, g) => acc + (g.hitCostPoints || 0), 0);
    } else {
      const oracleGw1 = this.getOracleForGw(1, baseData, fuel, riskMode);
      const initialSquad = solveOptimalSquad(oracleGw1, 1, 1000, 8, params);
      let totalSpent = 0;
      const purchasePrices: Record<number, number> = {};
      initialSquad.forEach(id => {
        const cost = oracleGw1.getCost(id);
        totalSpent += cost;
        purchasePrices[id] = cost;
      });

      state = {
        squad: initialSquad,
        bank: 1000 - totalSpent,
        freeTransfers: 1, // Will earn 1 FT going into GW2
        chipState: { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 },
        gameweek: 1,
        accumulatedScore: 0,
        purchasePrices
      };
    }

    for (let gw = startGw; gw <= effectiveEndGw; gw++) {
      const oracle = this.getOracleForGw(gw, baseData, fuel, riskMode);
      const playerStats = await this.getLiveOrStoredPlayerStats(gw, baseData.currentEventId);
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
        // Evaluate single transfer first — only execute if the incoming player starts in the Starting XI this GW
        const tResult = solveOptimalTransfers(oracle, gw, state, 1, 8, params);
        const candidateXi = tResult && tResult.transfersIn.length > 0
          ? solveStartingXI(oracle, gw, tResult.squad, params)
          : [];
        if (tResult && tResult.transfersIn.length > 0 && candidateXi.includes(tResult.transfersIn[0])) {
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
    endGw?: number,
    scenario: 'quant' | 'template' = 'quant'
  ): Promise<CareerSeasonPayload> {
    const params = getParamsForRiskMode(riskMode, DEFAULT_PARAMETERS, scenario);
    const cleanId = String(teamId).trim();
    const baseData = await FPLService.getBaseData();
    const effectiveEndGw = (endGw !== undefined && !isNaN(endGw)) ? endGw : (baseData.currentEventId || 9);

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

    // Check for locked historical decisions in synced_career_history.json for permanent historical immutability
    const syncedHistoryFile = path.join(process.cwd(), 'data/snapshots/synced_career_history.json');
    let lockedSyncedGameweeks: CareerGameweek[] = [];
    if (fs.existsSync(syncedHistoryFile)) {
      try {
        const histData = JSON.parse(fs.readFileSync(syncedHistoryFile, 'utf8'));
        const normFuel = fuel === 'eye-test' ? 'eye_test' : fuel;
        const teamKey = `${cleanId}_${normFuel}_${riskMode}_${scenario}`;
        const fallbackKey = `${normFuel}_${riskMode}_${scenario}`;
        if (Array.isArray(histData[teamKey])) {
          lockedSyncedGameweeks = JSON.parse(JSON.stringify(histData[teamKey]));
        } else if (cleanId === '532002' && Array.isArray(histData[fallbackKey])) {
          lockedSyncedGameweeks = JSON.parse(JSON.stringify(histData[fallbackKey]));
        }
      } catch (e) {
        console.warn('[CareerService] Failed to read synced_career_history.json:', e);
      }
    }

    if (lockedSyncedGameweeks.length > 0 && effectiveEndGw <= lockedSyncedGameweeks.length) {
      const gws = lockedSyncedGameweeks.slice(0, effectiveEndGw);
      let runningTotal = 0;
      let runningAlpha = 0;

      for (const g of gws) {
        const stats = await this.getLiveOrStoredPlayerStats(g.gameweek, baseData.currentEventId);
        if (Object.keys(stats).length > 0) {
          let gross = 0;
          let hasStats = false;
          g.startingXI.forEach(p => {
            if (stats[p.id]) {
              p.points = stats[p.id].points;
              p.minutes = stats[p.id].minutes;
              hasStats = true;
            }
            gross += p.points * p.multiplier;
          });
          g.bench.forEach(p => {
            if (stats[p.id]) {
              p.points = stats[p.id].points;
              p.minutes = stats[p.id].minutes;
            }
          });
          if (g.captain && stats[g.captain.id]) {
            g.captain.points = stats[g.captain.id].points;
            g.captain.minutes = stats[g.captain.id].minutes;
          }
          if (g.viceCaptain && stats[g.viceCaptain.id]) {
            g.viceCaptain.points = stats[g.viceCaptain.id].points;
            g.viceCaptain.minutes = stats[g.viceCaptain.id].minutes;
          }
          if (g.activeCaptain && stats[g.activeCaptain.id]) {
            g.activeCaptain.points = stats[g.activeCaptain.id].points;
            g.activeCaptain.minutes = stats[g.activeCaptain.id].minutes;
          }
          if (hasStats) {
            g.grossPoints = gross;
            g.netPoints = gross - (g.hitCostPoints || 0);
          }
        }

        runningTotal += g.netPoints;
        g.cumulativePoints = runningTotal;

        const userGwRecord = userHistoryEvents.find((e: any) => e.event === g.gameweek);
        if (userGwRecord) {
          const humanGross = userGwRecord.points;
          const humanHit = userGwRecord.event_transfers_cost || 0;
          const humanNet = humanGross - humanHit;
          const humanCum = userGwRecord.total_points;
          const alphaDelta = g.netPoints - humanNet;
          runningAlpha += alphaDelta;

          g.humanComparison = {
            gameweek: g.gameweek,
            transfers: userGwRecord.event_transfers || 0,
            transfersCost: humanHit,
            grossPoints: humanGross,
            netPoints: humanNet,
            cumulativePoints: humanCum,
            overallRank: userGwRecord.overall_rank,
            alphaDelta,
            cumulativeAlphaDelta: runningAlpha
          };

          if (g.gameweek === 1 && g.activeCaptain) {
            g.decisionLog = `Identical GW1 base squad. AI Captain: ${g.activeCaptain.web_name} (${g.activeCaptain.points * (g.activeCaptain.multiplier || 2)} pts).`;
          } else if (g.isRolledTransfer) {
            g.decisionLog = `AI Rolled FT (Saved for future). You scored ${humanNet} pts, AI scored ${g.netPoints} pts (${alphaDelta >= 0 ? `+${alphaDelta}` : alphaDelta} pts).`;
          } else if (g.transfersIn?.length > 0 && g.transfersOut?.length > 0) {
            g.decisionLog = `AI Transferred ${g.transfersOut[0].name} → ${g.transfersIn[0].name}. You scored ${humanNet} pts, AI scored ${g.netPoints} pts (${alphaDelta >= 0 ? `+${alphaDelta}` : alphaDelta} pts).`;
          }
        }
      }

      const lastGw = gws[gws.length - 1];
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
        endGw: effectiveEndGw,
        totalPoints: runningTotal,
        totalHitsCost: gws.reduce((acc, g) => acc + (g.hitCostPoints || 0), 0),
        totalTransfersMade: gws.reduce((acc, g) => acc + (g.transfersIn?.length || 0), 0),
        totalTransfersRolled: gws.filter(g => g.isRolledTransfer).length,
        finalBank: lastGw ? lastGw.bankDisplay : '£0.0m',
        finalTeamValue: lastGw ? lastGw.teamValueDisplay : '£100.0m',
        humanSummary: {
          totalPoints: lastGwRecord?.total_points || lastGw?.humanComparison?.cumulativePoints || 0,
          totalHitsCost: userHistoryEvents.reduce((acc: number, e: any) => acc + (e.event_transfers_cost || 0), 0),
          totalTransfersMade: userHistoryEvents.reduce((acc: number, e: any) => acc + (e.event_transfers || 0), 0),
          currentOverallRank: lastGwRecord?.overall_rank || 0,
          netAlphaVsHuman: runningAlpha
        },
        chipInventory: {
          currentSet: (lastGw?.gameweek || 1) <= 19 ? 'Set 1 (GW1–19)' : 'Set 2 (GW20–38)',
          deadlineGw: (lastGw?.gameweek || 1) <= 19 ? 19 : 38,
          chips: [
            { name: 'WC', label: 'Wildcard', status: 'AVAILABLE' },
            { name: 'TC', label: 'Triple Captain', status: 'AVAILABLE' },
            { name: 'BB', label: 'Bench Boost', status: 'AVAILABLE' },
            { name: 'FH', label: 'Free Hit', status: 'AVAILABLE' }
          ]
        },
        gameweeks: gws
      };
    }

    let state: SquadState;
    const gameweeks: CareerGameweek[] = [];
    let totalTransfersMade = 0;
    let totalTransfersRolled = 0;
    let totalHitsCost = 0;
    let cumulativeAlpha = 0;
    let startGw = 1;

    if (lockedSyncedGameweeks.length > 0) {
      gameweeks.push(...lockedSyncedGameweeks);
      startGw = lockedSyncedGameweeks.length + 1;
      const lastLocked = lockedSyncedGameweeks[lockedSyncedGameweeks.length - 1];
      const lastLockedSquad = [...lastLocked.startingXI.map(p => p.id), ...lastLocked.bench.map(p => p.id)];
      const purchasePrices: Record<number, number> = {};
      const lastOracle = this.getOracleForGw(lockedSyncedGameweeks.length, baseData, fuel, riskMode);
      lastLockedSquad.forEach(id => {
        purchasePrices[id] = lastOracle.getCost(id);
      });

      state = {
        squad: lastLockedSquad,
        bank: lastLocked.bank,
        freeTransfers: lastLocked.freeTransfersRemaining,
        chipState: { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 },
        gameweek: lockedSyncedGameweeks.length,
        accumulatedScore: lastLocked.cumulativePoints,
        purchasePrices
      };

      totalTransfersMade = lockedSyncedGameweeks.reduce((acc, g) => acc + (g.transfersIn?.length || 0), 0);
      totalTransfersRolled = lockedSyncedGameweeks.filter(g => g.isRolledTransfer).length;
      totalHitsCost = lockedSyncedGameweeks.reduce((acc, g) => acc + (g.hitCostPoints || 0), 0);
      cumulativeAlpha = lastLocked.humanComparison?.cumulativeAlphaDelta || 0;
    } else {
      const initialSquad = userPicksGw1.map((p: any) => p.element);
      const oracleGw1 = this.getOracleForGw(1, baseData, fuel, riskMode);

      const purchasePrices: Record<number, number> = {};
      initialSquad.forEach(id => {
        purchasePrices[id] = oracleGw1.getCost(id);
      });

      state = {
        squad: initialSquad,
        bank: initialBank,
        freeTransfers: 1,
        chipState: { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 },
        gameweek: 1,
        accumulatedScore: 0,
        purchasePrices
      };
    }

    const maxGw = Math.max(effectiveEndGw, userHistoryEvents.length || effectiveEndGw);

    for (let gw = startGw; gw <= Math.min(effectiveEndGw, maxGw); gw++) {
      const oracle = this.getOracleForGw(gw, baseData, fuel, riskMode);
      const playerStats = await this.getLiveOrStoredPlayerStats(gw, baseData.currentEventId);
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

      // AI transfer decisions from GW2 onward using the user's squad — only execute if incoming player makes the Starting XI
      if (gw > 1) {
        const tResult = solveOptimalTransfers(oracle, gw, state, 1, 8, params);
        const candidateXi = tResult && tResult.transfersIn.length > 0
          ? solveStartingXI(oracle, gw, tResult.squad, params)
          : [];
        if (tResult && tResult.transfersIn.length > 0 && candidateXi.includes(tResult.transfersIn[0])) {
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
      // Seed forward projection directly from the Autonomous AI's frozen cumulative playthrough
      try {
        const autoCareer = await this.getAutonomousCareer(fuel, riskMode, currentGw, scenario);
        const lastGw = autoCareer.gameweeks[autoCareer.gameweeks.length - 1];
        if (lastGw) {
          squad = [...lastGw.startingXI.map(p => p.id), ...lastGw.bench.map(p => p.id)];
          bank = lastGw.bank;
          initialFt = lastGw.freeTransfersRemaining;
          initialAccumulatedScore = autoCareer.totalPoints;
          managerName = 'Autonomous AI Squad';
          teamName = `AI Optimization Unit (GW${currentGw} Seed)`;
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
      // Set 2 Chip Renewal: At GW20, any remaining Set 1 chips expire and Set 2 chips become available
      if (gw === 20) {
        state.chipState = { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 };
      }
      let transfersInList: any[] = [];
      let transfersOutList: any[] = [];
      let isRolled = false;
      let freeTransfersAvailable = state.freeTransfers;

      const tResult = solveOptimalTransfers(oracle, gw, state, 1, 6, params);
      const candidateXi = tResult && tResult.transfersIn.length > 0
        ? solveStartingXI(oracle, gw, tResult.squad, params)
        : [];
      if (tResult && tResult.transfersIn.length > 0 && candidateXi.includes(tResult.transfersIn[0])) {
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

      // Smart Chip Evaluation (Set 1: GW1–19 SGW Optimization vs Set 2: GW20–38 DGW/BGW Optimization)
      // Key Real-World Rule: Double Gameweeks (DGWs) virtually NEVER occur in GW1–19 because domestic cup clashes
      // (FA Cup QF/SF, EFL Cup Final) only create postponements in the spring (GW20–38).
      // Therefore, Set 1 chips MUST be triggered on elite Single Gameweek peaks before expiring after GW19:
      // - TC1: Elite Single Gameweek fixture (e.g. Haaland/Salah home to promoted side, capXp >= 8.5) or deadline (GW19)
      // - BB1: High-ceiling bench with favorable single fixtures (benchXp >= 11.0) or deadline (GW19)
      // In Set 2 (GW20–38), true DGWs occur, so thresholds target double-fixture upside:
      // - TC2: Double Gameweek captaincy (capXp >= 12.0) or GW38
      // - BB2: Double Gameweek bench depth (benchXp >= 16.0) or GW38
      const isSet1 = gw <= 19;
      const tcThreshold = isSet1 ? 8.5 : 12.0;
      const bbThreshold = isSet1 ? 11.0 : 16.0;
      const chipDeadline = isSet1 ? 19 : 38;

      const capXp = oracle.getXP(captain, gw);
      const benchXp = benchIds.reduce((sum, id) => sum + oracle.getXP(id, gw), 0);

      if (state.chipState['TC'] > 0 && (capXp >= tcThreshold || gw === chipDeadline)) {
        activeChip = 'TC';
        state.chipState['TC'] -= 1;
      } else if (state.chipState['BB'] > 0 && (benchXp >= bbThreshold || gw === chipDeadline)) {
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

      let logPrefix = activeChip ? `[CHIP: ${activeChip === 'TC' ? 'Triple Captain' : activeChip === 'BB' ? 'Bench Boost' : activeChip}] ` : '';
      let capPts = (dummyActualStats[captain]?.points ?? 0) * (activeChip === 'TC' ? 3 : 2);
      let log = isRolled
        ? `${logPrefix}GW${gw} Projected: Roll Free Transfer (Bank: ${state.freeTransfers} FTs). Captain: ${capModel.web_name} (${capPts} xP).`
        : `${logPrefix}GW${gw} Projected: Transfer ${transfersOutList[0]?.name} → ${transfersInList[0]?.name}. Captain: ${capModel.web_name} (${capPts} xP).`;
      if (activeChip === 'BB') {
        const benchPtsSum = benchIds.reduce((sum, id) => sum + (dummyActualStats[id]?.points ?? 0), 0);
        log += ` Bench Boost added +${benchPtsSum} xP from bench.`;
      }

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
        chipActive: activeChip,
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
      chipInventory: {
        currentSet: (gameweeks[gameweeks.length - 1]?.gameweek || startGw) <= 19 ? 'Set 1 (GW1–19)' : 'Set 2 (GW20–38)',
        deadlineGw: (gameweeks[gameweeks.length - 1]?.gameweek || startGw) <= 19 ? 19 : 38,
        chips: [
          { name: 'WC', label: 'Wildcard', status: state.chipState['WC'] > 0 ? 'AVAILABLE' : 'USED' },
          { name: 'TC', label: 'Triple Captain', status: state.chipState['TC'] > 0 ? 'AVAILABLE' : 'USED' },
          { name: 'BB', label: 'Bench Boost', status: state.chipState['BB'] > 0 ? 'AVAILABLE' : 'USED' },
          { name: 'FH', label: 'Free Hit', status: state.chipState['FH'] > 0 ? 'AVAILABLE' : 'USED' }
        ]
      },
      gameweeks
    };
  }
}
