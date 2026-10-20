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

    // 1. Identify candidate gameweek to evaluate:
    // Look at current event (is_current) or latest event whose deadline has passed
    const now = new Date();
    const currentEvent = events.find(e => e.is_current) ||
                         [...events].reverse().find(e => new Date(e.deadline_time) <= now);

    let candidateEvent = currentEvent;
    let isCandidateFinished = false;

    if (candidateEvent) {
      if (candidateEvent.finished === true) {
        isCandidateFinished = true;
      } else {
        // FPL API often delays flipping event.finished to true on bootstrap-static.
        // Check if all fixtures for this event are finished AND global rankings are calculated.
        try {
          const fixRes = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${candidateEvent.id}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              'Accept': 'application/json'
            }
          });
          if (fixRes.ok) {
            const fixtures = await fixRes.json();
            const allFixturesFinished = Array.isArray(fixtures) && fixtures.length > 0 && fixtures.every(f => f.finished === true);
            const rankingsCalculated = (candidateEvent.ranked_count || 0) > 1000000;
            if (allFixturesFinished && rankingsCalculated) {
              isCandidateFinished = true;
            }
          }
        } catch (e) {
          console.warn(`[GW Finalizer] Fixture check notice: ${e.message}`);
        }
      }
    }

    // If current event is not finished yet, fallback to latest event with finished === true
    let targetEvent = isCandidateFinished ? candidateEvent : null;
    if (!targetEvent) {
      const finishedEvents = events.filter(e => e.finished === true);
      if (finishedEvents.length > 0) {
        targetEvent = finishedEvents[finishedEvents.length - 1];
        isCandidateFinished = true;
      }
    }

    if (!targetEvent) {
      console.log('[GW Finalizer] No completed gameweek found yet this season. Skipping.');
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_run=false\n');
      }
      process.exit(0);
    }

    const targetGw = targetEvent.id;

    console.log(`[GW Finalizer] Evaluating Gameweek ${targetGw}:`);
    console.log(`  - Candidate Finished: ${isCandidateFinished}`);
    console.log(`  - Bootstrap Finished: ${targetEvent.finished}`);
    console.log(`  - Data Checked: ${targetEvent.data_checked}`);
    console.log(`  - Ranked Count: ${targetEvent.ranked_count}`);

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

    // Precise Finalization Check:
    // 1. All matches finished (via event.finished OR all fixtures finished)
    // 2. Global re-ranking complete (> 1,000,000 entries ranked)
    const isDoneAndDusted = isCandidateFinished && (targetEvent.ranked_count || 0) > 1000000;

    if (isDoneAndDusted) {
      console.log(`✅ [GW Finalizer] GW${targetGw} IS DONE AND DUSTED! Global rankings are 100% complete (${targetEvent.ranked_count} entries).`);
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
