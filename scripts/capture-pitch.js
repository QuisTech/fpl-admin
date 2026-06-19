import { chromium } from 'playwright';
import path from 'path';

const OUT_FILE = path.join(process.cwd(), 'public', 'fpl_horizon_pitch_raw.png');

(async () => {
  try {
    console.log("Launching browser against live app...");
    const browser = await chromium.launch();
    
    // Set a good 16:10 desktop resolution
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await desktopContext.newPage();
    
    console.log("Navigating to https://fplhorizon.app/...");
    await page.goto('https://fplhorizon.app/');
    
    console.log("Waiting for UI to render...");
    await page.waitForTimeout(5000);
    
    console.log("Syncing team...");
    await page.getByPlaceholder('TEAM ID').fill('1');
    await page.getByRole('button', { name: 'SYNC TEAM' }).click();
    
    console.log("Waiting for data to load (10s)...");
    await page.waitForTimeout(10000); 

    console.log("Switching to PITCH tab...");
    await page.getByRole('button', { name: 'PITCH' }).click();
    await page.waitForTimeout(2000); // Wait a couple of seconds for tab transition and pitch rendering

    console.log(`Taking screenshot and saving to ${OUT_FILE}...`);
    // Capture the normal viewport dashboard view
    await page.screenshot({ path: OUT_FILE });

    console.log("Screenshot saved successfully!");
    await browser.close();
  } catch (e) {
    console.error("Failed to generate screenshot:", e);
    process.exit(1);
  }
})();
