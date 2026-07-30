import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { ProjectionEngine } from '../api/_lib/projection.js';
import { loadWeights } from '../api/_lib/weights-loader.js';

function calculateNDCG(predictedScores: number[], actualScores: number[], k: number): number {
  const paired = predictedScores.map((pred, i) => ({ pred, actual: actualScores[i] }));
  paired.sort((a, b) => b.pred - a.pred);
  const dcg = paired.slice(0, k).reduce((sum, item, i) => sum + item.actual / Math.log2(i + 2), 0);
  const ideal = [...actualScores].sort((a, b) => b - a);
  const idcg = ideal.slice(0, k).reduce((sum, score, i) => sum + score / Math.log2(i + 2), 0);
  if (idcg === 0) return 1;
  return dcg / idcg;
}

function calculateSpearman(predictedScores: number[], actualScores: number[]): number {
  if (predictedScores.length === 0) return 0;
  
  const getRanks = (arr: number[]) => {
    const sorted = [...arr].map((val, i) => ({ val, origIndex: i })).sort((a, b) => b.val - a.val);
    const ranks = new Array(arr.length);
    sorted.forEach((item, rank) => ranks[item.origIndex] = rank + 1);
    return ranks;
  };

  const pRanks = getRanks(predictedScores);
  const aRanks = getRanks(actualScores);
  
  let dSquaredSum = 0;
  const n = predictedScores.length;
  for (let i = 0; i < n; i++) {
    const d = pRanks[i] - aRanks[i];
    dSquaredSum += d * d;
  }
  
  return 1 - (6 * dSquaredSum) / (n * (n * n - 1));
}

export async function evaluateModel(weightName: string, season: string) {
  const provider = new VaastavProvider();
  await provider.loadSeason(season);
  const params = loadWeights(weightName);
  
  const startGw = 1;
  const endGw = 34;
  
  let totalRMSE = 0;
  let totalMAE = 0;
  let totalSpearman = 0;
  let totalNdcgCapt = 0;
  let totalNdcgXI = 0;
  let totalNdcgTrans = 0;
  let count = 0;
  let count4 = 0;
  
  for (let gw = startGw; gw <= endGw; gw++) {
    const snapshot = provider.getDeadlineSnapshot(gw, 1000, 0, {});
    const engine = new ProjectionEngine(snapshot, params);
    const oracle = engine.getOracle();
    
    const allIds = oracle.getAllPlayerIds();
    const validPlayers = allIds.filter(id => oracle.getCost(id) > 0);
    
    const preds = validPlayers.map(id => oracle.getXP(id, gw));
    const actuals = validPlayers.map(id => provider.getActualPoints(id, gw));
    
    let sqErr = 0;
    let absErr = 0;
    for (let i = 0; i < preds.length; i++) {
      sqErr += Math.pow(preds[i] - actuals[i], 2);
      absErr += Math.abs(preds[i] - actuals[i]);
    }
    
    totalRMSE += Math.sqrt(sqErr / preds.length);
    totalMAE += absErr / preds.length;
    totalSpearman += calculateSpearman(preds, actuals);
    
    totalNdcgCapt += calculateNDCG(preds, actuals, 1);
    totalNdcgXI += calculateNDCG(preds, actuals, 11);
    count++;

    if (gw + 3 <= endGw) {
      const preds4 = validPlayers.map(id => {
        let p = 0;
        for (let i = 0; i < 4; i++) p += oracle.getXP(id, gw + i);
        return p;
      });
      const actuals4 = validPlayers.map(id => {
        let a = 0;
        for (let i = 0; i < 4; i++) a += provider.getActualPoints(id, gw + i);
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
  
  const loss = 
      0.40 * (avgRMSE / 5.0) 
    + 0.25 * (1 - avgNdcgCapt) 
    + 0.20 * (1 - avgNdcgXI) 
    + 0.15 * (1 - avgNdcgTrans);
    
  return {
    season,
    loss,
    rmse: avgRMSE,
    mae: totalMAE / count,
    spearman: totalSpearman / count,
    ndcgCapt: avgNdcgCapt,
    ndcgXI: avgNdcgXI,
    ndcgTrans: avgNdcgTrans
  };
}

// Allow running directly
if (process.argv[1] && process.argv[1].includes('evaluate-model.ts')) {
  const args = process.argv.slice(2);
  const weightName = args[0] || 'baseline';
  const season = args[1] || '2023-24';
  
  evaluateModel(weightName, season).then(res => {
    console.log(`=== Evaluation of ${weightName} on ${season} ===`);
    console.log(`Loss: ${res.loss.toFixed(4)}`);
    console.log(`RMSE: ${res.rmse.toFixed(4)}`);
    console.log(`MAE: ${res.mae.toFixed(4)}`);
    console.log(`Spearman: ${res.spearman.toFixed(4)}`);
    console.log(`Captain NDCG: ${res.ndcgCapt.toFixed(4)}`);
    console.log(`XI NDCG: ${res.ndcgXI.toFixed(4)}`);
    console.log(`Transfer NDCG: ${res.ndcgTrans.toFixed(4)}`);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
