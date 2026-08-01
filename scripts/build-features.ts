import fs from 'fs';
import path from 'path';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEASONS = ['2021-22', '2022-23', '2023-24'];

async function buildFeatureStore() {
  console.log("Building Feature Store across all historical seasons...");
  
  for (const season of SEASONS) {
    const provider = new VaastavProvider();
    await provider.loadSeason(season);
  }
  
  const storePath = path.resolve(__dirname, '../data/feature-store.json');
  if (fs.existsSync(storePath)) {
    const stat = fs.statSync(storePath);
    console.log(`\nSuccess! Feature Store generated at: ${storePath}`);
    console.log(`File Size: ${(stat.size / 1024).toFixed(2)} KB`);
  }
}

buildFeatureStore().catch(console.error);
