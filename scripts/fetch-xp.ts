import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

async function fetchFPLForm(browser: any) {
  console.log('\n--- Fetching from FPLForm ---');
  const page = await browser.newPage();
  try {
    await page.goto('https://fplform.com/fpl-predicted-points', { waitUntil: 'networkidle' });
    console.log('[FPLForm] Searching for CSV download options or extracting table data...');
    
    // Fallback: Scrape the table directly from the DOM
    const tableData = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tr'));
      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        return cells.map(cell => '"' + (cell.textContent || '').trim().replace(/"/g, '""') + '"').join(',');
      }).join('\n');
    });

    if (tableData.length > 100) {
      const destPath = path.resolve(process.cwd(), 'data', 'fplform.csv');
      fs.writeFileSync(destPath, tableData);
      console.log(`[FPLForm] ✅ Successfully scraped HTML table into CSV: ${destPath}`);
      return true;
    } else {
      console.log('[FPLForm] ❌ Table scraping failed (table not found).');
      return false;
    }
  } catch (err: any) {
    console.log(`[FPLForm] ❌ Error: ${err.message}`);
    return false;
  } finally {
    await page.close();
  }
}

async function fetchFPLReview(browser: any) {
  console.log('\n--- Fetching from FPLReview ---');
  const page = await browser.newPage();
  try {
    // FPLReview often has Cloudflare checks. We wait up to 15 seconds to pass it.
    await page.goto('https://fplreview.com/massive-data-export/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('[FPLReview] Page loaded. Waiting to see if we clear Cloudflare/Bot-check...');
    
    // Wait a few seconds for any CAPTCHA/Cloudflare redirect to finish
    await page.waitForTimeout(5000);

    // Look for ANY button or link that might be the export trigger
    const locators = [
      page.locator('button:has-text("CSV")'),
      page.locator('a:has-text("CSV")'),
      page.locator('button:has-text("Export")'),
      page.locator('text=/Download/i')
    ];

    let downloadTriggered = false;
    for (const locator of locators) {
      const count = await locator.count();
      if (count > 0) {
        console.log(`[FPLReview] Found export trigger. Attempting download...`);
        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15000 }),
            locator.first().click({ timeout: 5000 })
          ]);
          
          const destPath = path.resolve(process.cwd(), 'data', 'fplreview.csv');
          await download.saveAs(destPath);
          console.log(`[FPLReview] ✅ Successfully downloaded CSV to: ${destPath}`);
          downloadTriggered = true;
          break;
        } catch (e) {
          console.log(`[FPLReview] Trigger failed. Trying next...`);
        }
      }
    }

    if (!downloadTriggered) {
      console.log('[FPLReview] Could not trigger download. Falling back to DOM Scraping...');
      // Try to find the massive data table and scrape it
      const tableData = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table tr'));
        return rows.map(row => {
          const cells = Array.from(row.querySelectorAll('th, td'));
          return cells.map(cell => '"' + (cell.textContent || '').trim().replace(/"/g, '""') + '"').join(',');
        }).join('\n');
      });

      if (tableData.length > 100) {
        const destPath = path.resolve(process.cwd(), 'data', 'fplreview_scraped.csv');
        fs.writeFileSync(destPath, tableData);
        console.log(`[FPLReview] ✅ Successfully scraped HTML table into CSV: ${destPath}`);
        return true;
      } else {
        console.log('[FPLReview] ❌ Failed to find data table. Cloudflare might have blocked the headless browser entirely.');
        return false;
      }
    }
    return true;
  } catch (err: any) {
    console.log(`[FPLReview] ❌ Error: ${err.message}`);
    return false;
  } finally {
    await page.close();
  }
}

async function generateNativeFallback() {
  console.log('\n--- Generating Native API Fallback (Hybrid Engine) ---');
  try {
    const response = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    const data = response.data;
    
    const teamMap: Record<number, string> = {};
    data.teams.forEach((t: any) => teamMap[t.id] = t.short_name);
    
    const posMap: Record<number, string> = {};
    data.element_types.forEach((p: any) => posMap[p.id] = p.singular_name_short);

    let csvData = "";
    data.elements.forEach((el: any) => {
      // Legacy cols: [0]="", [1]=Name, [2]="", [3]=Team, [4]=Pos, [5]=Cost, [6]=Merit, [7]="", [8]=PlayProb
      const name = (el.web_name || '').replace(/"/g, '""');
      const team = teamMap[el.team] || 'UNK';
      const pos = posMap[el.element_type] || 'UNK';
      const cost = (el.now_cost / 10).toFixed(1);
      const merit = parseFloat(el.ep_next) || 0;
      
      let prob = el.chance_of_playing_next_round;
      if (prob === null || prob === undefined) prob = 100;
      prob = (prob / 100).toFixed(2);
      
      csvData += `"","${name}","","${team}","${pos}","${cost}","${merit}","","${prob}"\n`;
    });

    const destDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    const destPath = path.join(destDir, 'fpl_native.csv');
    fs.writeFileSync(destPath, csvData);
    
    console.log(`[Native Fallback] ✅ Successfully generated internal xP fuel to: ${destPath}`);
    return true;
  } catch (err: any) {
    console.log(`[Native Fallback] ❌ Error generating native fallback: ${err.message}`);
    return false;
  }
}

(async () => {
  console.log('[Fetcher] Launching Headless Browser to test BOTH data sources...');
  
  // ALWAYS generate native fallback
  const nativeSuccess = await generateNativeFallback();
  if (!nativeSuccess) {
    console.error('❌ FATAL: Native fallback generation failed.');
  }

  const browser = await chromium.launch({ headless: true });

  let fplFormSuccess = false;
  for (let i = 1; i <= 3; i++) {
    fplFormSuccess = await fetchFPLForm(browser);
    if (fplFormSuccess) break;
    console.log(`[Retry] FPLForm fetch failed. Retrying in 10 seconds... (Attempt ${i}/3)`);
    await new Promise(r => setTimeout(r, 10000));
  }

  const fplReviewSuccess = await fetchFPLReview(browser);
  await browser.close();

  console.log('\n--- Final Fetch Report ---');
  console.log(`FPLForm: ${fplFormSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`FPLReview: ${fplReviewSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);

  if (!fplFormSuccess) {
    console.warn('⚠️ CRITICAL: FPLForm data could not be fetched. Falling back to native FPL API generation...');
    if (nativeSuccess) {
      fs.copyFileSync(path.resolve(process.cwd(), 'data', 'fpl_native.csv'), path.resolve(process.cwd(), 'data', 'fplform.csv'));
      console.log('✅ Copied fpl_native.csv to fplform.csv to ensure backwards compatibility.');
    } else {
      console.error('❌ FATAL: Both external scrapers AND native fallback failed.');
      process.exit(1);
    }
  }
})();
