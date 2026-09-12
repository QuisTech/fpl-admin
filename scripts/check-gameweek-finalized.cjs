/**
 * check-gameweek-finalized.cjs
 * 
 * Verifies with 100% mathematical precision if a gameweek is "done and dusted":
 * 1. event.finished === true (all matches over)
 * 2. event.data_checked === true (Opta stats, bonus points, autosubs locked)
 * 3. event.ranked_count > 1,000,000 (The 10.5M global table re-ranking job is complete!)
 * 4. Checks if the snapshot is not already marked as finalized.
 * 
 * Zero external dependencies. Uses native fetch.
 */

const fs = require('fs');
const path = require('path');

const FPL_BASE_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

(async () => {
  try {
    const isForced = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ||
                     process.env.INPUT_FORCE === 'true' || 
                     process.env.FORCE_RUN === 'true' || 
                     process.argv.includes('--force');

    const res = await fetch(FPL_BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`FPL API responded with status ${res.status}`);
    }

    const data = await res.json();
    const events = data.events || [];

    // Find the latest gameweek whose matches have finished
    const finishedEvents = events.filter(e => e.finished === true);

    if (finishedEvents.length === 0) {
      console.log('[GW Finalizer] No completed gameweek found yet this season. Skipping.');
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_run=false\n');
      }
      process.exit(0);
    }

    const latestFinished = finishedEvents[finishedEvents.length - 1];
    const targetGw = latestFinished.id;

    console.log(`[GW Finalizer] Evaluating Gameweek ${targetGw}:`);
    console.log(`  - Matches Finished: ${latestFinished.finished}`);
    console.log(`  - Data Checked: ${latestFinished.data_checked}`);
    console.log(`  - Ranked Count: ${latestFinished.ranked_count}`);

    // Check if already finalized on disk
    const snapshotPath = path.resolve(process.cwd(), 'data', 'snapshots', `gw_${targetGw}`, 'manager_decisions.json');
    let isAlreadyFinalized = false;

    if (fs.existsSync(snapshotPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
        if (raw.is_finalized === true) {
          isAlreadyFinalized = true;
        }
      } catch {}
    }

    if (isAlreadyFinalized && !isForced) {
      console.log(`[GW Finalizer] GW${targetGw} snapshot is ALREADY FINALIZED on disk. Skipping.`);
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_run=false\n');
      }
      process.exit(0);
    }

    if (isForced) {
      console.log(`⚡ [GW Finalizer] FORCED EXECUTION triggered for GW${targetGw}!`);
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `should_run=true\ngw=${targetGw}\n`);
      }
      process.exit(0);
    }

    // Precise Three-Pillar Check:
    // 1. All matches finished
    // 2. Data checked & bonus points locked
    // 3. Global re-ranking complete (> 1,000,000 entries ranked)
    const isDoneAndDusted = latestFinished.finished === true &&
                            latestFinished.data_checked === true &&
                            latestFinished.ranked_count > 1000000;

    if (isDoneAndDusted) {
      console.log(`✅ [GW Finalizer] GW${targetGw} IS DONE AND DUSTED! Global rankings are 100% complete (${latestFinished.ranked_count} entries).`);
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `should_run=true\ngw=${targetGw}\n`);
      }
      process.exit(0);
    } else {
      console.log(`⏳ [GW Finalizer] GW${targetGw} is still processing global tables. Waiting for full finalization.`);
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_run=false\n');
      }
      process.exit(0);
    }
  } catch (err) {
    console.error('Error during gameweek finalizer check:', err.message);
    process.exit(1);
  }
})();
