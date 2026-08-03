import fs from 'fs';
import path from 'path';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function exportLatentRatings() {
  console.log("Loading Vaastav for 2023-24 season...");
  const provider = new VaastavProvider();
  await provider.loadSeason('2023-24');
  
  // Get snapshot at end of season (GW 39)
  console.log("Generating snapshot for GW 39 to get final EWMA Latent Team Ratings...");
  const snapshot = provider.getDeadlineSnapshot(39, 1000, 0, {});
  
  if (snapshot.teamRatings) {
    const outPath = path.resolve(__dirname, '../data/latent-ratings.json');
    fs.writeFileSync(outPath, JSON.stringify(snapshot.teamRatings, null, 2));
    console.log(`Successfully exported latent ratings to ${outPath}`);
  } else {
    console.error("Failed to find teamRatings on snapshot.");
  }
}

exportLatentRatings().catch(console.error);
