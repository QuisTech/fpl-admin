import { loadWeights } from '../api/_lib/weights-loader.js';
const DEFAULT_PARAMETERS = loadWeights('baseline');
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import {  ProjectionEngine, UtilityParameters, HistoricalOracle } from '../api/_lib/projection.js';

// Simple Spearman Rank Correlation implementation
function spearmanRankCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;
  
  const rankX = getRanks(x);
  const rankY = getRanks(y);
  
  let d2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rankX[i] - rankY[i];
    d2 += d * d;
  }
  
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function getRanks(arr: number[]): number[] {
  const sorted = arr.map((val, idx) => ({ val, idx })).sort((a, b) => b.val - a.val);
  const ranks = new Array(arr.length);
  sorted.forEach((item, i) => {
    ranks[item.idx] = i + 1; // 1-based rank
  });
  return ranks;
}

// Calculate top-k precision
function topKPrecision(predicted: number[], actual: number[], k: number): number {
  if (predicted.length === 0) return 0;
  const kAct = Math.min(k, predicted.length);
  
  const pSorted = predicted.map((val, idx) => ({ val, idx })).sort((a, b) => b.val - a.val);
  const aSorted = actual.map((val, idx) => ({ val, idx })).sort((a, b) => b.val - a.val);
  
  const topKPredictedIds = new Set(pSorted.slice(0, kAct).map(x => x.idx));
  const topKActualIds = new Set(aSorted.slice(0, kAct).map(x => x.idx));
  
  let match = 0;
  topKPredictedIds.forEach(id => {
    if (topKActualIds.has(id)) match++;
  });
  
  return match / kAct;
}

async function runTraining() {
  const trainSeasons = ['2021-22', '2022-23'];
  console.log(`Loading Training Seasons: ${trainSeasons.join(', ')}...`);
  
  // To avoid reloading datasets continuously during grid search, we cache the snapshots
  const snapshots: Record<string, Record<number, any>> = {};
  const providers: Record<string, VaastavProvider> = {};
  
  for (const season of trainSeasons) {
    const provider = new VaastavProvider();
    await provider.loadSeason(season);
    providers[season] = provider;
    snapshots[season] = {};
    
    // We can pre-calculate all snapshots since they don't depend on UtilityParameters!
    for (let gw = 1; gw <= 38; gw++) {
      snapshots[season][gw] = provider.getDeadlineSnapshot(gw, 1000, 0, {});
    }
  }
  
  console.log('Datasets loaded and snapshots cached. Starting Grid Search...');

  // Hyperparameter grid
  const betaXG_options = [0.5, 1.0, 1.5];
  const betaXA_options = [0.5, 1.0];
  const betaXGI3_options = [0.2, 0.5];
  const betaXGI5_options = [0.1, 0.3];
  const betaFixture_options = [-0.1, -0.3];
  const betaMinutesBase_options = [0.8, 1.0];

  let bestMetrics = { rmse: Infinity, mae: Infinity, spearman: -1, topK: -1 };
  let bestParams = { ...DEFAULT_PARAMETERS };

  // Helper to iterate combinations
  for (const bXG of betaXG_options) {
    for (const bXA of betaXA_options) {
      for (const bXGI3 of betaXGI3_options) {
        for (const bXGI5 of betaXGI5_options) {
          for (const bFix of betaFixture_options) {
            for (const bMin of betaMinutesBase_options) {
              
              const params: UtilityParameters = {
                ...DEFAULT_PARAMETERS,
                betaXG: bXG,
                betaXA: bXA,
                betaXGI3: bXGI3,
                betaXGI5: bXGI5,
                betaAttFixture: bFix,
                betaCsFixture: bFix,
                betaMinutesBase: bMin
              };

              let sumSqError = 0;
              let sumAbsError = 0;
              let totalWeight = 0;
              
              // For Spearman and Top-K, we evaluate per gameweek and average
              let totalSpearman = 0;
              let totalTop10 = 0;
              let validGameweeks = 0;

              for (const season of trainSeasons) {
                const provider = providers[season];
                for (let gw = 1; gw <= 38; gw++) {
                  const snapshot = snapshots[season][gw];
                  const engine = new ProjectionEngine(params);
                  const oracle = new HistoricalOracle(snapshot, engine);
                  
                  const gwPredicted: number[] = [];
                  const gwActual: number[] = [];
                  const playerIds = oracle.getAllPlayerIds();
                  
                  playerIds.forEach((id, idx) => {
                    const xp = oracle.getXP(id, gw);
                    const expectedMins = snapshot.players[id].predictedMinutes || 0;
                    
                    // Weighting based on Expected Minutes
                    let weight = 0;
                    if (expectedMins > 60) weight = 1.0;
                    else if (expectedMins > 30) weight = 0.5;
                    else if (expectedMins > 0) weight = 0.2;
                    
                    if (weight > 0) {
                      const actualPts = provider.getActualPoints(id, gw);
                      
                      const error = xp - actualPts;
                      sumSqError += (error * error) * weight;
                      sumAbsError += Math.abs(error) * weight;
                      totalWeight += weight;
                      
                      // For rank tracking (only track players we'd realistically consider)
                      if (weight >= 0.5) {
                        gwPredicted.push(xp);
                        gwActual.push(actualPts);
                      }
                    }
                  });
                  
                  if (gwPredicted.length > 10) {
                    totalSpearman += spearmanRankCorrelation(gwPredicted, gwActual);
                    totalTop10 += topKPrecision(gwPredicted, gwActual, 10);
                    validGameweeks++;
                  }
                }
              }

              const rmse = Math.sqrt(sumSqError / totalWeight);
              const mae = sumAbsError / totalWeight;
              const avgSpearman = totalSpearman / validGameweeks;
              const avgTop10 = totalTop10 / validGameweeks;

              console.log(`[bXG=${bXG}, bXA=${bXA}, bXGI3=${bXGI3}, bXGI5=${bXGI5}, bFix=${bFix}, bMin=${bMin}] -> RMSE: ${rmse.toFixed(3)} | MAE: ${mae.toFixed(3)} | Spearman: ${avgSpearman.toFixed(3)} | Top-10: ${avgTop10.toFixed(3)}`);

              // Optimize for RMSE primarily for this sweep
              if (rmse < bestMetrics.rmse) {
                bestMetrics = { rmse, mae, spearman: avgSpearman, topK: avgTop10 };
                bestParams = { ...params };
                console.log(`🌟 NEW BEST RMSE: ${rmse.toFixed(3)}`);
              }
            }
          }
        }
      }
    }
  }

  console.log('\n=== TRAINING COMPLETE ===');
  console.log('Best Parameters:', bestParams);
  console.log('Best Metrics:', bestMetrics);
}

runTraining().catch(err => {
  console.error(err);
  process.exit(1);
});
