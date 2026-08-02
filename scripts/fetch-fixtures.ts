import axios from 'axios';
import fs from 'fs';
import path from 'path';

const FPL_BASE_URL = "https://fantasy.premierleague.com/api";

function getHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://fantasy.premierleague.com/",
    "Origin": "https://fantasy.premierleague.com",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site"
  };
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const config = { headers: getHeaders(), timeout: 10000 };
      const res = await axios.get(url, config);
      return res;
    } catch (err: any) {
      console.warn(`[Fetch Fixtures] Attempt ${i + 1}/${retries} failed for ${url}: ${err.response?.status || err.message}`);
      if (i < retries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000)); 
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

async function fetchFixtures() {
  console.log('[Fetch Fixtures] Starting fixtures fetch...');
  
  try {
    const fixturesRes = await fetchWithRetry(`${FPL_BASE_URL}/fixtures/`);
    const fixtures = fixturesRes.data;
    
    console.log(`[Fetch Fixtures] Fetched ${fixtures.length} fixtures`);
    
    // Save to data/fixtures-2026-27.json
    const outputPath = path.resolve(process.cwd(), 'data', 'fixtures-2026-27.json');
    const outputDir = path.dirname(outputPath);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(fixtures, null, 2));
    console.log(`[Fetch Fixtures] Saved fixtures to ${outputPath}`);
    
    // Also get current event info
    const staticRes = await fetchWithRetry(`${FPL_BASE_URL}/bootstrap-static/`);
    const currentEvent = staticRes.data.events.find((e: any) => e.is_current) || 
                         staticRes.data.events.find((e: any) => e.is_previous) || 
                         { id: 1 };
    const nextEvent = staticRes.data.events.find((e: any) => new Date(e.deadline_time) > new Date()) || { id: 1 };
    
    console.log(`[Fetch Fixtures] Current event: ${currentEvent.id}, Next event: ${nextEvent.id}`);
    
  } catch (err: any) {
    console.error('[Fetch Fixtures] Failed to fetch fixtures:', err.message);
    process.exit(1);
  }
}

fetchFixtures();
