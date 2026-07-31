import { loadWeights } from '../api/_lib/weights-loader.js';
const DEFAULT_PARAMETERS = loadWeights('baseline');
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import {  ProjectionEngine, HistoricalOracle } from '../api/_lib/projection.js';

const OPTIMIZED_PARAMETERS = { ...DEFAULT_PARAMETERS };
import { solveOptimalSquad } from '../api/_lib/lp-solver.js';

async function debugSquadSelection() {
  const season = '2023-24';
  const provider = new VaastavProvider();
  await provider.loadSeason(season);

  console.log('\n=== GW1 Squad Selection Debug ===');
  
  const gw = 1;
  const snapshot = provider.getDeadlineSnapshot(gw, 1000, 0, { 'WC': 2, 'FH': 1, 'BB': 1, 'TC': 1 });
  const engine = new ProjectionEngine(OPTIMIZED_PARAMETERS);
  const oracle = new HistoricalOracle(snapshot, engine);
  
  console.log('Solving initial squad...');
  const initialSquad = solveOptimalSquad(oracle, gw, 1000, 8, OPTIMIZED_PARAMETERS);
  
  console.log(`\nInitial squad size: ${initialSquad.length}`);
  console.log('Squad IDs:', initialSquad);
  
  let spent = 0;
  initialSquad.forEach(id => spent += oracle.getCost(id));
  console.log(`Total spent: £${spent / 10}m`);
  console.log(`Bank remaining: £${(1000 - spent) / 10}m`);
  
  // Check actual points for GW1
  console.log('\n=== GW1 Actual Points for Selected Squad ===');
  let totalPoints = 0;
  initialSquad.forEach(id => {
    const actualPts = provider.getActualPoints(id, gw);
    const xp = oracle.getXP(id, gw);
    console.log(`Player ID ${id}: Actual=${actualPts}, XP=${xp}`);
    totalPoints += actualPts;
  });
  
  console.log(`\nTotal squad points (GW1): ${totalPoints}`);
  
  // Also check what Haaland's points are
  const haalandId = 355;
  const haalandActual = provider.getActualPoints(haalandId, gw);
  const haalandXp = oracle.getXP(haalandId, gw);
  console.log(`\nHaaland (ID: ${haalandId}): Actual=${haalandActual}, XP=${haalandXp}`);
}

debugSquadSelection().catch(err => {
  console.error(err);
  process.exit(1);
});