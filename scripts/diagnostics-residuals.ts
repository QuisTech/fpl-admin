import fs from 'fs';
import path from 'path';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { ProjectionEngine } from '../api/_lib/projection.js';
import { loadWeights } from '../api/_lib/weights-loader.js';

async function runResiduals() {
  const season = '2023-24';
  const provider = new VaastavProvider();
  await provider.loadSeason(season);
  const params = loadWeights('es-v001');

  const startGw = 1;
  const endGw = 34;

  const outDir = path.resolve(process.cwd(), 'data', 'diagnostics');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.resolve(outDir, 'residuals.csv');
  const file = fs.createWriteStream(outPath);
  
  // Headers
  file.write('gw,playerId,playerName,position,price,team,opponent,wasHome,fixtureDifficulty,expMins,actualMins,predicted,actual,residual,variance,rollingForm\n');

  let rowCount = 0;

  for (let gw = startGw; gw <= endGw; gw++) {
    const snapshot = provider.getDeadlineSnapshot(gw, 1000, 0, {});
    const engine = new ProjectionEngine(snapshot, params);
    const oracle = engine.getOracle();

    const validPlayers = oracle.getAllPlayerIds().filter(id => oracle.getCost(id) > 0);

    for (const id of validPlayers) {
      const xp = oracle.getXP(id, gw);
      const actual = provider.getActualPoints(id, gw);
      const residual = xp - actual; // Positive = Overpredicted, Negative = Underpredicted
      
      const distribution = oracle.getDistribution(id, gw);
      const variance = distribution.variance;

      const playerMetadata = snapshot.players[id];
      if (!playerMetadata) continue;

      const position = playerMetadata.position;
      const price = playerMetadata.price;
      const team = playerMetadata.team;
      const playerName = playerMetadata.name.replace(/,/g, ''); 

      // Extract specific GW matching data
      const gwMatches = (provider as any).gwDataByPlayer[id]?.[gw] || [];
      const actualMins = gwMatches.reduce((acc: number, m: any) => acc + parseInt(m.minutes || 0), 0);
      const wasHome = gwMatches.length > 0 ? (gwMatches[0].was_home === 'True' || gwMatches[0].was_home === true ? 1 : 0) : '';
      const opponent = gwMatches.length > 0 ? gwMatches[0].opponent_team : '';
      const expMins = oracle.getExpectedMinutes(id, gw);

      // We don't have rolling form readily available in oracle without some custom logic,
      // but we can extract it from provider raw data if needed. Using placeholder for now.
      const rollingForm = (playerMetadata as any).form || 0; 
      const fixtureDifficulty = 3; // Placeholder since we don't expose FDR directly in oracle easily yet.

      const row = `${gw},${id},${playerName},${position},${price},${team},${opponent},${wasHome},${fixtureDifficulty},${expMins.toFixed(1)},${actualMins},${xp.toFixed(2)},${actual},${residual.toFixed(2)},${variance.toFixed(2)},${rollingForm}\n`;
      file.write(row);
      rowCount++;
    }
  }

  file.end();
  console.log(`=== RESIDUAL DIAGNOSTICS ===`);
  console.log(`Wrote ${rowCount} records to ${outPath}`);
}

runResiduals().catch(console.error);
