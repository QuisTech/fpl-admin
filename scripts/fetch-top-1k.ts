import axios from 'axios';
import fs from 'fs';
import path from 'path';

const FPL_BASE_URL = 'https://fantasy.premierleague.com/api';
const LEAGUE_ID = process.env.FPL_LEAGUE_ID || '314'; // Default to Overall League
const MANAGERS_TO_SCAN = parseInt(process.env.FPL_TOP_N_MANAGERS || '1000'); // Default to 1000 managers
const PAGES_TO_SCAN = Math.ceil(MANAGERS_TO_SCAN / 50);
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// Fetch with retry and exponential backoff
async function fetchWithRetry(url: string, retries = 3, delay = 2000): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { headers, timeout: 5000 });
      return response.data;
    } catch (err: any) {
      const status = err.response?.status;
      console.warn(`[Fetch] Attempt ${i + 1}/${retries} failed for ${url}: ${status || err.message}`);
      
      if (status === 404) {
        // If 404, the manager might not have played this GW or does not exist
        return null;
      }
      
      if (i < retries - 1) {
        await sleep(delay * Math.pow(2, i));
      } else {
        throw err;
      }
    }
  }
}

async function run() {
  console.log('[Top 1K Fetcher] Starting Top 1,000 FPL Manager Scan...');
  
  try {
    // 1. Fetch nextEventId to determine previous completed GW (deadline picks lock bypass)
    console.log('[Top 1K Fetcher] Fetching bootstrap-static...');
    const bootstrap = await fetchWithRetry(`${FPL_BASE_URL}/bootstrap-static/`);
    const nextEvent = bootstrap.events.find((e: any) => e.is_next) ?? 
                      bootstrap.events.find((e: any) => new Date(e.deadline_time) > new Date());
    const nextEventId = nextEvent ? nextEvent.id : 1;
    const currentGW = Math.max(1, nextEventId - 1);
    
    console.log(`[Top 1K Fetcher] Target Event: GW${nextEventId} (previous completed reference: GW${currentGW})`);
    
    // 2. Fetch manager IDs from Standings pages
    const managerIds: number[] = [];
    const targetCount = PAGES_TO_SCAN * 50;
    console.log(`[Top 1K Fetcher] Retrieving Top ${targetCount} manager IDs from League ${LEAGUE_ID} (pages 1 to ${PAGES_TO_SCAN})...`);
    for (let page = 1; page <= PAGES_TO_SCAN; page++) {
      const standingsUrl = `${FPL_BASE_URL}/leagues-classic/${LEAGUE_ID}/standings/?page_standings=${page}`;
      const standingsData = await fetchWithRetry(standingsUrl);
      if (standingsData && standingsData.standings && Array.isArray(standingsData.standings.results)) {
        if (standingsData.standings.results.length === 0) {
          // If page 1 or current page is empty, standings have not been calculated yet (e.g., GW1 pre-season)
          console.log(`[Top 1K Fetcher] Standings page ${page} returned 0 results.`);
          break;
        }
        standingsData.standings.results.forEach((res: any) => {
          if (res.entry) {
            managerIds.push(res.entry);
          }
        });
      } else {
        break;
      }
      // Be polite to FPL server
      await sleep(200);
    }
    
    const finalManagerIds = managerIds.slice(0, MANAGERS_TO_SCAN);
    console.log(`[Top 1K Fetcher] Gathered ${finalManagerIds.length} manager IDs.`);
    
    // Construct a name lookup map using bootstrap elements
    const nameMap: Record<number, string> = {};
    bootstrap.elements.forEach((el: any) => {
      nameMap[el.id] = el.web_name;
    });

    // Graceful fallback for Gameweek 1 or when league standings are empty prior to matches
    if (finalManagerIds.length === 0) {
      console.warn(`[Top 1K Fetcher] ⚠️ League ${LEAGUE_ID} standings are unpopulated (GW1 pre-season / before round 1 scoring).`);
      console.log('[Top 1K Fetcher] ℹ️ Generating baseline EO & sentiment from official global player ownership (selected_by_percent)...');

      const finalPlayers: Record<number, { name: string; ownership: number; started: number; eo: number; captain: number; tripleCaptain: number }> = {};
      bootstrap.elements.forEach((el: any) => {
        const ownership = parseFloat(el.selected_by_percent || '0');
        finalPlayers[el.id] = {
          name: el.web_name || 'Unknown',
          ownership: ownership,
          started: ownership,
          eo: ownership,
          captain: 0,
          tripleCaptain: 0
        };
      });

      const outputData = {
        gameweek: nextEventId,
        lastUpdated: Date.now(),
        sampleSize: bootstrap.total_players || 0,
        isFallback: true,
        players: finalPlayers
      };

      const destDir = path.resolve(process.cwd(), 'data');
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      const destPath = path.join(destDir, 'top_1000_eo.json');
      fs.writeFileSync(destPath, JSON.stringify(outputData, null, 2));

      console.log(`[Top 1K Fetcher] ✅ Successfully saved fallback ownership data to: ${destPath}`);
      return;
    }
    
    // 3. Scan picks for all managers in batches
    const playerTallies: Record<number, { ownership: number; started: number; captain: number; tripleCaptain: number; totalMultiplier: number }> = {};
    let effectiveManagers = 0;
    let failedCount = 0;
    
    console.log(`[Top 1K Fetcher] Fetching picks for GW${currentGW} in batches of ${BATCH_SIZE}...`);
    
    for (let i = 0; i < finalManagerIds.length; i += BATCH_SIZE) {
      const batch = finalManagerIds.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (id) => {
        const url = `${FPL_BASE_URL}/entry/${id}/event/${currentGW}/picks/`;
        try {
          const pickData = await fetchWithRetry(url, 3, 1000);
          if (pickData && pickData.picks) {
            if (pickData.active_chip === 'freehit') {
              console.log(`[Top 1K Fetcher] Entry ${id} used Free Hit in GW${currentGW}. Skipping to avoid reversion noise.`);
              return;
            }
            pickData.picks.forEach((p: any) => {
              const pId = p.element;
              const isStarter = p.position <= 11;
              const multiplier = p.multiplier;
              
              if (!playerTallies[pId]) {
                playerTallies[pId] = { ownership: 0, started: 0, captain: 0, tripleCaptain: 0, totalMultiplier: 0 };
              }
              
              playerTallies[pId].ownership += 1;
              if (isStarter) {
                playerTallies[pId].started += 1;
              }
              if (multiplier === 2) {
                playerTallies[pId].captain += 1;
              } else if (multiplier === 3) {
                playerTallies[pId].tripleCaptain += 1;
              }
              playerTallies[pId].totalMultiplier += multiplier;
            });
            effectiveManagers++;
          } else {
            failedCount++;
          }
        } catch (err: any) {
          console.warn(`[Top 1K Fetcher] Skipping entry ${id} due to fetch error.`);
          failedCount++;
        }
      });
      
      await Promise.all(promises);
      
      // Update progress
      if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= finalManagerIds.length) {
        console.log(`[Progress] Scanned ${Math.min(i + BATCH_SIZE, finalManagerIds.length)}/${finalManagerIds.length} manager picks...`);
      }
      
      await sleep(BATCH_DELAY_MS);
    }
    
    console.log(`[Top 1K Fetcher] Scan Complete. Scanned: ${effectiveManagers}, Failed: ${failedCount}`);
    
    // 4. Calculate final percentages and construct output JSON
    const finalPlayers: Record<number, { name: string; ownership: number; started: number; eo: number; captain: number; tripleCaptain: number }> = {};
    const sampleSize = effectiveManagers || 1; // Prevent division by zero
    
    Object.keys(playerTallies).forEach((pIdStr) => {
      const pId = parseInt(pIdStr);
      const tally = playerTallies[pId];
      
      const ownershipPercent = parseFloat(((tally.ownership / sampleSize) * 100).toFixed(1));
      const startedPercent = parseFloat(((tally.started / sampleSize) * 100).toFixed(1));
      const captainPercent = parseFloat(((tally.captain / sampleSize) * 100).toFixed(1));
      const tripleCaptainPercent = parseFloat(((tally.tripleCaptain / sampleSize) * 100).toFixed(1));
      
      // EO calculation: totalMultiplier sum divided by sample size * 100
      const eoPercent = parseFloat(((tally.totalMultiplier / sampleSize) * 100).toFixed(1));
      
      finalPlayers[pId] = {
        name: nameMap[pId] || 'Unknown',
        ownership: ownershipPercent,
        started: startedPercent,
        eo: eoPercent,
        captain: captainPercent,
        tripleCaptain: tripleCaptainPercent
      };
    });
    
    const outputData = {
      gameweek: currentGW,
      lastUpdated: Date.now(),
      sampleSize: effectiveManagers,
      players: finalPlayers
    };
    
    const destDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    const destPath = path.join(destDir, 'top_1000_eo.json');
    fs.writeFileSync(destPath, JSON.stringify(outputData, null, 2));
    
    console.log(`[Top 1K Fetcher] ✅ Successfully saved Top 1,000 manager EO data to: ${destPath}`);
  } catch (error: any) {
    console.error('[Top 1K Fetcher] ❌ Fatal error running scanner:', error.message);
    process.exit(1);
  }
}

run();
