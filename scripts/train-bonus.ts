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

const BONUS_BETAS = [
  'betaBonusBase',
  'betaBpsBaseline'
];

const MUTATION_SCALES: Record<string, number> = {
  'betaBonusBase': 0.1,
  'betaBpsBaseline': 0.1
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

function evaluateBonus(params: UtilityParameters, providers: VaastavProvider[]): { rmse: number, mae: number, spearman: number, loss: number } {
  let totalSqErr = 0;
  let totalAbsErr = 0;
  let count = 0;
  
  let totalSpearman = 0;
  let gwCount = 0;

  for (const provider of providers) {
    for (let gw = 1; gw <= 38; gw++) {
      let snapshot;
      try {
        snapshot = provider.getDeadlineSnapshot(gw, 1000, 0, {});
      } catch (e) {
        continue;
      }
      if (!snapshot) continue;
      
      const engine = new ProjectionEngine(params);
      const oracle = new HistoricalOracle(snapshot, engine);
      const validPlayers = oracle.getAllPlayerIds().filter(id => oracle.getCost(id) > 0);

      const gwPredicted: number[] = [];
      const gwActual: number[] = [];

      for (const id of validPlayers) {
        oracle.getXP(id, gw);
        
        const actualMinsRecords = provider.gwDataByPlayer[id]?.[gw] || [];
        const actualMins = actualMinsRecords.reduce((acc: number, m: any) => acc + parseInt(m.minutes || 0), 0);
        
        if (actualMins < 45) continue;
        
        const player = snapshot.players[id];
        const fixtures = player.fixturesByGw?.[gw] || [];
        if (fixtures.length === 0) continue;

        const minuteFraction = actualMins / 90;
        let expectedBonusSum = 0;
        
        fixtures.forEach(fix => {
          const isHome = fix.isHome ? 1 : 0;
          
          // Need to replicate attack sub-model to get expectedAttack for Bonus Model
          let expectedAttack = params.betaAttackBase 
            + params.betaXG * (player.xG90 || 0)
            + params.betaXA * (player.xA90 || 0)
            + params.betaXGI3 * (player.xGI3 || 0)
            + params.betaXGI5 * (player.xGI5 || 0)
            + params.betaTeamAttack * (fix.teamAttackRating || 1.5) 
            + params.betaOppDefense * (fix.opponentDefenseRating || 1.5)
            + params.betaAttHome * isHome;
            
          expectedAttack = Math.max(0, expectedAttack) * minuteFraction;
          
          let expectedBonus = Math.max(0, params.betaBonusBase + params.betaBpsBaseline * (expectedAttack / 3));
          expectedBonusSum += expectedBonus;
        });

        const actualBonus = provider.getActualBonusPoints(id, gw);
        
        const err = expectedBonusSum - actualBonus;
        totalSqErr += err * err;
        totalAbsErr += Math.abs(err);
        count++;

        gwPredicted.push(expectedBonusSum);
        gwActual.push(actualBonus);
      }
      
      if (gwPredicted.length > 10) {
         totalSpearman += spearmanRankCorrelation(gwPredicted, gwActual);
         gwCount++;
      }
    }
  }

  if (count === 0) return { rmse: 999, mae: 999, spearman: 0, loss: 999 };
  
  const rmse = Math.sqrt(totalSqErr / count);
  const mae = totalAbsErr / count;
  const spearman = gwCount > 0 ? (totalSpearman / gwCount) : 0;
  
  const loss = (0.45 * rmse) + (0.30 * mae) + (0.25 * (1 - spearman));
  
  return { rmse, mae, spearman, loss };
}

function mutate(baseParams: UtilityParameters): UtilityParameters {
  const newParams = { ...baseParams };
  for (const key of BONUS_BETAS) {
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
  let bestTrain = evaluateBonus(bestParams, trainProviders);
  let bestVal = evaluateBonus(bestParams, valProviders);
  
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
      const metrics = evaluateBonus(candidateParams, trainProviders);
      population.push({ params: candidateParams, metrics });
    }

    population.sort((a, b) => a.metrics.loss - b.metrics.loss);
    const generationBest = population[0];

    console.log(`\n--- Generation ${gen} ---`);
    console.log(`Best Train Loss: ${generationBest.metrics.loss.toFixed(4)}`);
    console.log(`RMSE: ${generationBest.metrics.rmse.toFixed(3)} | MAE: ${generationBest.metrics.mae.toFixed(3)} | Spearman: ${generationBest.metrics.spearman.toFixed(3)}`);
    
    console.log("Feature Weights:");
    for (const key of BONUS_BETAS) {
       console.log(`  ${key}: ${(generationBest.params as any)[key].toFixed(4)}`);
    }

    // 1. Update mutation base using training loss
    if (generationBest.metrics.loss < bestTrain.loss) {
      bestTrain = generationBest.metrics;
      bestParams = generationBest.params;
    }

    // 2. Evaluate validation loss
    const valMetrics = evaluateBonus(generationBest.params, valProviders);
    const minDelta = 1e-4;

    if (valMetrics.loss < bestVal.loss - minDelta) {
      bestVal = valMetrics;
      generationsWithoutImprovement = 0;
      
      console.log(`🔥 NEW BEST! Validation Loss: ${valMetrics.loss.toFixed(4)} (Spearman: ${valMetrics.spearman.toFixed(3)})`);
      
      const genFile = path.join(weightsDir, `bonus_gen${gen.toString().padStart(3, '0')}.json`);
      fs.writeFileSync(genFile, JSON.stringify({ weights: generationBest.params }, null, 2));
      
      const baselineFile = path.join(weightsDir, 'baseline.json');
      fs.writeFileSync(baselineFile, JSON.stringify({ weights: generationBest.params }, null, 2));
    } else {
      generationsWithoutImprovement++;
      console.log(`No improvement in Validation Loss. Patience: ${generationsWithoutImprovement}/${PATIENCE}`);
    }

    if (generationsWithoutImprovement >= PATIENCE) {
      console.log(`\nEarly stopping triggered after ${gen} generations.`);
      break;
    }
  }

  console.log(`\nStage 2C Training Complete!`);
}

runTraining().catch(console.error);
