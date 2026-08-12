import { OracleFactory } from './api/_lib/ingestion.js';
import { solveOptimalSquad } from './api/_lib/lp-solver.js';
import { getParamsForRiskMode } from './api/_lib/projection.js';
import { loadWeights } from './api/_lib/weights-loader.js';
import fs from 'fs';

async function run() {
  const players = JSON.parse(fs.readFileSync('./data/bootstrap-static.json', 'utf-8')).elements;
  const oracle = OracleFactory.create('./data/fplform.csv', players, 'fplform', [], [], 1, 'value');
  
  const baseWeights = loadWeights('baseline');
  const params = getParamsForRiskMode('value', baseWeights);
  
  const squad = solveOptimalSquad(oracle, 1, 1000, 8, params);
  console.log("Value Squad IDs:", squad);
  
  let cost = 0;
  let score = 0;
  for (const id of squad) {
     cost += oracle.getCost(id);
     let xp = 0;
     for (let i = 0; i < 8; i++) {
        xp += oracle.getXP(id, 1 + i);
     }
     score += xp;
     console.log(`Player ${id}: Cost ${oracle.getCost(id)}, Score ${xp}`);
  }
  console.log("Total Cost:", cost);
  console.log("Total Score:", score);
}

run().catch(console.error);
