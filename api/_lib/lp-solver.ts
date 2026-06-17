import { XPOracle } from "./ingestion.js";

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

export function solveOptimalSquad(oracle: XPOracle, gameweek: number, budget: number, horizon: number = 8, riskMode: string = 'safe', availableIds?: Set<number>): number[] {
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

  allIds.forEach(id => {
    if (availableIds && !availableIds.has(id)) return;
    
    const team = oracle.getTeam(id);
    if (!model.constraints[`team_${team}`]) {
      model.constraints[`team_${team}`] = { max: 3 };
    }

    const v = `p_${id}`;
    const pos = oracle.getPosition(id).toLowerCase(); // "gkp", "def", "mid", "fwd"
    
    // Sum expected points over the lookahead horizon
    let score = 0;
    for (let i = 0; i < horizon; i++) {
      score += oracle.getXP(id, gameweek + i);
    }
    
    // Add deterministic tie-breaker to prevent search explosion in branch-and-bound LP solver
    if (score > 0 && riskMode === 'value') {
      score += (id % 10000) * 1e-4;
    }
    
    const cost = oracle.getCost(id);

    // Apply EO/Risk utility adjustments to the LP objective score
    if (score > 0 && riskMode !== 'value') {
      // 1. Premium Captaincy Protection
      const costInMillions = cost / 10;
      if (costInMillions >= 10.0) {
        score *= 1.15;
      } else if (costInMillions >= 8.0) {
        score *= 1.08;
      }

      // 2. Smooth EO Sentiment scaling
      if (riskMode === 'safe') {
        const eo = oracle.getTop1kEO?.(id) ?? 0;
        score *= (1 + 0.15 * (eo / 100));
      } else if (riskMode === 'aggressive') {
        const eo = oracle.getTop1kEO?.(id) ?? 0;
        score *= (1 + 0.25 * (1 - eo / 100));
      }
    }

    // Only consider players who have a score > 0 to keep the model small
    if (score > 0) {
      model.variables[v] = { 
        score, 
        cost, 
        total: 1, 
        [pos]: 1, 
        [`team_${team}`]: 1, 
        [v]: 1 
      };
      model.constraints[v] = { max: 1 };
      model.ints[v] = 1;
    }
  });

  const solution = solver.Solve(model) as Record<string, any>;
  
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

export function solveOptimalTransfers(
  oracle: XPOracle, 
  gameweek: number, 
  currentSquad: number[], 
  bank: number, 
  maxTransfers: number,
  horizon: number = 8,
  riskMode: string = 'safe'
): { squad: number[]; transfersIn: number[]; transfersOut: number[] } | null {
  const allIds = oracle.getAllPlayerIds();
  const currentSet = new Set(currentSquad);
  
  // Calculate total squad value
  let squadValue = 0;
  currentSquad.forEach(id => squadValue += oracle.getCost(id));
  const budget = squadValue + bank;

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
    
    // Sum expected points over the lookahead horizon
    let score = 0;
    for (let i = 0; i < horizon; i++) {
      score += oracle.getXP(id, gameweek + i);
    }
    
    // Add deterministic tie-breaker to prevent search explosion in branch-and-bound LP solver
    if (score > 0 && riskMode === 'value') {
      score += (id % 10000) * 1e-4;
    }
    
    const cost = oracle.getCost(id);

    // Apply EO/Risk utility adjustments to the LP objective score
    if (score > 0 && riskMode !== 'value') {
      // 1. Premium Captaincy Protection
      const costInMillions = cost / 10;
      if (costInMillions >= 10.0) {
        score *= 1.15;
      } else if (costInMillions >= 8.0) {
        score *= 1.08;
      }

      // 2. Smooth EO Sentiment scaling
      if (riskMode === 'safe') {
        const eo = oracle.getTop1kEO?.(id) ?? 0;
        score *= (1 + 0.15 * (eo / 100));
      } else if (riskMode === 'aggressive') {
        const eo = oracle.getTop1kEO?.(id) ?? 0;
        score *= (1 + 0.25 * (1 - eo / 100));
      }
    }

    const isCurrent = currentSet.has(id);

    // Consider current squad players OR players with score > 0
    if (isCurrent || score > 0) {
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
  const transfersOut = currentSquad.filter(id => !newSet.has(id));

  return { squad, transfersIn, transfersOut };
}
