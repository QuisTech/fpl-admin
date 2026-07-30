import { XPOracle } from "./ingestion.js";
import { calculateUtility } from "./utility.js";
import { UtilityParameters, DEFAULT_PARAMETERS } from "./projection.js";
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

export function solveOptimalSquad(
  oracle: XPOracle, 
  gameweek: number, 
  budget: number, 
  horizon: number = 8, 
  params: UtilityParameters = DEFAULT_PARAMETERS,
  availableIds?: Set<number>
): number[] {
  const allIds = oracle.getAllPlayerIds();
  
  const model: LPSolverModel = {
    optimize: "score",
    opType: "max",
    constraints: { 
      cost: { max: budget }, 
      total: { equal: 15 }, 
      gkp: { equal: 2 }, 
      def: { equal: 5 }, 
      mid: { equal: 5 }, 
      fwd: { equal: 3 } 
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

  allIds.forEach(id => {
    if (availableIds && !availableIds.has(id)) return;
    
    const team = oracle.getTeam(id);
    if (!model.constraints[`team_${team}`]) {
      model.constraints[`team_${team}`] = { max: 3 };
    }

    const v = `p_${id}`;
    const pos = oracle.getPosition(id).toLowerCase();
    
    const score = getPlayerScore(oracle, gameweek, id, horizon, params);
    const cost = oracle.getCost(id);

    // Only consider players who have a score > 0, OR cheap bench fodder (<= 45 = 4.5m)
    if (score > 0 || cost <= 45) {
      model.variables[v] = { 
        score, 
        cost, 
        total: 1, 
        [pos]: 1, 
        [`team_${team}`]: 1, 
        [v]: 1
      };

      if (params.minEoTotal) {
        model.variables[v]['eo_total'] = oracle.getTop1kEO?.(id) ?? 0;
      }
      if (params.minElitePlayers) {
        model.variables[v]['elite_total'] = cost >= 100 ? 1 : 0;
      }
      model.constraints[v] = { max: 1 };
      model.ints[v] = 1;
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

export function solveCaptain(
  oracle: XPOracle,
  gameweek: number,
  xiIds: number[],
  params: UtilityParameters = DEFAULT_PARAMETERS
): { captain: number; viceCaptain: number } {
  if (xiIds.length === 0) return { captain: 0, viceCaptain: 0 };
  
  // Sort players by their 1-GW utility
  const playersWithScores = xiIds.map(id => ({
    id,
    score: getPlayerScore(oracle, gameweek, id, 1, params)
  }));
  
  playersWithScores.sort((a, b) => b.score - a.score);
  
  return {
    captain: playersWithScores[0].id,
    viceCaptain: playersWithScores.length > 1 ? playersWithScores[1].id : playersWithScores[0].id
  };
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

