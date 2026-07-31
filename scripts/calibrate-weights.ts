import { loadWeights } from '../api/_lib/weights-loader.js';
const DEFAULT_PARAMETERS = loadWeights('baseline');
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import {  ProjectionEngine, UtilityParameters, HistoricalOracle } from '../api/_lib/projection.js';

// NDCG calculation for ranking evaluation
function calculateNDCG(predictedScores: number[], actualScores: number[], k: number): number {
  const paired = predictedScores.map((pred, i) => ({ pred, actual: actualScores[i] }));
  
  // Sort by predicted score (descending) to get the model's ranking
  paired.sort((a, b) => b.pred - a.pred);
  const dcg = paired.slice(0, k).reduce((sum, item, i) => sum + item.actual / Math.log2(i + 2), 0);
  
  // Sort by actual score (descending) to get the ideal ranking
  const ideal = [...actualScores].sort((a, b) => b - a);
  const idcg = ideal.slice(0, k).reduce((sum, score, i) => sum + score / Math.log2(i + 2), 0);
  
  if (idcg === 0) return 1; // Perfect by default if no one scored anything
  return dcg / idcg;
}

// Simple (1+λ) Evolution Strategy to replace grid search
async function calibrateWeights() {
  const season = '2023-24';
  const provider = new VaastavProvider();
  await provider.loadSeason(season);

  console.log(`\nStarting Evolutionary Calibration on ${season}...`);

  const startGw = 1;
  const endGw = 34; // Use first 34 GWs for training/calibration to avoid final week noise

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
      
      // RMSE
      let sqErr = 0;
      for (let i = 0; i < preds.length; i++) {
        sqErr += Math.pow(preds[i] - actuals[i], 2);
      }
      totalRMSE += Math.sqrt(sqErr / preds.length);
      
      // Ranking loss via NDCG
      totalNdcgCapt += calculateNDCG(preds, actuals, 1);
      totalNdcgXI += calculateNDCG(preds, actuals, 11);
      count++;

      // Transfer ranking (4-GW horizon)
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
        totalNdcgTrans += calculateNDCG(preds4, actuals4, 5); // top 5 targets
        count4++;
      }
    }

    const avgRMSE = totalRMSE / count;
    const avgNdcgCapt = totalNdcgCapt / count;
    const avgNdcgXI = totalNdcgXI / count;
    const avgNdcgTrans = totalNdcgTrans / Math.max(1, count4);

    // Objective: Minimize Loss 
    const loss = 
        0.40 * (avgRMSE / 5.0) 
      + 0.25 * (1 - avgNdcgCapt) 
      + 0.20 * (1 - avgNdcgXI) 
      + 0.15 * (1 - avgNdcgTrans);

    return loss;
  }

  // (1+λ) ES 
  let bestParams = { ...DEFAULT_PARAMETERS };
  let bestLoss = evaluateFitness(bestParams);
  
  console.log(`Baseline Loss: ${bestLoss.toFixed(4)}`);

  const generations = 15; // Low for testing
  const lambda = 10;
  const stepSize = 0.2; // initial noise std dev

  const tunableKeys: (keyof UtilityParameters)[] = [
    'betaAttackBase', 'betaXG', 'betaXA', 'betaXGI3', 'betaXGI5', 
    'betaAttFixture', 'betaTeamAttack', 'betaOppDefense', 'betaAttHome',
    'betaCsBase', 'betaTeamDefense', 'betaOppAttack', 'betaCsFixture', 'betaCsHome',
    'betaBonusBase', 'betaBpsBaseline'
  ];

  for (let g = 0; g < generations; g++) {
    let currentStepSize = stepSize * Math.pow(0.85, g); // decay step size
    let bestChildParams = { ...bestParams };
    let bestChildLoss = 999999;

    for (let i = 0; i < lambda; i++) {
      const childParams = { ...bestParams };
      // Mutate
      tunableKeys.forEach(k => {
        const u1 = Math.random(), u2 = Math.random();
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
      console.log(`Gen ${g}: New Best Loss -> ${bestLoss.toFixed(4)}`);
    } else {
      console.log(`Gen ${g}: No improvement.`);
    }
  }

  console.log(`\n=== CALIBRATION COMPLETE ===`);
  console.log(`Best Loss: ${bestLoss.toFixed(4)}`);
  console.log(`Optimal Parameters:`, bestParams);
}

calibrateWeights().catch(err => {
  console.error(err);
  process.exit(1);
});
