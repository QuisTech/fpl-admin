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
    const now = Date.now();

    // Determine current active gameweek (whose deadline has passed)
    const currentEvent = data.events?.find(e => e.is_current) ||
                         [...(data.events || [])].reverse().find(e => new Date(e.deadline_time).getTime() <= now);

    if (!currentEvent) {
      console.log('[Post-Deadline Check] No active/past gameweek found. Sleeping.');
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_run=false\n');
      }
      process.exit(0);
    }

    const currentGw = currentEvent.id;
    const snapshotPath = path.resolve(process.cwd(), 'data', 'snapshots', `gw_${currentGw}`, 'manager_decisions.json');
    const snapshotExists = fs.existsSync(snapshotPath);

    if (snapshotExists && !isForced) {
      console.log(`[Post-Deadline Check] Snapshot for GW${currentGw} already exists at ${snapshotPath}. Skipping.`);
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_run=false\n');
      }
      process.exit(0);
    }

    if (isForced) {
      console.log(`⚡ [Post-Deadline Check] FORCED EXECUTION for GW${currentGw}! Bypassing window restriction.`);
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `should_run=true\ngw=${currentGw}\n`);
      }
      process.exit(0);
    }

    const deadlineTime = new Date(currentEvent.deadline_time).getTime();
    const hoursSinceDeadline = (now - deadlineTime) / (1000 * 60 * 60);

    console.log(`[Post-Deadline Check] GW${currentGw} deadline was at ${currentEvent.deadline_time}.`);
    console.log(`[Post-Deadline Check] Hours since deadline: ${hoursSinceDeadline.toFixed(2)}h.`);

    // Trigger window: 15 minutes (0.25h) to 4 hours after deadline
    if (hoursSinceDeadline >= 0.25 && hoursSinceDeadline <= 4.0) {
      console.log(`✅ [Post-Deadline Check] POST-DEADLINE WINDOW ACTIVE for GW${currentGw}! Ready to archive top manager picks.`);
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `should_run=true\ngw=${currentGw}\n`);
      }
      process.exit(0);
    } else {
      console.log(`⏳ [Post-Deadline Check] Outside post-deadline window (0.25h - 4.0h). Skipping.`);
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_run=false\n');
      }
      process.exit(0);
    }
  } catch (err) {
    console.error('Error during post-deadline check:', err.message);
    process.exit(1);
  }
})();
