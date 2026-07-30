import fs from 'fs';
import path from 'path';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { ProjectionEngine } from '../api/_lib/projection.js';
import { loadWeights } from '../api/_lib/weights-loader.js';

async function runUncertainty() {
  const season = '2023-24';
  const provider = new VaastavProvider();
  await provider.loadSeason(season);
  const params = loadWeights('es-v001');

  const startGw = 1;
  const endGw = 34;

  let count1Sigma = 0;
  let count2Sigma = 0;
  let totalValid = 0;
  let sumIntervalWidth = 0;

  for (let gw = startGw; gw <= endGw; gw++) {
    const snapshot = provider.getDeadlineSnapshot(gw, 1000, 0, {});
    const engine = new ProjectionEngine(snapshot, params);
    const oracle = engine.getOracle();

    const validPlayers = oracle.getAllPlayerIds().filter(id => oracle.getCost(id) > 0);

    for (const id of validPlayers) {
      const xp = oracle.getXP(id, gw);
      // We only care about uncertainty for players with meaningful projection > 1.0 (avoids bench fodder skewing it)
      if (xp < 1.0) continue;

      const actual = provider.getActualPoints(id, gw);
      const dist = oracle.getDistribution(id, gw);
      const stdDev = Math.sqrt(dist.variance);
      
      sumIntervalWidth += (2 * stdDev);
      
      if (actual >= xp - stdDev && actual <= xp + stdDev) {
        count1Sigma++;
      }
      if (actual >= xp - (2 * stdDev) && actual <= xp + (2 * stdDev)) {
        count2Sigma++;
      }
      totalValid++;
    }
  }

  const coverage1Sigma = count1Sigma / totalValid;
  const coverage2Sigma = count2Sigma / totalValid;
  const avgWidth = sumIntervalWidth / totalValid;

  console.log("=== UNCERTAINTY CALIBRATION ===");
  console.log(`Evaluated ${totalValid} meaningful predictions (XP > 1.0)`);
  console.log(`\n-- 1 Sigma Coverage (Expected ~68%) --`);
  console.log(`Observed: ${(coverage1Sigma * 100).toFixed(1)}%`);
  if (coverage1Sigma < 0.6) console.log(`Diagnosis: Overconfident (intervals are too narrow)`);
  else if (coverage1Sigma > 0.75) console.log(`Diagnosis: Underconfident (intervals are too wide)`);
  else console.log(`Diagnosis: Well-calibrated`);

  console.log(`\n-- 2 Sigma Coverage (Expected ~95%) --`);
  console.log(`Observed: ${(coverage2Sigma * 100).toFixed(1)}%`);
  
  console.log(`\n-- Sharpness --`);
  console.log(`Average Interval Width (±1σ): ${avgWidth.toFixed(2)} points`);
}

runUncertainty().catch(console.error);
