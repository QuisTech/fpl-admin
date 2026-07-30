import fs from 'fs';
import path from 'path';

function analyzeRun() {
  const runFile = path.resolve(process.cwd(), 'backtests', '2023-24', 'run-001.json');
  if (!fs.existsSync(runFile)) {
    console.error(`Run file not found: ${runFile}`);
    process.exit(1);
  }

  const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  const gws = run.gameweeks;
  const transfers = run.transfers;

  console.log("==========================================");
  console.log(`METADATA:`);
  console.log(JSON.stringify(run.metadata, null, 2));
  console.log("==========================================");

  // 1. Transfer ROI
  let positive1 = 0, positive4 = 0, positive8 = 0;
  let total8Gain = 0;
  let worst = 999, best = -999;
  
  transfers.forEach((t: any) => {
    if (t.actualGain1 > 0) positive1++;
    if (t.actualGain4 > 0) positive4++;
    if (t.actualGain8 > 0) positive8++;
    total8Gain += t.actualGain8;
    
    if (t.actualGain8 > best) best = t.actualGain8;
    if (t.actualGain8 < worst) worst = t.actualGain8;
  });

  console.log("\n1. TRANSFER ROI");
  console.log(`Total Transfers: ${transfers.length}`);
  console.log(`Positive after 1 GW: ${positive1}`);
  console.log(`Positive after 4 GWs: ${positive4}`);
  console.log(`Positive after 8 GWs: ${positive8}`);
  console.log(`Average 8-GW ROI: +${(total8Gain / (transfers.length || 1)).toFixed(2)} pts`);
  console.log(`Worst: ${worst}`);
  console.log(`Best: ${best}`);

  // 2. Decision Quality (XP Regret)
  let bestXiXpTotal = 0, chosenXiXpTotal = 0, actualXiTotal = 0;
  let bestCapXpTotal = 0, chosenCapXpTotal = 0, actualCapTotal = 0;
  let projErrorTotal = 0, decErrorTotal = 0, varTotal = 0;

  gws.forEach((gw: any) => {
    if (gw.diagnostics) {
      bestXiXpTotal += gw.diagnostics.bestXiXp;
      chosenXiXpTotal += gw.diagnostics.chosenXiXp;
      actualXiTotal += gw.diagnostics.actualXiPoints;
      
      bestCapXpTotal += gw.diagnostics.bestCaptainXp;
      chosenCapXpTotal += gw.diagnostics.chosenCaptainXp;
      actualCapTotal += gw.diagnostics.actualCaptainPoints;
      
      projErrorTotal += gw.diagnostics.errors.projectionError;
      decErrorTotal += gw.diagnostics.errors.decisionError;
      varTotal += gw.diagnostics.errors.footballRandomness;
    }
  });

  console.log("\n2. DECISION QUALITY (Season Totals)");
  console.log(`Best legal XI XP      = ${bestXiXpTotal.toFixed(1)}`);
  console.log(`Chosen XI XP          = ${chosenXiXpTotal.toFixed(1)}`);
  console.log(`Actual XI             = ${actualXiTotal}`);
  console.log(``);
  console.log(`Best captain XP       = ${bestCapXpTotal.toFixed(1)}`);
  console.log(`Chosen captain XP     = ${chosenCapXpTotal.toFixed(1)}`);
  console.log(`Actual captain        = ${actualCapTotal}`);
  console.log(``);
  console.log(`Projection error      = ${projErrorTotal.toFixed(1)} (Sum of MAE)`);
  console.log(`Decision error        = ${decErrorTotal.toFixed(1)}`);
  console.log(`Football randomness   = ${varTotal.toFixed(1)}`);

  // 3. Projection Error
  let expTotal = 0, actualTotal = 0;
  gws.forEach((gw: any) => {
    expTotal += gw.prediction.expectedSquadPoints;
    actualTotal += gw.prediction.actualSquadPoints;
  });
  console.log("\n3. PROJECTION ERROR (Overall Bias)");
  console.log(`Average Expected: ${(expTotal / gws.length).toFixed(2)}`);
  console.log(`Average Actual: ${(actualTotal / gws.length).toFixed(2)}`);

  // 4. RMSE Over Time
  console.log("\n4. RMSE OVER TIME");
  gws.forEach((gw: any) => {
    console.log(`GW${gw.gw}: ${gw.prediction.rmse.toFixed(2)}`);
  });

  // 5. Wealth Evolution
  console.log("\n5. WEALTH EVOLUTION");
  gws.forEach((gw: any) => {
    const totalWealth = gw.financials.bank + gw.financials.squadSellingValue;
    console.log(`GW${gw.gw} | Bank: £${gw.financials.bank.toFixed(1)}m | Selling: £${gw.financials.squadSellingValue.toFixed(1)}m | Purchase: £${gw.financials.squadPurchaseValue.toFixed(1)}m | Total: £${totalWealth.toFixed(1)}m`);
  });

  // 6. Bench Efficiency
  let benchCostTotal = 0;
  let benchPointsTotal = 0;
  gws.forEach((gw: any) => {
    benchCostTotal += gw.bench.cost;
    benchPointsTotal += gw.bench.points;
  });
  console.log("\n6. BENCH EFFICIENCY");
  console.log(`Average Bench Cost: £${(benchCostTotal / gws.length).toFixed(1)}m`);
  console.log(`Bench Points Lost: ${benchPointsTotal}`);

  // 7. Expected vs Actual transfer gain
  console.log("\n7. EXPECTED VS ACTUAL TRANSFER GAIN");
  let transferError = 0;
  transfers.forEach((t: any) => {
    console.log(`GW${t.gw} Transfer - Expected (1GW): ${t.expectedGain.toFixed(1)}, Actual (1GW): ${t.actualGain1}`);
    transferError += Math.abs(t.expectedGain - t.actualGain1);
  });
  console.log(`Average Transfer Prediction Error (1GW): ${(transferError / (transfers.length || 1)).toFixed(2)} pts`);

  // 8. Chip Audit
  console.log("\n8. CHIP AUDIT");
  gws.forEach((gw: any) => {
    if (gw.action === 'WC' || gw.action === 'FH' || gw.action === 'BB' || gw.action === 'TC') {
      console.log(`${gw.action} played in GW${gw.gw}`);
      console.log(`Points in GW${gw.gw}: ${gw.points}`);
    }
  });

  // 9. Loss Decomposition
  console.log("\n9. LOSS DECOMPOSITION (Averages per GW)");
  const numGws = gws.length || 1;
  console.log(`Average Projection Error : ${(projErrorTotal / numGws).toFixed(2)}`);
  console.log(`Average Decision Error   : ${(decErrorTotal / numGws).toFixed(2)}`);
  console.log(`  ├── Squad construction : 0.00 (TBD)`);
  console.log(`  ├── Transfer timing    : 0.00 (TBD)`);
  console.log(`  ├── XI selection       : ${(chosenXiXpTotal > 0 ? (bestXiXpTotal - chosenXiXpTotal) / numGws : 0).toFixed(2)}`);
  console.log(`  ├── Captain selection  : ${(chosenCapXpTotal > 0 ? (bestCapXpTotal - chosenCapXpTotal) / numGws : 0).toFixed(2)}`);
  console.log(`  └── Chip timing        : 0.00 (TBD)`);
  console.log(`Average Randomness       : ${(varTotal / numGws).toFixed(2)}`);
}

analyzeRun();
