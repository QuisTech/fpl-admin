import fs from 'fs';
import path from 'path';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { ProjectionEngine, UtilityParameters, HistoricalOracle } from '../api/_lib/projection.js';
import { loadWeights } from '../api/_lib/weights-loader.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEASONS = ['2021-22', '2022-23', '2023-24'];

async function loadDatasets(seasons: string[]): Promise<Record<string, VaastavProvider>> {
  const providers: Record<string, VaastavProvider> = {};
  for (const s of seasons) {
    const p = new VaastavProvider();
    await p.loadSeason(s);
    providers[s] = p;
  }
  return providers;
}

function computeAUC(predictions: number[], labels: number[]): number {
  const combined = predictions.map((p, i) => ({ p, l: labels[i] })).sort((a, b) => b.p - a.p);
  let numPos = labels.filter(l => l === 1).length;
  let numNeg = labels.length - numPos;
  if (numPos === 0 || numNeg === 0) return 0.5;

  let sumRanks = 0;
  for (let i = 0; i < combined.length; i++) {
    if (combined[i].l === 1) {
      sumRanks += (combined.length - i);
    }
  }
  const auc = (sumRanks - (numPos * (numPos + 1)) / 2) / (numPos * numNeg);
  return auc;
}

function computeNDCG(predictedScores: number[], actualPoints: number[], topK: number): number {
  if (predictedScores.length === 0) return 0;
  const minPoints = Math.min(...actualPoints);
  const rel = actualPoints.map(p => p - minPoints);
  const combined = predictedScores.map((p, i) => ({ p, r: rel[i] }));
  
  combined.sort((a, b) => b.p - a.p);
  let dcg = 0;
  for (let i = 0; i < Math.min(topK, combined.length); i++) {
    dcg += (Math.pow(2, combined[i].r) - 1) / Math.log2(i + 2);
  }
  
  const ideal = [...combined].sort((a, b) => b.r - a.r);
  let idcg = 0;
  for (let i = 0; i < Math.min(topK, ideal.length); i++) {
    idcg += (Math.pow(2, ideal[i].r) - 1) / Math.log2(i + 2);
  }
  
  if (idcg === 0) return 0;
  return dcg / idcg;
}

function computeTop50Precision(predictedScores: number[], actualPoints: number[]): number {
  if (predictedScores.length < 50) return 0;
  const combinedWithId = predictedScores.map((p, i) => ({ id: i, p, a: actualPoints[i] }));
  const pTop50 = new Set([...combinedWithId].sort((a,b) => b.p - a.p).slice(0, 50).map(x => x.id));
  const aTop50 = new Set([...combinedWithId].sort((a,b) => b.a - a.a).slice(0, 50).map(x => x.id));
  
  let intersection = 0;
  for (const id of pTop50) {
    if (aTop50.has(id)) intersection++;
  }
  return intersection / 50;
}

interface ComponentMetrics {
  rmse: number;
  mae: number;
  bias: number;
  brier?: number;
  auc?: number;
}

async function runEvaluation() {
  console.log(`Loading datasets: ${SEASONS.join(', ')}...`);
  const providers = await loadDatasets(SEASONS);
  
  let params: UtilityParameters;
  try {
    params = loadWeights('baseline');
  } catch (e) {
    console.error("Failed to load baseline weights. Make sure stage 2 is complete.");
    process.exit(1);
  }

  // We only run deep dive on the validation season, but keep RMSE tracking for drift
  const valSeason = '2023-24';
  const valProvider = providers[valSeason];

  // Component tracking
  let minPred = [], minAct = [];
  let attPred = [], attAct = [];
  let csProbPred = [], csAct = [];
  let bonPred = [], bonAct = [];
  let overallPred = [], overallAct = [];
  
  // Weekly tracking for NDCG
  const weeklyPredictions: number[][] = [];
  const weeklyActuals: number[][] = [];

  // Calibration buckets (0-10%, 10-20%...)
  const calibBuckets = Array(10).fill(0).map(() => ({ total: 0, cs: 0 }));

  // Seasonal drift tracking
  const driftRMSE: Record<string, number> = {};
  
  // Feature standard deviation tracking
  const featureVals: Record<string, number[]> = {
    betaAttackBase: [], betaXG: [], betaXA: [], betaXGI3: [], betaXGI5: [],
    betaAttFixture: [], betaTeamAttack: [], betaOppDefense: [], betaAttHome: [],
    betaCsBase: [], betaTeamDefense: [], betaOppAttack: [], betaCsFixture: [], betaCsHome: [],
    betaBonusBase: [], betaBpsBaseline: []
  };

  // Total xP calibration tracking
  const xpCalibBuckets = [
    { label: '0-2', min: 0, max: 2, totalPred: 0, totalAct: 0, count: 0 },
    { label: '2-4', min: 2, max: 4, totalPred: 0, totalAct: 0, count: 0 },
    { label: '4-6', min: 4, max: 6, totalPred: 0, totalAct: 0, count: 0 },
    { label: '6-8', min: 6, max: 8, totalPred: 0, totalAct: 0, count: 0 },
    { label: '8-10', min: 8, max: 10, totalPred: 0, totalAct: 0, count: 0 },
    { label: '10+', min: 10, max: 999, totalPred: 0, totalAct: 0, count: 0 }
  ];

  for (const season of SEASONS) {
    const provider = providers[season];
    let sSqErr = 0, sCount = 0;
    
    for (let gw = 1; gw <= 38; gw++) {
      let snapshot;
      try {
        snapshot = provider.getDeadlineSnapshot(gw, 1000, 0, {});
      } catch (e) { continue; }
      if (!snapshot) continue;
      
      const engine = new ProjectionEngine(params);
      const oracle = new HistoricalOracle(snapshot, engine);
      const validPlayers = oracle.getAllPlayerIds().filter(id => oracle.getCost(id) > 0);

      const gwPred: number[] = [];
      const gwAct: number[] = [];

      for (const id of validPlayers) {
        oracle.getXP(id, gw);
        
        const player = snapshot.players[id];
        const actualMinsRecords = provider.gwDataByPlayer[id]?.[gw] || [];
        const actualMins = actualMinsRecords.reduce((acc: number, m: any) => acc + parseInt(m.minutes || 0), 0);
        
        const predictedMins = player.predictedMinutes || 0;
        const actualPts = provider.getActualPoints(id, gw);
        
        // Save overall points (expected vs actual)
        let totalXp = 0;
        const fixtures = player.fixturesByGw?.[gw] || [];
        if (fixtures.length > 0) {
          totalXp = oracle.getXP(id, gw);
        }
        
        if (season === valSeason) {
          gwPred.push(totalXp);
          gwAct.push(actualPts);
          
          if (actualMins >= 45 && fixtures.length > 0) {
            overallPred.push(totalXp);
            overallAct.push(actualPts);
            
            // Minutes
            minPred.push(predictedMins);
            minAct.push(actualMins);
            
            const minuteFraction = actualMins / 90;
            
            // Submodels evaluate independent of predicted minutes
            let expectedAttackSum = 0;
            let expectedCsProbSum = 0;
            let expectedBonusSum = 0;
            
            fixtures.forEach(fix => {
              const isHome = fix.isHome ? 1 : 0;
              const fixtureDiff = fix.difficulty;
              const oppDefense = fix.opponentStrengthDefense; 
              const oppAttack = fix.opponentStrengthAttack;
              
              if (season === valSeason) {
                featureVals.betaAttackBase.push(1);
                featureVals.betaXG.push(player.xG90 || 0);
                featureVals.betaXA.push(player.xA90 || 0);
                featureVals.betaXGI3.push(player.xGI3 || 0);
                featureVals.betaXGI5.push(player.xGI5 || 0);
                featureVals.betaAttFixture.push(fixtureDiff);
                featureVals.betaTeamAttack.push(1.5);
                featureVals.betaOppDefense.push(oppDefense);
                featureVals.betaAttHome.push(isHome);
                
                featureVals.betaCsBase.push(1);
                featureVals.betaTeamDefense.push(1.5);
                featureVals.betaOppAttack.push(oppAttack);
                featureVals.betaCsFixture.push(fixtureDiff);
                featureVals.betaCsHome.push(isHome);
                
                featureVals.betaBonusBase.push(1);
              }
              
              let expectedAttack = params.betaAttackBase 
                + params.betaXG * (player.xG90 || 0)
                + params.betaXA * (player.xA90 || 0)
                + params.betaXGI3 * (player.xGI3 || 0)
                + params.betaXGI5 * (player.xGI5 || 0)
                + params.betaAttFixture * fixtureDiff
                + params.betaTeamAttack * 1.5 
                + params.betaOppDefense * oppDefense
                + params.betaAttHome * isHome;
              expectedAttackSum += Math.max(0, expectedAttack) * minuteFraction;
              
              let expectedCsProb = params.betaCsBase
                + params.betaTeamDefense * 1.5 
                + params.betaOppAttack * oppAttack
                + params.betaCsFixture * fixtureDiff
                + params.betaCsHome * isHome;
              expectedCsProb = Math.max(0, Math.min(1, expectedCsProb));
              expectedCsProbSum += expectedCsProb; // Raw probability!
              
              let expectedBonus = Math.max(0, params.betaBonusBase + params.betaBpsBaseline * (expectedAttackSum / 3));
              expectedBonusSum += expectedBonus * minuteFraction;
            });
            
            const actAtt = provider.getActualAttackPoints(id, gw);
            attPred.push(expectedAttackSum);
            attAct.push(actAtt);
            
            // For CS, just use the first fixture's CS indicator (double GWs will slightly skew but it's fine)
            const actCsInd = provider.getCleanSheetIndicator(id, gw);
            const prob = expectedCsProbSum / fixtures.length;
            csProbPred.push(prob);
            csAct.push(actCsInd);
            
            const bIdx = Math.min(9, Math.floor(prob * 10));
            calibBuckets[bIdx].total++;
            if (actCsInd > 0) calibBuckets[bIdx].cs++;
            
            const actBon = provider.getActualBonusPoints(id, gw);
            bonPred.push(expectedBonusSum);
            bonAct.push(actBon);
            
            if (season === valSeason) {
               featureVals.betaBpsBaseline.push(expectedAttackSum / 3);
            }
          }
          
          if (season === valSeason) {
             const bucket = xpCalibBuckets.find(b => totalXp >= b.min && totalXp < b.max) || xpCalibBuckets[xpCalibBuckets.length-1];
             bucket.totalPred += totalXp;
             bucket.totalAct += actualPts;
             bucket.count++;
          }
        }
        
        sSqErr += Math.pow(totalXp - actualPts, 2);
        sCount++;
      }
      
      if (season === valSeason && gwPred.length > 50) {
        weeklyPredictions.push(gwPred);
        weeklyActuals.push(gwAct);
      }
    }
    
    driftRMSE[season] = Math.sqrt(sSqErr / sCount);
  }

  // --- Calculate Metrics ---
  const calcRMSE = (p: number[], a: number[]) => Math.sqrt(p.reduce((acc, v, i) => acc + Math.pow(v - a[i], 2), 0) / p.length);
  const calcMAE = (p: number[], a: number[]) => p.reduce((acc, v, i) => acc + Math.abs(v - a[i]), 0) / p.length;
  const calcBias = (p: number[], a: number[]) => p.reduce((acc, v, i) => acc + (v - a[i]), 0) / p.length;
  
  const metrics = {
    minutes: {
      rmse: calcRMSE(minPred, minAct),
      mae: calcMAE(minPred, minAct),
      bias: calcBias(minPred, minAct)
    },
    attack: {
      rmse: calcRMSE(attPred, attAct),
      mae: calcMAE(attPred, attAct),
      bias: calcBias(attPred, attAct)
    },
    bonus: {
      rmse: calcRMSE(bonPred, bonAct),
      mae: calcMAE(bonPred, bonAct),
      bias: calcBias(bonPred, bonAct)
    },
    cs: {
      auc: computeAUC(csProbPred, csAct),
      brier: csProbPred.reduce((acc, p, i) => acc + Math.pow(p - csAct[i], 2), 0) / csProbPred.length
    },
    overall: {
      rmse: calcRMSE(overallPred, overallAct),
      mae: calcMAE(overallPred, overallAct),
      bias: calcBias(overallPred, overallAct)
    },
    ranking: {
      captain: weeklyPredictions.reduce((acc, p, i) => acc + computeNDCG(p, weeklyActuals[i], 5), 0) / weeklyPredictions.length,
      xi: weeklyPredictions.reduce((acc, p, i) => acc + computeNDCG(p, weeklyActuals[i], 11), 0) / weeklyPredictions.length,
      transfer: weeklyPredictions.reduce((acc, p, i) => acc + computeNDCG(p, weeklyActuals[i], 30), 0) / weeklyPredictions.length,
      top50: weeklyPredictions.reduce((acc, p, i) => acc + computeTop50Precision(p, weeklyActuals[i]), 0) / weeklyPredictions.length
    }
  };

  // --- Quality Gate ---
  let pass = true;
  const historyPath = path.resolve(__dirname, '../api/_lib/weights/metrics-history.json');
  let prevMetrics = null;
  const gateResults: string[] = [];
  
  if (fs.existsSync(historyPath)) {
    prevMetrics = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    
    const evaluateGate = (name: string, current: number, prev: number, higherIsBetter: boolean) => {
      let isRegress = higherIsBetter ? (current < prev * 0.98) : (current > prev * 1.02);
      if (isRegress) {
         pass = false;
         gateResults.push(`❌ ${name} worsened (${prev.toFixed(3)} -> ${current.toFixed(3)})`);
      } else {
         gateResults.push(`✅ ${name}`);
      }
    };
    
    evaluateGate("Minutes RMSE", metrics.minutes.rmse, prevMetrics.minutes.rmse, false);
    evaluateGate("Attack RMSE", metrics.attack.rmse, prevMetrics.attack.rmse, false);
    evaluateGate("Clean Sheet AUC", metrics.cs.auc, prevMetrics.cs.auc, true);
    evaluateGate("Ranking Captain NDCG", metrics.ranking.captain, prevMetrics.ranking.captain, true);
    evaluateGate("Overall RMSE", metrics.overall.rmse, prevMetrics.overall.rmse, false);
  } else {
    gateResults.push("✅ Initial Run - All gates pass by default.");
  }

  // Save new history
  fs.writeFileSync(historyPath, JSON.stringify(metrics, null, 2));

  // --- Print Dashboard ---
  console.log(`\n=============================`);
  console.log(`FPL HORIZON ENGINE REPORT`);
  console.log(`Validation Season: ${valSeason}`);
  console.log(`=============================`);
  
  console.log(`\nMINUTES`);
  console.log(`RMSE ............. ${metrics.minutes.rmse.toFixed(2)}`);
  console.log(`MAE .............. ${metrics.minutes.mae.toFixed(2)}`);
  console.log(`Bias ............. ${metrics.minutes.bias > 0 ? '+' : ''}${metrics.minutes.bias.toFixed(2)}`);

  console.log(`\nATTACK`);
  console.log(`RMSE ............. ${metrics.attack.rmse.toFixed(2)}`);
  console.log(`MAE .............. ${metrics.attack.mae.toFixed(2)}`);
  console.log(`Bias ............. ${metrics.attack.bias > 0 ? '+' : ''}${metrics.attack.bias.toFixed(2)}`);

  console.log(`\nCLEAN SHEET`);
  console.log(`AUC .............. ${metrics.cs.auc.toFixed(3)}`);
  console.log(`Brier ............ ${metrics.cs.brier.toFixed(3)}`);

  console.log(`\nBONUS`);
  console.log(`RMSE ............. ${metrics.bonus.rmse.toFixed(2)}`);
  console.log(`MAE .............. ${metrics.bonus.mae.toFixed(2)}`);
  
  console.log(`\nOVERALL`);
  console.log(`RMSE ............. ${metrics.overall.rmse.toFixed(2)}`);
  console.log(`MAE .............. ${metrics.overall.mae.toFixed(2)}`);
  console.log(`Bias ............. ${metrics.overall.bias > 0 ? '+' : ''}${metrics.overall.bias.toFixed(2)}`);

  console.log(`\nRANKING`);
  console.log(`Captain NDCG ..... ${metrics.ranking.captain.toFixed(2)}`);
  console.log(`XI NDCG .......... ${metrics.ranking.xi.toFixed(2)}`);
  console.log(`Transfer NDCG .... ${metrics.ranking.transfer.toFixed(2)}`);
  console.log(`Top50 Precision .. ${metrics.ranking.top50.toFixed(2)}`);

  console.log(`\nCALIBRATION TABLES`);
  console.log(`CS Probability Brier: ${metrics.cs.brier.toFixed(3)}`);
  calibBuckets.forEach((b, i) => {
    if (b.total > 0) {
      const actualPct = (b.cs / b.total) * 100;
      console.log(`${i*10}-${(i+1)*10}% predicted -> Actual ${actualPct.toFixed(1)}% (${b.total} samples)`);
    }
  });
  
  console.log(`\nTOTAL xP CALIBRATION`);
  console.log(`Predicted xP     Actual Avg (Samples)`);
  xpCalibBuckets.forEach(b => {
    if (b.count > 0) {
       console.log(`${b.label.padEnd(16)} ${(b.totalAct / b.count).toFixed(2)} (${b.count})`);
    }
  });
  
  console.log(`\nMODEL DRIFT (OVERALL RMSE)`);
  for (const s of SEASONS) {
    console.log(`${s} .......... ${driftRMSE[s].toFixed(3)}`);
  }

  console.log(`\nFEATURE IMPORTANCE SNAPSHOT (Signed Std)`);
  
  const getStd = (arr: number[]) => {
    if (!arr || arr.length === 0) return 0;
    const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
    return Math.sqrt(arr.reduce((a,b)=>a+Math.pow(b-mean,2),0)/arr.length);
  };
  
  const weights = Object.entries(params).filter(([k,v]) => typeof v === 'number').map(([k,v]) => {
    const std = getStd(featureVals[k] || []);
    // Standardized signed importance = beta * std(feature)
    // If std is 0 (like for base intercepts), just use beta. But user wants drivers.
    const signedImportance = std === 0 ? 0 : (v as number) * std;
    return {k, v: signedImportance};
  }).filter(w => w.v !== 0);
  
  weights.sort((a,b) => b.v - a.v);
  console.log(`Positive Drivers`);
  weights.filter(w => w.v > 0).slice(0, 5).forEach(w => console.log(`+ ${w.k.padEnd(20)} ${w.v.toFixed(3)}`));
  console.log(`\nNegative Drivers`);
  weights.filter(w => w.v < 0).slice(-5).reverse().forEach(w => console.log(`- ${w.k.padEnd(20)} ${w.v.toFixed(3)}`));

  console.log(`\nQUALITY GATE`);
  gateResults.forEach(g => console.log(g));
  
  console.log(`\nFINAL RESULT`);
  if (pass) {
    console.log(`PASS ✅`);
    process.exit(0);
  } else {
    console.log(`FAIL ❌`);
    process.exit(1);
  }
}

runEvaluation().catch(console.error);
