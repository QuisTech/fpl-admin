import fs from 'fs';
import path from 'path';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { ProjectionEngine, UtilityParameters, HistoricalOracle } from '../api/_lib/projection.js';
import { loadWeights } from '../api/_lib/weights-loader.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEASONS = ['2021-22', '2022-23'];
const VALIDATION_SEASON = '2023-24';

const POPULATION_SIZE = 15;
const MAX_GENERATIONS = 30;
const PATIENCE = 5;

const ATTACK_BETAS = [
  'betaAttackBase', 'betaXG', 'betaXA', 'betaXGI3', 'betaXGI5', 
  'betaTeamAttack', 'betaOppDefense', 'betaAttHome'
];

const MUTATION_SCALES: Record<string, number> = {
  'betaAttackBase': 0.1,
  'betaXG': 0.5,
  'betaXA': 0.5,
  'betaXGI3': 0.2,
  'betaXGI5': 0.1,
  'betaTeamAttack': 0.1,
  'betaOppDefense': 0.1,
  'betaAttHome': 0.05
};

async function loadDatasets(seasons: string[]): Promise<VaastavProvider[]> {
  const providers = [];
  for (const s of seasons) {
    const p = new VaastavProvider();
    await p.loadSeason(s);
    providers.push(p);
  }
  return providers;
}

function getRanks(arr: number[]): number[] {
  const sorted = arr.map((val, idx) => ({ val, idx })).sort((a, b) => b.val - a.val);
  const ranks = new Array(arr.length);
  sorted.forEach((item, i) => {
    ranks[item.idx] = i + 1;
  });
  return ranks;
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

function evaluateAttack(params: UtilityParameters, providers: VaastavProvider[]): { rmse: number, mae: number, spearman: number, loss: number, ndcg: number } {
    let sse = 0, sabs = 0, num = 0;
    const predTotalArr: number[] = [];
    const actualTotalArr: number[] = [];
    
    let sumWeeklyNDCG = 0;
    let gwCount = 0;
    
    for (const provider of providers) {
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
          
          const actualMinsRecords = provider.gwDataByPlayer[id]?.[gw] || [];
          const actualMins = actualMinsRecords.reduce((acc: number, m: any) => acc + parseInt(m.minutes || 0), 0);
          
          if (actualMins < 45) continue;
          
          const player = snapshot.players[id];
          const fixtures = player.fixturesByGw?.[gw] || [];
          if (fixtures.length === 0) continue;

          const minuteFraction = actualMins / 90;
          let expectedAttackSum = 0;
          
          fixtures.forEach(fix => {
            const isHome = fix.isHome ? 1 : 0;
            
            let expectedAttack = params.betaAttackBase 
              + params.betaXG * (player.xG90 || 0)
              + params.betaXA * (player.xA90 || 0)
              + params.betaXGI3 * (player.xGI3 || 0)
              + params.betaXGI5 * (player.xGI5 || 0)
              + params.betaTeamAttack * (fix.teamAttackRating || 1.5) 
              + params.betaOppDefense * (fix.opponentDefenseRating || 1.5)
              + params.betaAttHome * isHome;
              
            expectedAttackSum += Math.max(0, expectedAttack) * minuteFraction;
          });
          
          const actAtt = provider.getActualAttackPoints(id, gw);
          
          gwPred.push(expectedAttackSum);
          gwAct.push(actAtt);

          sse += Math.pow(expectedAttackSum - actAtt, 2);
          sabs += Math.abs(expectedAttackSum - actAtt);
          predTotalArr.push(expectedAttackSum);
          actualTotalArr.push(actAtt);
          num++;
        }
        
        if (gwPred.length > 20) {
          sumWeeklyNDCG += computeNDCG(gwPred, gwAct, 20);
          gwCount++;
        }
      }
    }
    
    if (num === 0) return { loss: 999, spearman: 0, rmse: 999, mae: 999, ndcg: 0 };
    
    const rmse = Math.sqrt(sse / num);
    const mae = sabs / num;
    const avgNdcg = gwCount > 0 ? sumWeeklyNDCG / gwCount : 0;

    const ranksActual = getRanks(actualTotalArr);
    const ranksPred = getRanks(predTotalArr);
    
    let sumD2 = 0;
    for (let i = 0; i < num; i++) {
      sumD2 += Math.pow(ranksActual[i] - ranksPred[i], 2);
    }
    const spearman = 1 - (6 * sumD2) / (num * (Math.pow(num, 2) - 1));
    
    // 0.35 RMSE + 0.20 MAE + 0.25 (1 - Spearman) + 0.20 (1 - NDCG@20)
    const loss = (0.35 * rmse) + (0.20 * mae) + (0.25 * (1 - spearman)) + (0.20 * (1 - avgNdcg));
    
    return { loss, spearman, rmse, mae, ndcg: avgNdcg };
}

function mutate(baseParams: UtilityParameters): UtilityParameters {
  const newParams = { ...baseParams };
  for (const key of ATTACK_BETAS) {
    const scale = MUTATION_SCALES[key] || 0.1;
    const u1 = Math.random();
    const u2 = Math.random();
    let z0 = 0;
    if (u1 > 0) {
      z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    }
    const noise = z0 * scale;
    (newParams as any)[key] += noise;
  }
  return newParams;
}

function ensureDirSync(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function runTraining() {
  console.log(`Loading training datasets: ${SEASONS.join(', ')}...`);
  const trainProviders = await loadDatasets(SEASONS);
  
  console.log(`Loading validation dataset: ${VALIDATION_SEASON}...`);
  const valProviders = await loadDatasets([VALIDATION_SEASON]);

  let bestParams = loadWeights('baseline');
  console.log(`Initial Evaluation...`);
  let bestTrain = evaluateAttack(bestParams, trainProviders);
  let bestVal = evaluateAttack(bestParams, valProviders);
  
  console.log(`\nINITIAL BASELINE`);
  console.log(`Train Loss: ${bestTrain.loss.toFixed(4)} (RMSE: ${bestTrain.rmse.toFixed(3)}, MAE: ${bestTrain.mae.toFixed(3)}, Spearman: ${bestTrain.spearman.toFixed(3)})`);
  console.log(`Val Loss: ${bestVal.loss.toFixed(4)} (RMSE: ${bestVal.rmse.toFixed(3)}, MAE: ${bestVal.mae.toFixed(3)}, Spearman: ${bestVal.spearman.toFixed(3)})`);

  let generationsWithoutImprovement = 0;
  const weightsDir = path.resolve(__dirname, '../api/_lib/weights');
  ensureDirSync(weightsDir);

  for (let gen = 1; gen <= MAX_GENERATIONS; gen++) {
    const population: { params: UtilityParameters, metrics: any }[] = [];
    
    for (let p = 0; p < POPULATION_SIZE; p++) {
      const candidateParams = mutate(bestParams);
      const metrics = evaluateAttack(candidateParams, trainProviders);
      population.push({ params: candidateParams, metrics });
    }

    population.sort((a, b) => a.metrics.loss - b.metrics.loss);
    const generationBest = population[0];

    console.log(`\n--- Generation ${gen} ---`);
    console.log(`Best Train Loss: ${generationBest.metrics.loss.toFixed(4)}`);
    console.log(`RMSE: ${generationBest.metrics.rmse.toFixed(3)} | MAE: ${generationBest.metrics.mae.toFixed(3)} | Spearman: ${generationBest.metrics.spearman.toFixed(3)} | NDCG@20: ${generationBest.metrics.ndcg?.toFixed(3) || 0}`);
    
    // Log Feature Importance
    console.log("Feature Weights:");
    for (const key of ATTACK_BETAS) {
       console.log(`  ${key}: ${(generationBest.params as any)[key].toFixed(4)}`);
    }

    if (generationBest.metrics.loss < bestTrain.loss) {
      bestTrain = generationBest.metrics;
      bestParams = generationBest.params;
      generationsWithoutImprovement = 0;
      
      const valMetrics = evaluateAttack(bestParams, valProviders);
      console.log(`🔥 NEW BEST! Validation Loss: ${valMetrics.loss.toFixed(4)} (Spearman: ${valMetrics.spearman.toFixed(3)}, NDCG@20: ${valMetrics.ndcg?.toFixed(3) || 0})`);
      
      // Save Generation
      const genFile = path.join(weightsDir, `gen${gen.toString().padStart(3, '0')}.json`);
      fs.writeFileSync(genFile, JSON.stringify({ weights: bestParams }, null, 2));
      
      // Also overwrite baseline for next stage
      const baselineFile = path.join(weightsDir, 'baseline.json');
      fs.writeFileSync(baselineFile, JSON.stringify({ weights: bestParams }, null, 2));
    } else {
      generationsWithoutImprovement++;
      console.log(`No improvement. Patience: ${generationsWithoutImprovement}/${PATIENCE}`);
    }

    if (generationsWithoutImprovement >= PATIENCE) {
      console.log(`\nEarly stopping triggered after ${gen} generations.`);
      break;
    }
  }

  console.log(`\nStage 2A Training Complete!`);
}

runTraining().catch(console.error);
