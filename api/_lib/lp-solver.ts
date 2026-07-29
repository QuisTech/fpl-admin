import { XPOracle } from "./ingestion.js";
import { calculatePlayerUtility } from "./utility.js";

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

export function solveOptimalSquad(oracle: XPOracle, gameweek: number, budget: number, horizon: number = 8, riskMode: string = 'safe', availableIds?: Set<number>, playerScores?: Map<number, number>): number[] {
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

  if (riskMode === 'safe') {
    model.constraints.eo_total = { min: 250 };
    model.constraints.elite_eo_count = { min: 1 };
  }

  allIds.forEach(id => {
    if (availableIds && !availableIds.has(id)) return;
    
    const team = oracle.getTeam(id);
    if (!model.constraints[`team_${team}`]) {
      model.constraints[`team_${team}`] = { max: 3 };
    }

    const v = `p_${id}`;
    const pos = oracle.getPosition(id).toLowerCase(); // "gkp", "def", "mid", "fwd"
    
    // Sum expected points and variance over the lookahead horizon
    let score = 0;
    let varSum = 0;
    const cost = oracle.getCost(id);
    
    if (playerScores && playerScores.has(id)) {
      // Direct pass-through of precalculated heuristic scores (which already contain risk deformation)
      score = playerScores.get(id)!;
    } else {
      for (let i = 0; i < horizon; i++) {
        score += oracle.getXP(id, gameweek + i);
        varSum += oracle.getVariance(id, gameweek + i);
      }
      
      const costInMillions = cost / 10;
      score = calculatePlayerUtility(score, varSum, costInMillions, riskMode, id);
    }

    const eo = oracle.getTop1kEO?.(id) ?? 0;
    const isElite = eo >= 80 ? 1 : 0;

    // Only consider players who have a score > 0, OR cheap bench fodder (<= 4.5m) to ensure the model can find a valid budget team
    if (score > 0 || cost <= 45) {
      model.variables[v] = { 
        score, 
        cost, 
        total: 1, 
        [pos]: 1, 
        [`team_${team}`]: 1, 
        [v]: 1,
        eo_total: eo,
        elite_eo_count: isElite
      };
      model.constraints[v] = { max: 1 };
      model.ints[v] = 1;
    }
  });

  let solution: Record<string, any> | null = null;

  const relaxationSteps = riskMode === 'safe'
    ? [ { eo: 250, elite: 1 }, { eo: 200, elite: 1 }, { eo: 150, elite: 0 }, { eo: 0, elite: 0 } ]
    : [ { eo: 0, elite: 0 } ];

  for (const step of relaxationSteps) {
    if (riskMode === 'safe') {
      if (step.eo > 0) model.constraints.eo_total = { min: step.eo };
      else delete model.constraints.eo_total;
      
      if (step.elite > 0) model.constraints.elite_eo_count = { min: step.elite };
      else delete model.constraints.elite_eo_count;
    }

    solution = solver.Solve(model) as Record<string, any>;
    if (solution && solution.feasible) {
      break;
    }
  }

  if (!solution || !solution.feasible) {
    return []; // Failsafe, though eo:0 should generally always find a solution
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

  if (riskMode === 'safe') {
    model.constraints.eo_total = { min: 250 };
    model.constraints.elite_eo_count = { min: 1 };
  }

  allIds.forEach(id => {
    const team = oracle.getTeam(id);
    if (!model.constraints[`team_${team}`]) {
      model.constraints[`team_${team}`] = { max: 3 };
    }

    const v = `p_${id}`;
    const pos = oracle.getPosition(id).toLowerCase();
    
    // Sum expected points and variance over the lookahead horizon
    let score = 0;
    let varSum = 0;
    for (let i = 0; i < horizon; i++) {
      score += oracle.getXP(id, gameweek + i);
      varSum += oracle.getVariance(id, gameweek + i);
    }
    
    const cost = oracle.getCost(id);
    const costInMillions = cost / 10;
    score = calculatePlayerUtility(score, varSum, costInMillions, riskMode, id);

    const eo = oracle.getTop1kEO?.(id) ?? 0;
    const isElite = eo >= 80 ? 1 : 0;

    const isCurrent = currentSet.has(id);

    // Consider current squad players OR players with score > 0 OR cheap bench fodder
    if (isCurrent || score > 0 || cost <= 45) {
      model.variables[v] = { 
        score, 
        cost, 
        total: 1, 
        [pos]: 1, 
        [`team_${team}`]: 1, 
        keep: isCurrent ? 1 : 0,
        [v]: 1,
        eo_total: eo,
        elite_eo_count: isElite
      };
      model.constraints[v] = { max: 1 };
      model.ints[v] = 1;
    }
  });

  let solution: Record<string, any> | null = null;

  const relaxationSteps = riskMode === 'safe'
    ? [ { eo: 250, elite: 1 }, { eo: 200, elite: 1 }, { eo: 150, elite: 0 }, { eo: 0, elite: 0 } ]
    : [ { eo: 0, elite: 0 } ];

  for (const step of relaxationSteps) {
    if (riskMode === 'safe') {
      if (step.eo > 0) model.constraints.eo_total = { min: step.eo };
      else delete model.constraints.eo_total;
      
      if (step.elite > 0) model.constraints.elite_eo_count = { min: step.elite };
      else delete model.constraints.elite_eo_count;
    }

    solution = solver.Solve(model) as Record<string, any>;
    if (solution && solution.feasible) {
      break;
    }
  }

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
