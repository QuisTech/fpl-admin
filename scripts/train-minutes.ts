import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { ProjectionEngine, HistoricalOracle, UtilityParameters } from '../api/_lib/projection.js';
import { loadWeights } from '../api/_lib/weights-loader.js';
import * as fs from 'fs';

// Constants
const SEASONS = ['2021-22', '2022-23'];
const VALIDATION_SEASON = '2023-24';
const MAX_GENERATIONS = 20;
const POPULATION_SIZE = 10;
const PATIENCE = 10;

// The parameters we are training in Stage 1
const MINUTES_BETAS: Array<keyof UtilityParameters> = [
  'betaMinutesBase',
  'betaMinutesLast1',
  'betaMinutesLast3',
  'betaMinutesLast5',
  'betaMinutesEWMA',
  'betaStartsLast5',
  'betaSeasonMins',
  'betaRestHours',
  'betaFix7Days',
  'betaFix14Days',
  'betaMinVolatility',
  'betaChanceOfPlaying',
  'betaSelectionMomentum',
  'betaConsecutiveStarts'
];

// Mutation scales for each parameter to help ES converge
const MUTATION_SCALES: Partial<Record<keyof UtilityParameters, number>> = {
  betaMinutesBase: 3.0,
  betaMinutesLast1: 0.1,
  betaMinutesLast3: 0.1,
  betaMinutesLast5: 0.1,
  betaMinutesEWMA: 0.2,
  betaStartsLast5: 0.5,
  betaSeasonMins: 0.5,
  betaRestHours: 0.05,
  betaFix7Days: 0.2,
  betaFix14Days: 0.1,
  betaMinVolatility: 0.1,
  betaChanceOfPlaying: 0.1,
  betaSelectionMomentum: 0.1,
  betaConsecutiveStarts: 0.5
};

async function loadDatasets(seasons: string[]): Promise<any[]> {
  const providers: any[] = [];
  for (const s of seasons) {
    const p = new VaastavProvider();
    await p.loadSeason(s);
    providers.push(p);
  }
  return providers;
}

function evaluateMinutesRMSE(params: UtilityParameters, providers: any[]): number {
  let totalSqErr = 0;
  let count = 0;

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

      for (const id of validPlayers) {
        oracle.getXP(id, gw);
        const expMins = snapshot.players[id].predictedMinutes;
        if (isNaN(expMins) || expMins < 5) continue;

        const gwMatches = provider.gwDataByPlayer[id]?.[gw] || [];
        const actualMins = gwMatches.reduce((acc: number, m: any) => acc + parseInt(m.minutes || 0), 0);
        
        totalSqErr += Math.pow(expMins - actualMins, 2);
        count++;
      }
    }
  }

  if (count === 0) return 999;
  return Math.sqrt(totalSqErr / count);
}

function mutate(baseParams: UtilityParameters): UtilityParameters {
  const newParams = { ...baseParams };
  for (const key of MINUTES_BETAS) {
    const scale = MUTATION_SCALES[key] || 0.1;
    // Box-Muller transform for N(0,1) noise
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

async function runTraining() {
  console.log(`Loading training datasets: ${SEASONS.join(', ')}...`);
  const trainProviders = await loadDatasets(SEASONS);
  
  console.log(`Loading validation dataset: ${VALIDATION_SEASON}...`);
  const valProviders = await loadDatasets([VALIDATION_SEASON]);

  let bestParams = loadWeights('baseline');
  console.log(`Initial Evaluation...`);
  let bestTrainRMSE = evaluateMinutesRMSE(bestParams, trainProviders);
  let bestValRMSE = evaluateMinutesRMSE(bestParams, valProviders);
  
  console.log(`\nINITIAL BASELINE`);
  console.log(`Train RMSE: ${bestTrainRMSE.toFixed(3)} | Val RMSE: ${bestValRMSE.toFixed(3)}`);

  let generationsWithoutImprovement = 0;

  for (let gen = 1; gen <= MAX_GENERATIONS; gen++) {
    const population: { params: UtilityParameters, rmse: number }[] = [];
    
    for (let p = 0; p < POPULATION_SIZE; p++) {
      const candidateParams = mutate(bestParams);
      const rmse = evaluateMinutesRMSE(candidateParams, trainProviders);
      population.push({ params: candidateParams, rmse });
    }

    // Find best in population
    population.sort((a, b) => a.rmse - b.rmse);
    const generationBest = population[0];

    if (generationBest.rmse < bestTrainRMSE) {
      const improvement = bestTrainRMSE - generationBest.rmse;
      bestTrainRMSE = generationBest.rmse;
      bestParams = { ...generationBest.params };
      bestValRMSE = evaluateMinutesRMSE(bestParams, valProviders);
      generationsWithoutImprovement = 0;
      console.log(`\n[Gen ${gen}] NEW BEST (Train RMSE: ${bestTrainRMSE.toFixed(3)} | Val RMSE: ${bestValRMSE.toFixed(3)})`);
    } else {
      generationsWithoutImprovement++;
      console.log(`[Gen ${gen}] No improvement. Best Train RMSE: ${bestTrainRMSE.toFixed(3)} (Patience: ${generationsWithoutImprovement}/${PATIENCE})`);
    }

    if (generationsWithoutImprovement === 0 || gen % 5 === 0) {
      console.log(`\n--- Top Coefficients ---`);
      // Sort and log betas by absolute magnitude to see what the optimizer values
      const sortedBetas = MINUTES_BETAS.map(key => ({
        key, val: (bestParams as any)[key]
      })).sort((a, b) => Math.abs(b.val) - Math.abs(a.val));
      
      for (const b of sortedBetas) {
        console.log(`${b.key.padEnd(25)} : ${b.val.toFixed(4)}`);
      }
      console.log(`------------------------\n`);
    }

    if (generationsWithoutImprovement >= PATIENCE) {
      console.log(`\nEarly stopping triggered. No improvement for ${PATIENCE} generations.`);
      break;
    }
  }

  console.log(`\n=== TRAINING COMPLETE ===`);
  console.log(`Final Train RMSE: ${bestTrainRMSE.toFixed(3)}`);
  console.log(`Final Val RMSE  : ${bestValRMSE.toFixed(3)}`);
  
  // Save new baseline
  const baselinePath = 'api/_lib/weights/baseline.json';
  fs.writeFileSync(baselinePath, JSON.stringify(bestParams, null, 2));
  console.log(`Saved optimized weights to ${baselinePath}`);
}

runTraining().catch(console.error);
