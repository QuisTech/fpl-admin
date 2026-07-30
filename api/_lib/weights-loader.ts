import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UtilityParameters, DEFAULT_PARAMETERS } from './projection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadWeights(name: string): UtilityParameters {
  const weightsPath = path.resolve(__dirname, 'weights', `${name}.json`);
  if (!fs.existsSync(weightsPath)) {
    throw new Error(`Weights file not found: ${weightsPath}`);
  }
  
  const content = fs.readFileSync(weightsPath, 'utf8');
  const data = JSON.parse(content);
  
  if (data.weights) {
    return { ...DEFAULT_PARAMETERS, ...data.weights };
  }
  
  throw new Error(`Invalid weights format in ${name}.json`);
}

export function listAvailableWeights(): string[] {
  const indexPath = path.resolve(__dirname, 'weights', 'index.json');
  if (!fs.existsSync(indexPath)) return ['baseline'];
  
  const content = fs.readFileSync(indexPath, 'utf8');
  const data = JSON.parse(content);
  return data.models.map((m: any) => m.name);
}
