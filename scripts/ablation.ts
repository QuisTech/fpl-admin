import { evaluateModel } from './evaluate-model.js';
import { loadWeights } from '../api/_lib/weights-loader.js';
import { UtilityParameters, } from '../api/_lib/projection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runAblationStudy() {
  const baseModel = 'es-v001';
  const season = '2023-24';
  
  console.log(`=== Ablation Study on ${baseModel} (${season}) ===\n`);
  
  // 1. Get base RMSE
  console.log(`Evaluating full model...`);
  const baseRes = await evaluateModel(baseModel, season);
  console.log(`Full model RMSE = ${baseRes.rmse.toFixed(4)}\n`);
  
  // We need a temporary way to evaluate modified parameters without writing JSONs 
  // every time. We can mock loadWeights or create a temporary weight file.
  const tempModelName = `temp-ablation`;
  const tempPath = path.resolve(__dirname, '..', 'api', '_lib', 'weights', `${tempModelName}.json`);
  
  const baseParams = loadWeights(baseModel);
  
  const ablationGroups = [
    { name: 'No Minutes Model', keys: ['betaMinutesBase', 'betaMinutesTrend'] },
    { name: 'No xG', keys: ['betaXG'] },
    { name: 'No xA', keys: ['betaXA'] },
    { name: 'No Team Strength', keys: ['betaTeamAttack', 'betaTeamDefense'] },
    { name: 'No Fixture Feature', keys: ['betaAttFixture', 'betaCsFixture'] },
    { name: 'No Home Advantage', keys: ['betaAttHome', 'betaCsHome'] },
    { name: 'No Bonus Points', keys: ['betaBonusBase', 'betaBpsBaseline'] }
  ];
  
  for (const group of ablationGroups) {
    const ablatedParams = { ...baseParams };
    
    // Zero out the features
    group.keys.forEach(k => {
      (ablatedParams as any)[k] = 0;
    });
    
    // Write temporary JSON
    fs.writeFileSync(tempPath, JSON.stringify({
      name: tempModelName,
      weights: ablatedParams
    }, null, 2));
    
    const res = await evaluateModel(tempModelName, season);
    const degradation = res.rmse - baseRes.rmse;
    
    console.log(`${group.name.padEnd(20)}: RMSE = ${res.rmse.toFixed(4)} (Δ ${(degradation > 0 ? '+' : '')}${degradation.toFixed(4)})`);
  }
  
  // Cleanup
  if (fs.existsSync(tempPath)) {
    fs.unlinkSync(tempPath);
  }
}

runAblationStudy().catch(console.error);
