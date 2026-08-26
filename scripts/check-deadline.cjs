const fs = require('fs');

const FPL_BASE_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

(async () => {
  try {
    const isForced = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ||
                     process.env.INPUT_FORCE === 'true' || 
                     process.env.FORCE_RUN === 'true' || 
                     process.argv.includes('--force');

    if (isForced) {
      console.log('⚡ [Deadline Sniper] FORCED MANUAL EXECUTION TRIGGERED! Bypassing deadline window restriction.');
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_run=true\n');
      }
      process.exit(0);
    }

    const response = await fetch(FPL_BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`FPL API responded with status ${response.status}`);
    }

    const data = await response.json();
    
    const nextEvent = data.events.find(e => e.is_next) ?? 
                      data.events.find(e => new Date(e.deadline_time) > new Date());
    
    if (!nextEvent) {
      console.log('[Deadline Sniper] No upcoming gameweek found. Sleeping.');
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_run=false\n');
      }
      process.exit(0);
    }

    const deadlineTime = new Date(nextEvent.deadline_time).getTime();
    const now = Date.now();
    const hoursUntilDeadline = (deadlineTime - now) / (1000 * 60 * 60);

    console.log(`[Deadline Sniper] Gameweek ${nextEvent.id} deadline is at ${nextEvent.deadline_time}.`);
    console.log(`[Deadline Sniper] Time until deadline: ${hoursUntilDeadline.toFixed(2)} hours.`);

    if (hoursUntilDeadline > 0.9 && hoursUntilDeadline <= 2.1) {
      console.log('✅ [Deadline Sniper] GOLDEN WINDOW REACHED! Time to fetch live data.');
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_run=true\n');
      }
      process.exit(0); 
    } else {
      console.log('⏳ [Deadline Sniper] Not in the window. Going back to sleep.');
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_run=false\n');
      }
      process.exit(0); 
    }
  } catch (err) {
    console.error('Error fetching FPL API:', err.message);
    process.exit(1);
  }
})();
