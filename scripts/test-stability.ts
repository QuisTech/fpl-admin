import { loadWeights } from '../api/_lib/weights-loader.js';
const DEFAULT_PARAMETERS = loadWeights('baseline');
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import {  ProjectionEngine, UtilityParameters, HistoricalOracle } from '../api/_lib/projection.js';

function calculateNDCG(predictedScores: number[], actualScores: number[], k: number): number {
  const paired = predictedScores.map((pred, i) => ({ pred, actual: actualScores[i] }));
  paired.sort((a, b) => b.pred - a.pred);
  const dcg = paired.slice(0, k).reduce((sum, item, i) => sum + item.actual / Math.log2(i + 2), 0);
  const ideal = [...actualScores].sort((a, b) => b - a);
  const idcg = ideal.slice(0, k).reduce((sum, score, i) => sum + score / Math.log2(i + 2), 0);
  if (idcg === 0) return 1;
  return dcg / idcg;
}

// Extract the fitness function out of the loop
async function runESCalibration(season: string, seed: number) {
  const provider = new VaastavProvider();
  await provider.loadSeason(season);

  const startGw = 1;
  const endGw = 34; 

  function evaluateFitness(params: UtilityParameters): number {
    let totalRMSE = 0;
    let totalNdcgCapt = 0;
    let totalNdcgXI = 0;
    let totalNdcgTrans = 0;
    let count = 0;
    let count4 = 0;

    for (let gw = startGw; gw <= endGw; gw++) {
      const snapshot = provider.getDeadlineSnapshot(gw, 1000, 0, {});
      const engine = new ProjectionEngine(params);
      const oracle = new HistoricalOracle(snapshot, engine);
      
      const allIds = oracle.getAllPlayerIds();
      const validPlayers = allIds.filter(id => oracle.getCost(id) > 0);
      
      const preds = validPlayers.map(id => oracle.getXP(id, gw));
      const actuals = validPlayers.map(id => provider.getActualPoints(id, gw));
      
      let sqErr = 0;
      for (let i = 0; i < preds.length; i++) {
        sqErr += Math.pow(preds[i] - actuals[i], 2);
      }
      totalRMSE += Math.sqrt(sqErr / preds.length);
      
      totalNdcgCapt += calculateNDCG(preds, actuals, 1);
      totalNdcgXI += calculateNDCG(preds, actuals, 11);
      count++;

      if (gw + 3 <= endGw) {
        const preds4 = validPlayers.map(id => {
          let p = 0;
          for (let i=0; i<4; i++) p += oracle.getXP(id, gw+i);
          return p;
        });
        const actuals4 = validPlayers.map(id => {
          let a = 0;
          for (let i=0; i<4; i++) a += provider.getActualPoints(id, gw+i);
          return a;
        });
        totalNdcgTrans += calculateNDCG(preds4, actuals4, 5); 
        count4++;
      }
    }

    const avgRMSE = totalRMSE / count;
    const avgNdcgCapt = totalNdcgCapt / count;
    const avgNdcgXI = totalNdcgXI / count;
    const avgNdcgTrans = totalNdcgTrans / Math.max(1, count4);

    return 0.40 * (avgRMSE / 5.0) 
         + 0.25 * (1 - avgNdcgCapt) 
         + 0.20 * (1 - avgNdcgXI) 
         + 0.15 * (1 - avgNdcgTrans);
  }

  // Linear congruential generator for seeded randomness
  let currentSeed = seed;
  function random() {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  }

  let bestParams = { ...DEFAULT_PARAMETERS };
  let bestLoss = evaluateFitness(bestParams);

  const generations = 15;
  const lambda = 10;
  const stepSize = 0.2; 

  const tunableKeys: (keyof UtilityParameters)[] = [
    'betaAttackBase', 'betaXG', 'betaXA', 'betaXGI3', 'betaXGI5', 
    'betaAttFixture', 'betaTeamAttack', 'betaOppDefense', 'betaAttHome',
    'betaCsBase', 'betaTeamDefense', 'betaOppAttack', 'betaCsFixture', 'betaCsHome',
    'betaBonusBase', 'betaBpsBaseline'
  ];

  for (let g = 0; g < generations; g++) {
    let currentStepSize = stepSize * Math.pow(0.85, g);
    let bestChildParams = { ...bestParams };
    let bestChildLoss = 999999;

    for (let i = 0; i < lambda; i++) {
      const childParams = { ...bestParams };
      tunableKeys.forEach(k => {
        const u1 = Math.max(Number.MIN_VALUE, random());
        const u2 = random();
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        (childParams as any)[k] += z0 * currentStepSize;
      });

      const loss = evaluateFitness(childParams);
      if (loss < bestChildLoss) {
        bestChildLoss = loss;
        bestChildParams = childParams;
      }
    }

    if (bestChildLoss < bestLoss) {
      bestLoss = bestChildLoss;
      bestParams = bestChildParams;
    }
  }

  return { loss: bestLoss, params: bestParams };
}

async function runStabilityCheck() {
  console.log("=== Parameter Stability Test ===");
  
  // Use N=20 for thorough testing
  const N = 5; // Set to 5 for speed during development
  console.log(`Running ES calibration ${N} times...`);
  
  const results: any[] = [];
  
  for (let i = 1; i <= N; i++) {
    console.log(`Starting Run ${i}/${N} (Seed: ${i})...`);
    // Ideally use 21/22 + 22/23 but for speed use a single season for this script
    const res = await runESCalibration('2023-24', i);
    console.log(`Run ${i} completed. Loss: ${res.loss.toFixed(4)}`);
    results.push(res);
  }
  
  const tunableKeys: (keyof UtilityParameters)[] = [
    'betaAttackBase', 'betaXG', 'betaXA', 'betaXGI3', 'betaXGI5', 
    'betaAttFixture', 'betaTeamAttack', 'betaOppDefense', 'betaAttHome',
    'betaCsBase', 'betaTeamDefense', 'betaOppAttack', 'betaCsFixture', 'betaCsHome',
    'betaBonusBase', 'betaBpsBaseline'
  ];

  console.log("\n=== Stability Results ===");
  tunableKeys.forEach(key => {
    const values = results.map(r => r.params[key]);
    
    // Sort for median and CI
    values.sort((a, b) => a - b);
    
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / N;
    
    const sqDiffs = values.map(v => Math.pow(v - mean, 2));
    const std = Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / N);
    
    const median = values[Math.floor(N / 2)];
    // Rough 95% CI
    const ci95 = 1.96 * std / Math.sqrt(N);
    
    console.log(`${String(key).padEnd(20)}: Mean = ${mean.toFixed(3)} | Std = ${std.toFixed(3)} | Median = ${median.toFixed(3)} | 95% CI = [${(mean - ci95).toFixed(3)}, ${(mean + ci95).toFixed(3)}]`);
  });
}

if (import.meta.url.includes('test-stability') || (process.argv[1] && process.argv[1].includes('test-stability'))) {
  runStabilityCheck().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
