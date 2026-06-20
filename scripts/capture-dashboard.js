import { chromium } from 'playwright';
import path from 'path';

const OUT_FILE = path.join(process.cwd(), 'public', 'fpl_horizon_dashboard.png');

(async () => {
  try {
    console.log("Launching browser against live app...");
    const browser = await chromium.launch();
    
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await desktopContext.newPage();
    
    console.log("Navigating to https://fplhorizon.app/...");
    await page.goto('https://fplhorizon.app/');
    
    console.log("Waiting for UI to render...");
    await page.waitForTimeout(5000);
    
    let success = false;
    for (let attempts = 0; attempts < 3; attempts++) {
      console.log(`Syncing team (Attempt ${attempts + 1})...`);
      // Clear the input field if retrying
      await page.getByPlaceholder('TEAM ID').fill('');
      await page.getByPlaceholder('TEAM ID').fill('3018660');
      await page.getByRole('button', { name: 'SYNC TEAM' }).click();
      
      console.log("Waiting for data to load...");
      
      try {
        await page.waitForFunction(() => {
          const text = document.body.innerText;
          // Wait for the exact expected points to show up, or at least anything above 45 xP
          return text.includes('+52.0 xP') || text.includes('52.0 xP') || text.match(/\+(5[0-9]\.[0-9]) xP/);
        }, { timeout: 35000 });
        
        console.log("Data loaded successfully without engine error!");
        success = true;
        break; 
      } catch (err) {
        console.log("Timeout waiting for successful load. Checking for ENGINE ERROR...");
        const text = await page.evaluate(() => document.body.innerText);
        if (text.includes("ENGINE ERROR")) {
          console.log("Engine error detected. Reloading page to retry...");
        } else {
          console.log("Unknown error or timeout. Text present: " + text.substring(0, 100));
        }
        await page.reload();
        await page.waitForTimeout(5000);
      }
    }

    if (!success) {
      console.log("WARNING: Failed to load data properly after 3 attempts.");
    } else {
      // Give it 3 extra seconds for animations and avatar images to fully settle
      await page.waitForTimeout(3000);
    }

    console.log(`Taking screenshot and saving to ${OUT_FILE}...`);
    await page.screenshot({ path: OUT_FILE });

    console.log("Screenshot saved successfully!");
    await browser.close();
  } catch (e) {
    console.error("Failed to generate screenshot:", e);
    process.exit(1);
  }
})();
