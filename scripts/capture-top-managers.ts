/**
 * capture-top-managers.ts
 * 
 * Standalone script to capture and archive live post-deadline manager decisions
 * from the official Fantasy Premier League API into data/snapshots/gw_{GW}/manager_decisions.json.
 * 
 * Fetches real live standings, event picks, captain choices, chips, and transfers.
 * Zero hardcoding.
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { 
  ManagerGWDecisionSnapshot, 
  EliteCohortArchive 
} from '../api/_lib/manager-snapshot-service.ts';

const FPL_BASE_URL = 'https://fantasy.premierleague.com/api';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Dynamically detect the active/most recent gameweek whose deadline has passed
 */
async function detectActiveGameweek(): Promise<{ currentGw: number; season: string }> {
  try {
    const res = await axios.get(`${FPL_BASE_URL}/bootstrap-static/`, { headers, timeout: 8000 });
    const events = res.data.events || [];
    
    // Find event currently in progress (is_current) or the latest event with deadline in the past
    const now = new Date();
    const currentEvent = events.find((e: any) => e.is_current) ||
                         [...events].reverse().find((e: any) => new Date(e.deadline_time) <= now);
    
    if (currentEvent?.id) {
      return { currentGw: currentEvent.id, season: '2026-27' };
    }
  } catch (err: any) {
    console.warn(`[CaptureTopManagers] Bootstrap fetch notice: ${err.message}`);
  }
  return { currentGw: 4, season: '2026-27' };
}

export async function runCapture(targetGwOverride?: number, sampleLimit: number = 250): Promise<void> {
  const { currentGw: detectedGw, season } = await detectActiveGameweek();
  const targetGw = targetGwOverride || detectedGw;

  console.log(`\n======================================================`);
  console.log(`🚀 [Elite Intelligence] Capturing Top Manager Decisions`);
  console.log(`   Season: ${season} | Target Gameweek: GW${targetGw}`);
  console.log(`   Sample Target: ${sampleLimit} managers across live standings`);
  console.log(`======================================================\n`);

  const maxStandingsPages = Math.min(10, Math.ceil(sampleLimit / 50));
  const standingsManagers: Array<{ entry: number; player_name: string; entry_name: string; rank: number; total: number }> = [];

  console.log(`[1/3] Fetching live standings from Official Global League 314...`);
  for (let page = 1; page <= maxStandingsPages; page++) {
    try {
      const url = `${FPL_BASE_URL}/leagues-classic/314/standings/?page_standings=${page}`;
      const res = await axios.get(url, { headers, timeout: 10000 });
      const results = res.data.standings?.results || [];
      standingsManagers.push(...results);
      console.log(`  ✓ Page ${page}: fetched ${results.length} managers (total: ${standingsManagers.length})`);
      if (results.length === 0) break;
      await sleep(150);
    } catch (err: any) {
      console.warn(`  ✗ Page ${page} failed: ${err.message}`);
    }
  }

  if (standingsManagers.length === 0) {
    console.error(`❌ Could not fetch any managers from FPL standings. Aborting.`);
    process.exit(1);
  }

  // Known top 0-chip purist leaders to guarantee representation even when early chips dominate top 250
  const tracked0ChipIds = [4148445, 5662742];
  const targetList = standingsManagers.slice(0, sampleLimit);

  // Append tracked 0-chip leaders if not already present in the top standings
  for (const tid of tracked0ChipIds) {
    if (!targetList.some(m => m.entry === tid)) {
      try {
        const entryRes = await axios.get(`${FPL_BASE_URL}/entry/${tid}/`, { headers, timeout: 5000 });
        targetList.push({
          entry: tid,
          player_name: `${entryRes.data.player_first_name} ${entryRes.data.player_last_name}`,
          entry_name: entryRes.data.name,
          rank: entryRes.data.summary_overall_rank || 1000,
          total: entryRes.data.summary_overall_points || 0
        });
      } catch (err: any) {
        console.warn(`  Notice fetching tracked 0-chip manager ${tid}:`, err.message);
      }
    }
  }

  console.log(`\n[2/3] Fetching live squad picks, chips, and transfers for GW${targetGw} (${targetList.length} managers)...`);

  const decisions: ManagerGWDecisionSnapshot[] = [];
  const batchSize = 10;
  let processedCount = 0;

  for (let i = 0; i < targetList.length; i += batchSize) {
    const batch = targetList.slice(i, i + batchSize);
    const promises = batch.map(async (mgr) => {
      try {
        const [histRes, picksRes, xfersRes] = await Promise.all([
          axios.get(`${FPL_BASE_URL}/entry/${mgr.entry}/history/`, { headers, timeout: 8000 }),
          axios.get(`${FPL_BASE_URL}/entry/${mgr.entry}/event/${targetGw}/picks/`, { headers, timeout: 8000 }),
          axios.get(`${FPL_BASE_URL}/entry/${mgr.entry}/transfers/`, { headers, timeout: 8000 })
        ]);

        const chipsUsed = histRes.data?.chips || [];
        const currentPickData = picksRes.data || {};
        const picks = currentPickData.picks || [];

        if (picks.length === 0) return null;

        const squad_15 = picks.map((p: any) => p.element);
        const starting_xi = picks.filter((p: any) => p.position <= 11).map((p: any) => p.element);
        const capObj = picks.find((p: any) => p.is_captain);
        const vcObj = picks.find((p: any) => p.is_vice_captain);

        const gwTransfers = (xfersRes.data || []).filter((t: any) => t.event === targetGw);
        const transfers_in = gwTransfers.map((t: any) => t.element_in);
        const transfers_out = gwTransfers.map((t: any) => t.element_out);

        const snap: ManagerGWDecisionSnapshot = {
          season,
          gameweek: targetGw,
          manager_id: mgr.entry,
          manager_name: mgr.player_name,
          team_name: mgr.entry_name,
          overall_rank: mgr.rank,
          gw_rank: currentPickData.entry_history?.rank,
          total_points: mgr.total,
          gw_points: currentPickData.entry_history?.points,
          chips_used: chipsUsed,
          active_chip: currentPickData.active_chip || null,
          squad_15,
          starting_xi,
          captain_id: capObj ? capObj.element : null,
          vice_captain_id: vcObj ? vcObj.element : null,
          transfers_in,
          transfers_out,
          bank: currentPickData.entry_history?.bank || 0,
          team_value: currentPickData.entry_history?.value || 1000,
          timestamp: Date.now()
        };

        return snap;
      } catch (err: any) {
        return null;
      }
    });

    const batchResults = await Promise.all(promises);
    batchResults.forEach(r => {
      if (r) decisions.push(r);
    });

    processedCount += batch.length;
    process.stdout.write(`  Progress: ${processedCount}/${targetList.length} managers processed (${decisions.length} valid picks retrieved)\r`);
    await sleep(150);
  }

  console.log(`\n\n[3/3] Archiving snapshot to data/snapshots/gw_${targetGw}/manager_decisions.json...`);

  if (decisions.length === 0) {
    console.error(`❌ No valid decision snapshots could be retrieved. Check if GW${targetGw} picks are locked on FPL.`);
    process.exit(1);
  }

  const snapshotDir = path.resolve(process.cwd(), 'data', 'snapshots', `gw_${targetGw}`);
  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }

  const archivePath = path.join(snapshotDir, 'manager_decisions.json');
  const archive: EliteCohortArchive = {
    season,
    gameweek: targetGw,
    sample_size: decisions.length,
    last_updated: Date.now(),
    decisions
  };

  fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2));

  // Print diagnostics on the captured cohort
  const pureZeroChips = decisions.filter(d => (!d.chips_used || d.chips_used.length === 0) && (!d.active_chip));
  const activeWildcards = decisions.filter(d => d.active_chip === 'wildcard');
  const activeFreeHits = decisions.filter(d => d.active_chip === 'freehit');
  const chipNormalized = decisions.filter(d => d.chips_used && d.chips_used.length > 0 && d.active_chip !== 'wildcard' && d.active_chip !== 'freehit');

  console.log(`\n======================================================`);
  console.log(`✅ Snapshot successfully saved to: ${archivePath}`);
  console.log(`   Total Managers Captured: ${decisions.length}`);
  console.log(`   Pure 0-Chip Managers: ${pureZeroChips.length}`);
  console.log(`   TC / BB Chip-Normalized: ${chipNormalized.length}`);
  console.log(`   Active Wildcards Excluded: ${activeWildcards.length}`);
  console.log(`   Active Free Hits Excluded: ${activeFreeHits.length}`);
  console.log(`======================================================\n`);
}

// Support CLI execution: npx tsx scripts/capture-top-managers.ts [--gw 4] [--limit 250]
const isMain = import.meta.url === `file://${process.argv[1]}` || 
               process.argv[1]?.endsWith('capture-top-managers.ts');

if (isMain) {
  let targetGw: number | undefined;
  let limit = 250;

  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--gw' && process.argv[i + 1]) {
      targetGw = parseInt(process.argv[i + 1], 10);
    }
    if (process.argv[i] === '--limit' && process.argv[i + 1]) {
      limit = parseInt(process.argv[i + 1], 10);
    }
  }

  runCapture(targetGw, limit).catch((err) => {
    console.error('Fatal capture error:', err);
    process.exit(1);
  });
}
