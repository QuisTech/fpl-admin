/**
 * save-snapshot.ts
 * 
 * Standalone script to archive a pre-deadline point-in-time snapshot.
 * Called automatically by the Sniper GitHub Action ~2 hours before each GW deadline.
 * 
 * Reads the current gameweek from top_1000_eo.json or the FPL API bootstrap,
 * then copies fplform.csv, fpl_native.csv, and top_1000_eo.json into data/snapshots/gw_{X}/
 */
import fs from 'fs';
import path from 'path';
import { SnapshotService } from '../api/_lib/snapshot-service.ts';

async function detectGameweek(): Promise<number> {
  // Try reading from top_1000_eo.json first
  const eoPath = path.resolve(process.cwd(), 'data', 'top_1000_eo.json');
  if (fs.existsSync(eoPath)) {
    try {
      const eoData = JSON.parse(fs.readFileSync(eoPath, 'utf-8'));
      if (eoData.gameweek && eoData.gameweek > 0) {
        return eoData.gameweek;
      }
    } catch {}
  }

  // Fallback: fetch from FPL API bootstrap-static
  try {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await res.json();
    const nextEvent = data.events?.find((e: any) => e.is_next) ??
                      data.events?.find((e: any) => new Date(e.deadline_time) > new Date());
    if (nextEvent?.id) return nextEvent.id;
  } catch (err: any) {
    console.warn(`[Snapshot] Could not fetch GW from FPL API: ${err.message}`);
  }

  console.error('[Snapshot] Could not detect current gameweek. Exiting.');
  process.exit(1);
}

const gw = await detectGameweek();

if (SnapshotService.hasSnapshot(gw)) {
  console.log(`[Snapshot] GW${gw} snapshot already exists. Skipping.`);
} else {
  const result = SnapshotService.saveSnapshot(gw);
  console.log(`[Snapshot] ${result.message}`);
}
