import fs from 'fs';
import path from 'path';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import {  ProjectionEngine , HistoricalOracle } from '../api/_lib/projection.js';
import { loadWeights } from '../api/_lib/weights-loader.js';

async function runCalibration() {
  const season = '2023-24';
  const provider = new VaastavProvider();
  await provider.loadSeason(season);
  const params = loadWeights('es-v001');

  const startGw = 1;
  const endGw = 34;

  const buckets = [
    { label: '0.0 - 1.0', min: 0.0, max: 1.0, count: 0, sumXp: 0, sumActual: 0 },
    { label: '1.0 - 2.0', min: 1.0, max: 2.0, count: 0, sumXp: 0, sumActual: 0 },
    { label: '2.0 - 3.0', min: 2.0, max: 3.0, count: 0, sumXp: 0, sumActual: 0 },
    { label: '3.0 - 4.0', min: 3.0, max: 4.0, count: 0, sumXp: 0, sumActual: 0 },
    { label: '4.0 - 6.0', min: 4.0, max: 6.0, count: 0, sumXp: 0, sumActual: 0 },
    { label: '6.0 - 8.0', min: 6.0, max: 8.0, count: 0, sumXp: 0, sumActual: 0 },
    { label: '8.0+', min: 8.0, max: 99.0, count: 0, sumXp: 0, sumActual: 0 }
  ];

  for (let gw = startGw; gw <= endGw; gw++) {
    const snapshot = provider.getDeadlineSnapshot(gw, 1000, 0, {});
    const engine = new ProjectionEngine(params);
    const oracle = new HistoricalOracle(snapshot, engine);

    const validPlayers = oracle.getAllPlayerIds().filter(id => oracle.getCost(id) > 0);

    for (const id of validPlayers) {
      const xp = oracle.getXP(id, gw);
      const actual = provider.getActualPoints(id, gw);
      
      const bucket = buckets.find(b => xp >= b.min && xp < b.max);
      if (bucket) {
        bucket.count++;
        bucket.sumXp += xp;
        bucket.sumActual += actual;
      }
    }
  }

  const outDir = path.resolve(process.cwd(), 'data', 'diagnostics');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const csvHeader = 'bucket,n,mean_xp,mean_actual\n';
  const csvRows = buckets.map(b => `${b.label},${b.count},${(b.sumXp / b.count || 0).toFixed(2)},${(b.sumActual / b.count || 0).toFixed(2)}`).join('\n');
  fs.writeFileSync(path.resolve(outDir, 'calibration.csv'), csvHeader + csvRows);

  console.log("=== CALIBRATION CURVES ===");
  console.log(`| Bucket    | N      | Mean XP | Mean Actual |`);
  console.log(`|-----------|--------|---------|-------------|`);
  buckets.forEach(b => {
    const meanXp = (b.sumXp / b.count || 0).toFixed(2);
    const meanActual = (b.sumActual / b.count || 0).toFixed(2);
    console.log(`| ${b.label.padEnd(9)} | ${b.count.toString().padEnd(6)} | ${meanXp.padEnd(7)} | ${meanActual.padEnd(11)} |`);
  });
}

runCalibration().catch(console.error);
