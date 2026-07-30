import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { listAvailableWeights } from '../api/_lib/weights-loader.js';
import { evaluateModel } from './evaluate-model.js';

async function runBenchmarks() {
  console.log("=== FPL OPTIMIZER BENCHMARK SUITE ===\n");
  
  const models = listAvailableWeights();
  const trainSeasons = ['2021-22', '2022-23'];
  const testSeason = '2023-24';
  
  const results: any[] = [];
  
  for (const model of models) {
    console.log(`Evaluating Model: ${model}`);
    
    // 1. Train Evaluation
    let trainRMSE = 0, trainNdcgCap = 0, trainNdcgXI = 0, trainNdcgTrans = 0;
    for (const season of trainSeasons) {
      console.log(`  -> Projection eval on Train: ${season}`);
      const res = await evaluateModel(model, season);
      trainRMSE += res.rmse;
      trainNdcgCap += res.ndcgCapt;
      trainNdcgXI += res.ndcgXI;
      trainNdcgTrans += res.ndcgTrans;
    }
    
    // Average train metrics
    const tCount = trainSeasons.length;
    trainRMSE /= tCount;
    trainNdcgCap /= tCount;
    trainNdcgXI /= tCount;
    trainNdcgTrans /= tCount;
    
    // 2. Validation Evaluation
    console.log(`  -> Projection eval on Validation: ${testSeason}`);
    const valRes = await evaluateModel(model, testSeason);
    
    // 3. Simulator Evaluation (Test Season)
    console.log(`  -> Simulator eval on Validation: ${testSeason}`);
    const backtestCmd = `npx tsx scripts/run-backtest.ts --weights ${model}`;
    try {
      execSync(backtestCmd, { stdio: 'pipe' });
    } catch (e: any) {
      console.error(`Backtest failed for ${model}: ${e.message}`);
      continue;
    }
    
    // 4. Parse Simulator Results
    const runFilePath = path.resolve(process.cwd(), 'backtests', testSeason, `run-${model}.json`);
    let simPts = 0, simHits = 0, simSquadValue = 0, simCapRegret = 0, simBenchLost = 0;
    
    if (fs.existsSync(runFilePath)) {
      const runLog = JSON.parse(fs.readFileSync(runFilePath, 'utf8'));
      simPts = runLog.finalScore;
      simHits = runLog.totalHits;
      simSquadValue = runLog.terminalSquadValue;
      
      let optCap = 0;
      let actualCap = 0;
      let benchLost = 0;
      runLog.gameweeks.forEach((gw: any) => {
        // Calculate oracle optimal cap points for regret (best in XI * 2)
        // Note: For full accuracy we'd need actual best, but we can approximate or use gw.diagnostics
        if (gw.diagnostics) {
           optCap += gw.diagnostics.bestCaptainXp;
           actualCap += gw.diagnostics.chosenCaptainXp;
        }
        if (gw.bench) benchLost += gw.bench.points;
      });
      simCapRegret = optCap - actualCap; // XP Regret
      simBenchLost = benchLost;
    } else {
      console.error(`Could not find backtest output for ${model}`);
    }
    
    results.push({
      model,
      trainRMSE,
      valRMSE: valRes.rmse,
      gap: valRes.rmse - trainRMSE,
      trainNdcgCap,
      valNdcgCap: valRes.ndcgCapt,
      trainNdcgXI,
      valNdcgXI: valRes.ndcgXI,
      trainNdcgTrans,
      valNdcgTrans: valRes.ndcgTrans,
      simPts,
      simHits,
      simSquadValue,
      simCapRegret,
      simBenchLost
    });
  }
  
  // Sort by Validation RMSE (ascending)
  results.sort((a, b) => a.valRMSE - b.valRMSE);
  
  // Output Markdown Table
  console.log("\n## Benchmark Results\n");
  console.log(`| Model | Train RMSE | Val RMSE | Gap | Val Cap NDCG | Val XI NDCG | Val Trans NDCG | Sim Pts | Hits | Final Value | Cap XP Regret | Bench Lost |`);
  console.log(`|-------|------------|----------|-----|--------------|-------------|----------------|---------|------|-------------|---------------|------------|`);
  
  for (const r of results) {
    console.log(
      `| ${r.model.padEnd(5)} | ` +
      `${r.trainRMSE.toFixed(2).padEnd(10)} | ` +
      `${r.valRMSE.toFixed(2).padEnd(8)} | ` +
      `${(r.gap > 0 ? '+' : '')}${r.gap.toFixed(2).padEnd(3)} | ` +
      `${r.valNdcgCap.toFixed(2).padEnd(12)} | ` +
      `${r.valNdcgXI.toFixed(2).padEnd(11)} | ` +
      `${r.valNdcgTrans.toFixed(2).padEnd(14)} | ` +
      `${r.simPts.toString().padEnd(7)} | ` +
      `${r.simHits.toString().padEnd(4)} | ` +
      `£${r.simSquadValue.toFixed(1).padEnd(10)} | ` +
      `${r.simCapRegret.toFixed(1).padEnd(13)} | ` +
      `${r.simBenchLost.toString().padEnd(10)} |`
    );
  }
}

runBenchmarks().catch(console.error);
