import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import {  ProjectionEngine , HistoricalOracle } from '../api/_lib/projection.js';
import { loadWeights } from '../api/_lib/weights-loader.js';

async function runMinutesDiagnostics() {
  const season = '2023-24';
  const provider = new VaastavProvider();
  await provider.loadSeason(season);
  const params = loadWeights('es-v001');

  const startGw = 1;
  const endGw = 34;

  let totalSqErr = 0;
  let totalAbsErr = 0;
  let count = 0;

  // Classifications
  let playedCorrect = 0;
  let playedTotal = 0;
  
  let startedCorrect = 0; // >60 mins
  let startedTotal = 0;

  let played90Correct = 0;
  let played90Total = 0;

  for (let gw = startGw; gw <= endGw; gw++) {
    const snapshot = provider.getDeadlineSnapshot(gw, 1000, 0, {});
    const engine = new ProjectionEngine(params);
    const oracle = new HistoricalOracle(snapshot, engine);

    const validPlayers = oracle.getAllPlayerIds().filter(id => oracle.getCost(id) > 0);

    for (const id of validPlayers) {
      // Only track active players (where the model bothered giving them > 5% chance of playing)
      const expMins = snapshot.players[id].predictedMinutes;
      if (expMins < 5) continue; 

      const gwMatches = (provider as any).gwDataByPlayer[id]?.[gw] || [];
      const actualMins = gwMatches.reduce((acc: number, m: any) => acc + parseInt(m.minutes || 0), 0);

      totalSqErr += Math.pow(expMins - actualMins, 2);
      totalAbsErr += Math.abs(expMins - actualMins);
      count++;

      // Played classification (Threshold > 0)
      const expPlayed = expMins >= 45; 
      const actPlayed = actualMins > 0;
      if (expPlayed === actPlayed) playedCorrect++;
      playedTotal++;

      // Started classification (Threshold > 60)
      const expStarted = expMins >= 60;
      const actStarted = actualMins >= 60;
      if (expStarted === actStarted) startedCorrect++;
      startedTotal++;

      // Full 90 classification
      const exp90 = expMins >= 80; // A 90m player's expMins might be 82 if 10% chance of sub
      const act90 = actualMins >= 90;
      if (exp90 === act90) played90Correct++;
      played90Total++;
    }
  }

  const rmse = Math.sqrt(totalSqErr / count);
  const mae = totalAbsErr / count;

  console.log("=== EXPECTED MINUTES BENCHMARK ===");
  console.log(`Evaluated ${count} active player records across ${season}\n`);
  
  console.log(`-- Continuous Metrics --`);
  console.log(`Minutes RMSE: ${rmse.toFixed(2)} mins`);
  console.log(`Minutes MAE:  ${mae.toFixed(2)} mins`);

  console.log(`\n-- Classification Accuracy --`);
  console.log(`Played vs Didn't Play: ${((playedCorrect / playedTotal) * 100).toFixed(1)}%`);
  console.log(`Started (60+)        : ${((startedCorrect / startedTotal) * 100).toFixed(1)}%`);
  console.log(`Full Match (90)      : ${((played90Correct / played90Total) * 100).toFixed(1)}%`);
  
}

runMinutesDiagnostics().catch(console.error);
