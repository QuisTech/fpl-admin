import { chromium } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const URL = `https://fpl-admin-eight.vercel.app/`;
const OUT_FILE = path.join(__dirname, '..', 'public', 'fpl_horizon_dashboard.png');

async function waitForServer(url, maxRetries = 30, interval = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch (e) {
      // expected, server not up yet
    }
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}

(async () => {
  console.log("Launching browser against live app...");
  const browser = await chromium.launch();
  
  // Set viewport to a typical desktop size for a good screenshot
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  
  console.log(`Navigating to ${URL}...`);
  await page.goto(URL);
  
  try {
    console.log("Waiting for UI to render...");
    await page.waitForTimeout(5000);
    
    // Debug screenshot
    await page.screenshot({ path: path.join(__dirname, '..', 'public', 'debug_screenshot.png') });

    console.log("Syncing team...");
    await page.getByPlaceholder('TEAM ID').fill('1');
    await page.getByRole('button', { name: 'SYNC TEAM' }).click();
    
    console.log("Waiting for data to load (10s)...");
    await page.waitForTimeout(10000); 

    console.log("Switching to OPTIMIZER tab...");
    await page.getByRole('button', { name: 'OPTIMIZER' }).click();
    await page.waitForTimeout(1000); // Wait a second for tab transition

    console.log(`Taking screenshot and saving to ${OUT_FILE}...`);
    // Capture the normal viewport dashboard view
    await page.screenshot({ path: OUT_FILE });

    console.log("Screenshot saved successfully!");
  } catch (e) {
    console.error("Playwright script failed:", e);
    await page.screenshot({ path: path.join(__dirname, '..', 'public', 'error_screenshot.png') });
  }

  await browser.close();
  process.exit(0);
})();
