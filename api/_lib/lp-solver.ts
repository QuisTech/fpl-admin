import { loadWeights } from './weights-loader.js';
const DEFAULT_PARAMETERS = loadWeights('baseline');
import { XPOracle } from "./ingestion.js";
import { calculateUtility } from "./utility.js";
import { UtilityParameters, } from './projection.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const solver = require("javascript-lp-solver");

interface LPSolverModel {
  optimize: string;
  opType: "max" | "min";
  constraints: Record<string, { max?: number; min?: number; equal?: number }>;
  variables: Record<string, Record<string, number>>;
  ints: Record<string, 1>;
}

function getPlayerScore(oracle: XPOracle, gameweek: number, id: number, horizon: number, params: UtilityParameters): number {
  let xp = 0;
  let varSum = 0;
  for (let i = 0; i < horizon; i++) {
    xp += oracle.getXP(id, gameweek + i);
    varSum += oracle.getVariance(id, gameweek + i);
  }
  const eo = oracle.getTop1kEO?.(id) ?? 0;
  return calculateUtility(xp, varSum, eo, params, id);
}

function getRawXP(oracle: XPOracle, gameweek: number, id: number, horizon: number): number {
  let xp = 0;
  for (let i = 0; i < horizon; i++) {
    xp += oracle.getXP(id, gameweek + i);
  }
  return xp;
}

export function solveOptimalSquad(
  oracle: XPOracle, 
  gameweek: number, 
  budget: number, 
  horizon: number = 8, 
  params: UtilityParameters = DEFAULT_PARAMETERS,
  availableIds?: Set<number>,
  lockedIds?: Set<number>,
  excludedIds?: Set<number>
): number[] {
  const allIds = oracle.getAllPlayerIds();
  
  const actualBudget = params.budgetMultiplier ? Math.floor(budget * params.budgetMultiplier) : budget;
  
  const model: LPSolverModel = {
    optimize: "score",
    opType: "max",
    constraints: { 
      cost: { max: actualBudget }, 
      total: { equal: 15 }, 
      gkp: { equal: 2 }, 
      def: { equal: 5 }, 
      mid: { equal: 5 }, 
      fwd: { equal: 3 },
      total_cap: { max: 1 }
    },
    variables: {},
    ints: {}
  };

  if (params.minEoTotal) {
    model.constraints['eo_total'] = { min: params.minEoTotal };
  }
  if (params.minElitePlayers) {
    model.constraints['elite_total'] = { min: params.minElitePlayers };
  }

  // 1. Pre-calculate candidate stats to prune redundant variables
  const candidates: Array<{
    id: number;
    pos: string;
    team: string;
    score: number;
    rawXP: number;
    cost: number;
    capScore: number;
    isLocked: boolean;
  }> = [];

  allIds.forEach(id => {
    if (availableIds && !availableIds.has(id)) return;
    if (excludedIds && excludedIds.has(id)) return;

    const isLocked = !!(lockedIds && lockedIds.has(id));
    const score = getPlayerScore(oracle, gameweek, id, horizon, params);
    const rawXP = getRawXP(oracle, gameweek, id, horizon);
    const cost = oracle.getCost(id);
    const capScore = getPlayerScore(oracle, gameweek, id, 1, params);
    const pos = oracle.getPosition(id).toLowerCase();
    const team = oracle.getTeam(id);

    if (rawXP > 0 || cost <= 45 || isLocked) {
      candidates.push({ id, pos, team, score, rawXP, cost, capScore, isLocked });
    }
  });

  // Keep top candidates per position + best value budget enablers + all locked
  const posLimit: Record<string, number> = { gkp: 15, def: 25, mid: 25, fwd: 20 };
  const filteredCandidates: typeof candidates = [];

  (['gkp', 'def', 'mid', 'fwd'] as const).forEach(pos => {
    const posList = candidates.filter(c => c.pos === pos);
    const sortedByVFM = [...posList].sort((a, b) => (b.score / (b.cost / 10)) - (a.score / (a.cost / 10)));
    const sortedByScore = [...posList].sort((a, b) => b.score - a.score);
    const sortedByCost = [...posList].sort((a, b) => a.cost - b.cost);

    const limit = posLimit[pos] || 25;
    const selectedIds = new Set<number>();

    // Top points scorers
    sortedByScore.slice(0, limit).forEach(c => selectedIds.add(c.id));
    // Top value-for-money
    sortedByVFM.slice(0, limit).forEach(c => selectedIds.add(c.id));
    // Cheapest budget enablers (top 5 cheapest per position)
    sortedByCost.slice(0, 5).forEach(c => selectedIds.add(c.id));
    // Any locked player
    posList.filter(c => c.isLocked).forEach(c => selectedIds.add(c.id));

    posList.forEach(c => {
      if (selectedIds.has(c.id)) {
        filteredCandidates.push(c);
      }
    });
  });

  // Top captain contenders only (top 8 highest scoring attackers)
  const topCaptainIds = new Set(
    filteredCandidates
      .filter(c => (c.capScore >= 3.5 && (c.pos === 'mid' || c.pos === 'fwd')) || c.isLocked)
      .sort((a, b) => b.capScore - a.capScore)
      .slice(0, 8)
      .map(c => c.id)
  );

  filteredCandidates.forEach(c => {
    const v = `p_${c.id}`;
    const capVar = `c_${c.id}`;

    if (!model.constraints[`team_${c.team}`]) {
      model.constraints[`team_${c.team}`] = { max: 3 };
    }

    const hasCapOption = topCaptainIds.has(c.id);

    model.variables[v] = { 
      score: c.score, 
      cost: c.cost, 
      total: 1, 
      [c.pos]: 1, 
      [`team_${c.team}`]: 1, 
      [v]: 1
    };

    if (hasCapOption) {
      model.variables[v][`cap_link_${c.id}`] = -1;
      model.constraints[`cap_link_${c.id}`] = { max: 0 };
    }

    if (params.minEoTotal) {
      model.variables[v]['eo_total'] = oracle.getTop1kEO?.(c.id) ?? 0;
    }
    if (params.minElitePlayers) {
      model.variables[v]['elite_total'] = c.cost >= 100 ? 1 : 0;
    }

    model.constraints[v] = c.isLocked ? { equal: 1 } : { max: 1 };
    model.ints[v] = 1;

    // Captaincy 2x decision variable: adds the extra 1x points for top contenders
    if (hasCapOption && c.capScore > 0) {
      model.variables[capVar] = {
        score: c.capScore,
        total_cap: 1,
        [`cap_link_${c.id}`]: 1,
        [capVar]: 1
      };
      model.constraints[capVar] = { max: 1 };
      model.ints[capVar] = 1;
    }
  });

  const solution = solver.Solve(model) as Record<string, any>;
  
  if (!solution || !solution.feasible) {
    return []; 
  }
  
  const squadIds: number[] = [];
  for (const key in solution) {
    if (key.startsWith('p_')) {
      const val = solution[key];
      if (val === true || val === 1 || (typeof val === 'number' && val > 0.5)) {
        squadIds.push(parseInt(key.replace('p_', '')));
      }
    }
  }

  return squadIds;
}

export function solveStartingXI(
  oracle: XPOracle,
  gameweek: number,
  squadIds: number[],
  params: UtilityParameters = DEFAULT_PARAMETERS
): number[] {
  const model: LPSolverModel = {
    optimize: "score",
    opType: "max",
    constraints: { 
      total: { equal: 11 }, 
      gkp: { equal: 1 }, 
      def: { min: 3, max: 5 }, 
      mid: { min: 2, max: 5 }, 
      fwd: { min: 1, max: 3 } 
    },
    variables: {},
    ints: {}
  };

  squadIds.forEach(id => {
    const v = `p_${id}`;
    const pos = oracle.getPosition(id).toLowerCase();
    
    // We only care about the single upcoming gameweek for the XI (horizon = 1)
    const score = getPlayerScore(oracle, gameweek, id, 1, params);

    model.variables[v] = { 
      score, 
      total: 1, 
      [pos]: 1, 
      [v]: 1
    };
    model.constraints[v] = { max: 1 };
    model.ints[v] = 1;
  });

  const solution = solver.Solve(model) as Record<string, any>;
  
  if (!solution || !solution.feasible) {
    // Failsafe: Just pick the first valid formation if LP fails for some reason
    // In practice, LP will never fail here because squad is 2/5/5/3.
    return squadIds.slice(0, 11);
  }
  
  const xiIds: number[] = [];
  for (const key in solution) {
    if (key.startsWith('p_')) {
      const val = solution[key];
      if (val === true || val === 1 || (typeof val === 'number' && val > 0.5)) {
        xiIds.push(parseInt(key.replace('p_', '')));
      }
    }
  }

  return xiIds;
}

function getCorrelation(oracle: XPOracle, p1: number, p2: number): number {
  if (p1 === p2) return 1.0;
  
  const team1 = oracle.getTeam(p1);
  const team2 = oracle.getTeam(p2);
  const pos1 = oracle.getPosition(p1);
  const pos2 = oracle.getPosition(p2);

  if (team1 === team2) {
    if ((pos1 === 'GKP' && pos2 === 'DEF') || (pos1 === 'DEF' && pos2 === 'GKP')) return 0.75;
    if ((pos1 === 'MID' && pos2 === 'FWD') || (pos1 === 'FWD' && pos2 === 'MID')) return 0.55;
    if (pos1 === 'DEF' && pos2 === 'DEF') return 0.60;
    return 0.30;
  }
  
  return 0.02;
}

export function solveCaptain(
  oracle: XPOracle,
  gameweek: number,
  xiIds: number[],
  params: UtilityParameters = DEFAULT_PARAMETERS
): { captain: number; viceCaptain: number } {
  if (xiIds.length === 0) return { captain: 0, viceCaptain: 0 };
  
  const getCaptainScore = (id: number) => {
    const dist = oracle.getDistribution(id, gameweek);
    const eo = oracle.getTop1kEO?.(id) ?? 0;
    const pos = oracle.getPosition(id);
    const posMultiplier = (pos === 'FWD' || pos === 'MID') ? 1.25 : 1.0;
    
    const targetTail = params.betaVariance > 0 ? (dist.tails[15] || 0) : (dist.tails[8] || 0);
    const tailWeight = Math.abs(params.betaVariance) * 10; 
    const skewReward = params.betaVariance > 0 ? ((dist.skewness || 0) * 0.5) : 0;

    return (dist.mean + (tailWeight * targetTail) + skewReward + (params.betaEO * eo / 100)) * posMultiplier;
  };

  const playersWithScores = xiIds.map(id => ({
    id,
    score: getCaptainScore(id)
  }));
  
  playersWithScores.sort((a, b) => b.score - a.score);
  const captain = playersWithScores[0];
  
  const vcParams = { ...params };
  if (vcParams.betaEO < 0) {
    vcParams.betaEO = Math.abs(vcParams.betaEO);
  }
  
  const getVCScore = (id: number) => {
    const dist = oracle.getDistribution(id, gameweek);
    const eo = oracle.getTop1kEO?.(id) ?? 0;
    const pos = oracle.getPosition(id);
    const posMultiplier = (pos === 'FWD' || pos === 'MID') ? 1.25 : 1.0;
    
    const targetTail = vcParams.betaVariance > 0 ? (dist.tails[15] || 0) : (dist.tails[8] || 0);
    const tailWeight = Math.abs(vcParams.betaVariance) * 10; 
    
    const baseScore = dist.mean + (tailWeight * targetTail) + (vcParams.betaEO * eo / 100);
    const lambda = 5.0;
    const correlation = getCorrelation(oracle, captain.id, id);
    
    return (baseScore * posMultiplier) - (lambda * correlation);
  };

  const vcCandidates = xiIds
    .filter(id => id !== captain.id)
    .map(id => ({ id, score: getVCScore(id) }));

  vcCandidates.sort((a, b) => b.score - a.score);
  const viceCaptain = vcCandidates[0] ? vcCandidates[0].id : captain.id;

  return { captain: captain.id, viceCaptain };
}

import { SquadState, getSellingPrice } from './simulator.js';

export function solveOptimalTransfers(
  oracle: XPOracle, 
  gameweek: number, 
  state: SquadState, 
  maxTransfers: number,
  horizon: number = 8,
  params: UtilityParameters = DEFAULT_PARAMETERS
): { squad: number[]; transfersIn: number[]; transfersOut: number[] } | null {
  const allIds = oracle.getAllPlayerIds();
  const currentSet = new Set(state.squad);
  
  let squadValue = 0;
  state.squad.forEach(id => {
    squadValue += getSellingPrice(oracle.getCost(id), state.purchasePrices[id] || oracle.getCost(id));
  });
  const budget = squadValue + state.bank;

  const model: LPSolverModel = {
    optimize: "score",
    opType: "max",
    constraints: { 
      cost: { max: budget }, 
      total: { equal: 15 }, 
      gkp: { equal: 2 }, 
      def: { equal: 5 }, 
      mid: { equal: 5 }, 
      fwd: { equal: 3 },
      keep: { min: 15 - maxTransfers }
    },
    variables: {},
    ints: {}
  };

  allIds.forEach(id => {
    const team = oracle.getTeam(id);
    if (!model.constraints[`team_${team}`]) {
      model.constraints[`team_${team}`] = { max: 3 };
    }

    const v = `p_${id}`;
    const pos = oracle.getPosition(id).toLowerCase();
    
    const score = getPlayerScore(oracle, gameweek, id, horizon, params);
    const isCurrent = currentSet.has(id);
    const cost = isCurrent 
      ? getSellingPrice(oracle.getCost(id), state.purchasePrices[id] || oracle.getCost(id)) 
      : oracle.getCost(id);

    if (isCurrent || score > 0 || cost <= 45) {
      model.variables[v] = { 
        score, 
        cost, 
        total: 1, 
        [pos]: 1, 
        [`team_${team}`]: 1, 
        keep: isCurrent ? 1 : 0,
        [v]: 1
      };
      model.constraints[v] = { max: 1 };
      model.ints[v] = 1;
    }
  });

  const solution = solver.Solve(model) as Record<string, any>;
  
  if (!solution || !solution.feasible) {
    return null;
  }

  const squad: number[] = [];
  for (const key in solution) {
    if (key.startsWith('p_')) {
      const val = solution[key];
      if (val === true || val === 1 || (typeof val === 'number' && val > 0.5)) {
        squad.push(parseInt(key.replace('p_', '')));
      }
    }
  }

  const newSet = new Set(squad);
  const transfersIn = squad.filter(id => !currentSet.has(id));
  const transfersOut = state.squad.filter(id => !newSet.has(id));

  return { squad, transfersIn, transfersOut };
}

