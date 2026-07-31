import fs from 'fs';
import path from 'path';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import {  ProjectionEngine , HistoricalOracle } from '../api/_lib/projection.js';
import { loadWeights } from '../api/_lib/weights-loader.js';

async function runTaxonomy() {
  const season = '2023-24';
  const provider = new VaastavProvider();
  await provider.loadSeason(season);
  const params = loadWeights('es-v001');

  const startGw = 1;
  const endGw = 34;

  const taxonomy = {
    'Rotation / Benched': 0,
    'Injury / Availability': 0,
    'Suspension / Red card': 0,
    'Early substitution': 0,
    'Finishing variance': 0,
    'Assist variance': 0,
    'Clean sheet variance': 0,
    'Bonus point variance': 0,
    'Unknown': 0
  };

  const taxonomyDetails: any[] = [];

  for (let gw = startGw; gw <= endGw; gw++) {
    const snapshot = provider.getDeadlineSnapshot(gw, 1000, 0, {});
    const engine = new ProjectionEngine(params);
    const oracle = new HistoricalOracle(snapshot, engine);

    // Look at top players by XP to find impactful errors
    const validPlayers = oracle.getAllPlayerIds().filter(id => oracle.getCost(id) > 0);
    validPlayers.sort((a, b) => oracle.getXP(b, gw) - oracle.getXP(a, gw));
    
    // Only care about top 100 players this GW for taxonomy to avoid noise from 4.0m bench fodder
    const topPlayers = validPlayers.slice(0, 100);

    for (const id of topPlayers) {
      const xp = oracle.getXP(id, gw);
      const actual = provider.getActualPoints(id, gw);
      const diff = actual - xp;
      
      if (Math.abs(diff) > 3) {
        // Significant error, categorize it
        const pModel = (engine as any).subModels; // Access sub-models directly to see expectations
        const expMins = snapshot.players[id].predictedMinutes;
        
        // We have to peek at actual data
        const gwMatches = (provider as any).gwDataByPlayer[id]?.[gw] || [];
        const actualMins = gwMatches.reduce((acc: number, m: any) => acc + parseInt(m.minutes || 0), 0);
        const actualGoals = gwMatches.reduce((acc: number, m: any) => acc + parseInt(m.goals_scored || 0), 0);
        const actualAssists = gwMatches.reduce((acc: number, m: any) => acc + parseInt(m.assists || 0), 0);
        const actualBonus = gwMatches.reduce((acc: number, m: any) => acc + parseInt(m.bonus || 0), 0);
        const actualCS = gwMatches.reduce((acc: number, m: any) => acc + parseInt(m.clean_sheets || 0), 0);
        const redCards = gwMatches.reduce((acc: number, m: any) => acc + parseInt(m.red_cards || 0), 0);

        // Previous GW info for heuristics
        const prevMatches = (provider as any).gwDataByPlayer[id]?.[gw - 1] || [];
        const prevMins = prevMatches.reduce((acc: number, m: any) => acc + parseInt(m.minutes || 0), 0);
        const prevRC = prevMatches.reduce((acc: number, m: any) => acc + parseInt(m.red_cards || 0), 0);
        
        // Expected detailed stats are harder to extract directly if they are combined into xP, 
        // but we can infer based on the largest contributor to the point difference.
        
        let category = 'Unknown';
        let confidence = 'Low';

        if (expMins > 60 && actualMins === 0) {
          if (prevRC > 0) {
            category = 'Suspension / Red card';
            confidence = 'High';
          } else if (prevMins === 0 && gw > 1) {
            category = 'Injury / Availability';
            confidence = 'Medium';
          } else {
            category = 'Rotation / Benched';
            confidence = 'Low';
          }
        } else if (expMins > 60 && actualMins > 0 && actualMins < 45) {
          category = 'Early substitution';
          confidence = 'High';
        } else if (redCards > 0) {
          category = 'Suspension / Red card';
          confidence = 'High';
        } else {
          // It's variance-based. Which variance is biggest?
          // Rough heuristic of points missed
          const ptMins = expMins > 60 && actualMins < 60 ? 1 : 0;
          
          // Let's use simple magnitude rules.
          if (Math.abs(actualGoals * 4 - xp * 0.4) > 3) category = 'Finishing variance';
          else if (Math.abs(actualAssists * 3 - xp * 0.2) > 2) category = 'Assist variance';
          else if (Math.abs(actualCS * 4 - xp * 0.3) > 2.5) category = 'Clean sheet variance';
          else if (Math.abs(actualBonus - xp * 0.1) > 2) category = 'Bonus point variance';
        }

        taxonomy[category as keyof typeof taxonomy]++;
        
        taxonomyDetails.push({
          gw,
          playerId: id,
          xp: xp.toFixed(2),
          actual,
          diff: diff.toFixed(2),
          category,
          confidence,
          expMins: expMins.toFixed(0),
          actualMins
        });
      }
    }
  }

  const outDir = path.resolve(process.cwd(), 'data', 'diagnostics');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const csvHeader = 'gw,playerId,xp,actual,diff,category,confidence,expMins,actualMins\n';
  const csvRows = taxonomyDetails.map(d => `${d.gw},${d.playerId},${d.xp},${d.actual},${d.diff},${d.category},${d.confidence},${d.expMins},${d.actualMins}`).join('\n');
  fs.writeFileSync(path.resolve(outDir, 'taxonomy.csv'), csvHeader + csvRows);

  console.log("=== ERROR TAXONOMY ===");
  Object.entries(taxonomy).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`${k.padEnd(25)}: ${v}`);
  });
}

runTaxonomy().catch(console.error);
