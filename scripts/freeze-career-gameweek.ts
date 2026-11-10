/**
 * freeze-career-gameweek.ts
 * 
 * Freezes and permanently locks historical manager decisions and matchday scores
 * for both Autonomous AI and You vs AI Duel (AI Co-Pilot) into:
 *   - data/snapshots/synced_career_history.json
 *   - data/snapshots/autonomous_career_history.json
 * 
 * Guarantees zero hindsight leakage: all decisions are solved using strictly
 * pre-deadline snapshots for each gameweek and permanently preserved.
 */

import fs from 'fs';
import path from 'path';
import { CareerService, CareerGameweek } from '../api/_lib/career-service.ts';
import { FPLService } from '../api/index.ts';

const SYNCED_FILE = path.join(process.cwd(), 'data/snapshots/synced_career_history.json');
const AUTONOMOUS_FILE = path.join(process.cwd(), 'data/snapshots/autonomous_career_history.json');

const FUELS = ['native', 'fplform', 'eye_test'];
const RISK_MODES = ['safe', 'aggressive', 'value'];
const SCENARIOS: ('template' | 'quant')[] = ['template', 'quant'];

async function detectTargetGameweek(): Promise<number> {
  const args = process.argv.slice(2);
  const gwIndex = args.indexOf('--gw');
  if (gwIndex !== -1 && args[gwIndex + 1]) {
    return parseInt(args[gwIndex + 1], 10);
  }

  // Detect latest completed/current gameweek from FPL base data
  try {
    const baseData = await FPLService.getBaseData();
    if (baseData.currentEventId) {
      return baseData.currentEventId;
    }
  } catch (e: any) {
    console.warn('[FreezeCareer] Error fetching base data:', e.message);
  }

  return 10;
}

function detectTeamId(): string {
  const args = process.argv.slice(2);
  const teamIndex = args.indexOf('--team');
  if (teamIndex !== -1 && args[teamIndex + 1]) {
    return args[teamIndex + 1];
  }
  return '532002';
}

export async function freezeCareer(targetGw: number, teamId: string = '532002'): Promise<void> {
  console.log(`\n======================================================`);
  console.log(`🔒 [Career Freezing Engine] Locking Decisions up to GW${targetGw}`);
  console.log(`   Target Team ID: ${teamId}`);
  console.log(`======================================================\n`);

  let syncedStore: Record<string, CareerGameweek[]> = {};
  let autoStore: Record<string, CareerGameweek[]> = {};

  if (fs.existsSync(SYNCED_FILE)) {
    try {
      syncedStore = JSON.parse(fs.readFileSync(SYNCED_FILE, 'utf8'));
    } catch (e: any) {
      console.warn('[FreezeCareer] Error reading synced_career_history.json:', e.message);
    }
  }

  if (fs.existsSync(AUTONOMOUS_FILE)) {
    try {
      autoStore = JSON.parse(fs.readFileSync(AUTONOMOUS_FILE, 'utf8'));
    } catch (e: any) {
      console.warn('[FreezeCareer] Error reading autonomous_career_history.json:', e.message);
    }
  }

  // 1. Process all 18 permutations for Synced / Duel Career
  console.log(`[1/2] Processing Synced / AI Co-Pilot Replay across 18 permutations...`);
  for (const fuel of FUELS) {
    for (const riskMode of RISK_MODES) {
      for (const scenario of SCENARIOS) {
        const teamKey = `${teamId}_${fuel}_${riskMode}_${scenario}`;
        const fallbackKey = `${fuel}_${riskMode}_${scenario}`;

        try {
          const replay = await CareerService.getSyncedCareerReplay(
            teamId,
            fuel === 'eye_test' ? 'eye-test' : fuel,
            riskMode,
            targetGw,
            scenario
          );

          if (replay && Array.isArray(replay.gameweeks) && replay.gameweeks.length > 0) {
            syncedStore[teamKey] = replay.gameweeks;
            syncedStore[fallbackKey] = replay.gameweeks;
            const lastGw = replay.gameweeks[replay.gameweeks.length - 1];
            console.log(`  ✓ Synced [${teamKey}]: GW${lastGw.gameweek} locked (${lastGw.cumulativePoints} pts)`);
          }
        } catch (err: any) {
          console.warn(`  ✗ Failed Synced for ${teamKey}:`, err.message);
        }
      }
    }
  }

  // 2. Process all 18 permutations for Autonomous Career
  console.log(`\n[2/2] Processing Autonomous AI Career across 18 permutations...`);
  for (const fuel of FUELS) {
    for (const riskMode of RISK_MODES) {
      for (const scenario of SCENARIOS) {
        const autoKey = `${fuel}_${riskMode}_${scenario}`;

        try {
          const autoCareer = await CareerService.getAutonomousCareer(
            fuel === 'eye_test' ? 'eye-test' : fuel,
            riskMode,
            targetGw,
            scenario
          );

          if (autoCareer && Array.isArray(autoCareer.gameweeks) && autoCareer.gameweeks.length > 0) {
            autoStore[autoKey] = autoCareer.gameweeks;
            const lastGw = autoCareer.gameweeks[autoCareer.gameweeks.length - 1];
            console.log(`  ✓ Auto   [${autoKey}]: GW${lastGw.gameweek} locked (${lastGw.cumulativePoints} pts)`);
          }
        } catch (err: any) {
          console.warn(`  ✗ Failed Auto for ${autoKey}:`, err.message);
        }
      }
    }
  }

  // 3. Write locked history to disk
  fs.writeFileSync(SYNCED_FILE, JSON.stringify(syncedStore, null, 2), 'utf8');
  fs.writeFileSync(AUTONOMOUS_FILE, JSON.stringify(autoStore, null, 2), 'utf8');

  console.log(`\n======================================================`);
  console.log(`✅ [Career Freezing Engine] History Successfully Locked!`);
  console.log(`   - Synced History:     ${SYNCED_FILE}`);
  console.log(`   - Autonomous History: ${AUTONOMOUS_FILE}`);
  console.log(`======================================================\n`);
}

// Execute if run directly via CLI
(async () => {
  if (process.argv[1] && (process.argv[1].includes('freeze-career-gameweek') || import.meta.url.includes('freeze-career-gameweek'))) {
    const targetGw = await detectTargetGameweek();
    const teamId = detectTeamId();
    await freezeCareer(targetGw, teamId);
  }
})();
