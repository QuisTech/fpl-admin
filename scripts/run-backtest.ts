import fs from 'fs';
import path from 'path';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { Simulator, SquadState, Action, applyAction, getSellingPrice } from '../api/_lib/simulator.js';
import {  ProjectionEngine, UtilityParameters, HistoricalOracle } from '../api/_lib/projection.js';
import { solveOptimalSquad, solveStartingXI, solveCaptain } from '../api/_lib/lp-solver.js';
import { loadWeights } from '../api/_lib/weights-loader.js';
const DEFAULT_PARAMETERS = loadWeights('baseline');

// Setup argument parsing
const args = process.argv.slice(2);
let weightName = 'baseline';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--weights' && i + 1 < args.length) {
    weightName = args[i + 1].replace('.json', ''); // allow passing with or without .json
    i++;
  }
}

// Load configurations
let OPTIMIZED_PARAMETERS: UtilityParameters;
try {
  OPTIMIZED_PARAMETERS = loadWeights(weightName);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

console.log(`[Backtest] Loaded configuration: ${weightName}`);

// Simple seeded PRNG for deterministic simulation
function seededRandom(seed: number) {
  let value = seed;
  return function() {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}
const rng = seededRandom(42);

async function runBacktest() {
  const season = '2023-24';
  const provider = new VaastavProvider();
  await provider.loadSeason(season);

  console.log(`\nStarting ${season} Backtest Simulation Loop...`);
  const OPTIMIZED_PARAMETERS = { ...DEFAULT_PARAMETERS };

  const runLog: any = {
    metadata: {
      engineVersion: "v1.0.0-research",
      projectionVersion: "linear-v2",
      utilityVersion: "ev-unified",
      riskMode: "safe",
      beamWidth: 200,
      timestamp: new Date().toISOString(),
      configName: weightName,
      evaluation: {
        zeroLeakage: provider.supportsHistoricalAnnouncements ? "YES" : "NO",
        historicalFixtureAnnouncements: provider.supportsHistoricalAnnouncements ? "YES" : "NO"
      }
    },
    season,
    parameters: OPTIMIZED_PARAMETERS,
    seed: 42,
    gameweeks: [],
    finalScore: 0,
    finalBank: 0,
    totalHits: 0,
    transfers: []
  };

  let currentState: SquadState | null = null;
  const startGw = 1;
  const endGw = 38;

  // Track transfers to calculate ROI
  const activeTransfers: any[] = [];

  for (let gw = startGw; gw <= endGw; gw++) {
    console.log(`\n--- Simulating GW${gw} ---`);
    
    const currentBank = currentState ? currentState.bank : 1000;
    const currentFTs = currentState ? currentState.freeTransfers : 0;
    const chips = currentState ? currentState.chipState : { 'WC': 2, 'FH': 1, 'BB': 1, 'TC': 1 };
    
    const snapshot = provider.getDeadlineSnapshot(gw, currentBank, currentFTs, chips);
    const engine = new ProjectionEngine(OPTIMIZED_PARAMETERS);
    const oracle = new HistoricalOracle(snapshot, engine);

    let gwAction = 'ROLL';

    if (gw === startGw) {
      console.log("Solving initial squad...");
      const initialSquad = solveOptimalSquad(oracle, gw, 1000, 8, OPTIMIZED_PARAMETERS);
      
      let spent = 0;
      const purchasePrices: Record<number, number> = {};
      initialSquad.forEach(id => {
        const cost = oracle.getCost(id);
        spent += cost;
        purchasePrices[id] = cost;
      });

      currentState = {
        squad: initialSquad,
        bank: 1000 - spent,
        freeTransfers: 1, 
        chipState: { 'WC': 2, 'FH': 1, 'BB': 1, 'TC': 1 },
        gameweek: gw,
        accumulatedScore: 0,
        purchasePrices
      };
      
      console.log(`Initial squad chosen. Bank remaining: £${currentState.bank / 10}m`);
      gwAction = 'INITIAL';
    } else {
      if (!currentState) throw new Error("State lost");

      const simulator = new Simulator(true); 
      console.log(`Running beam search from state: FT=${currentState.freeTransfers}, Bank=${currentState.bank/10}`);
      
      const bestPaths = simulator.simulateHorizon(currentState, oracle, OPTIMIZED_PARAMETERS);
      const bestPath = bestPaths[0];
      gwAction = bestPath.firstAction || 'ROLL';
      
      console.log(`Engine decided: ${gwAction}`);
      
      const actionType = (bestPath.firstAction as 'ROLL' | 'TRANSFER' | 'CHIP') || 'ROLL';
      const actionToApply: Action = {
        type: actionType,
        transfersIn: bestPath.firstTransfersIn,
        transfersOut: bestPath.firstTransfersOut,
        chipName: actionType === 'CHIP' ? bestPath.firstAction : undefined,
        hitCost: actionType === 'TRANSFER' ? Math.max(0, (bestPath.firstTransfersIn?.length || 0) - currentState.freeTransfers) * 4 : 0
      };

      if (actionType === 'TRANSFER' && actionToApply.transfersIn && actionToApply.transfersOut) {
        console.log(`Transfers: OUT [${actionToApply.transfersOut.join(',')}] -> IN [${actionToApply.transfersIn.join(',')}]`);
        runLog.totalHits += actionToApply.hitCost / 4;
        
        let expectedGain = 0;
        // Naive expected gain sum for 1 horizon point
        actionToApply.transfersIn.forEach(id => expectedGain += oracle.getXP(id, gw));
        actionToApply.transfersOut.forEach(id => expectedGain -= oracle.getXP(id, gw));

        activeTransfers.push({
          gw,
          in: actionToApply.transfersIn,
          out: actionToApply.transfersOut,
          hitCost: actionToApply.hitCost,
          expectedGain,
          actualGain1: 0,
          actualGain4: 0,
          actualGain8: 0
        });
      } else if (bestPath.firstAction === 'WC' || bestPath.firstAction === 'FH' || bestPath.firstAction === 'BB' || bestPath.firstAction === 'TC') {
        console.log(`Using Chip: ${bestPath.firstAction}`);
        actionToApply.type = 'CHIP';
        actionToApply.chipName = bestPath.firstAction;
      }
      
      currentState = applyAction(currentState, actionToApply, oracle, gw, OPTIMIZED_PARAMETERS);
    }

    // Diagnostics Phase
    const xiIds = solveStartingXI(oracle, gw, currentState.squad, OPTIMIZED_PARAMETERS);
    const { captain, viceCaptain } = solveCaptain(oracle, gw, xiIds, OPTIMIZED_PARAMETERS);
    
    // Evaluate Prediction Errors (RMSE/MAE) for the squad
    let squadErrorSum = 0;
    let squadErrorSqSum = 0;
    let actualSquadPoints = 0;
    let expectedSquadPoints = 0;
    
    currentState.squad.forEach(id => {
      const pred = oracle.getXP(id, gw);
      const actual = provider.getActualPoints(id, gw);
      actualSquadPoints += actual;
      expectedSquadPoints += pred;
      squadErrorSum += Math.abs(pred - actual);
      squadErrorSqSum += Math.pow(pred - actual, 2);
    });
    
    const gwMAE = squadErrorSum / 15;
    const gwRMSE = Math.sqrt(squadErrorSqSum / 15);

    // Compute actual points
    let gwActualPoints = 0;
    let captainActual = 0;
    
    const xiSet = new Set(xiIds);
    let benchPoints = 0;
    let benchCost = 0;
    
    currentState.squad.forEach(id => {
      const pts = provider.getActualPoints(id, gw);
      
      if (id === captain) {
        gwActualPoints += (pts * 2);
        captainActual = pts * 2;
      } else if (xiSet.has(id)) {
        gwActualPoints += pts;
      } else {
        benchPoints += pts;
        benchCost += oracle.getCost(id);
      }
    });

    // Decision vs Projection Error Decomposition
    let chosenXiXp = 0;
    xiIds.forEach(id => chosenXiXp += oracle.getXP(id, gw));
    let chosenCaptainXp = oracle.getXP(captain, gw);
    
    const bestXiIds = solveStartingXI(oracle, gw, currentState.squad, OPTIMIZED_PARAMETERS);
    const { captain: bestCaptain } = solveCaptain(oracle, gw, bestXiIds, OPTIMIZED_PARAMETERS);
    let bestXiXp = 0;
    bestXiIds.forEach(id => bestXiXp += oracle.getXP(id, gw));
    let bestCaptainXp = oracle.getXP(bestCaptain, gw);

    const xiDecisionError = Math.max(0, bestXiXp - chosenXiXp);
    const capDecisionError = Math.max(0, bestCaptainXp - chosenCaptainXp);
    const footballRandomness = (chosenXiXp + chosenCaptainXp) - gwActualPoints; // expected - actual

    currentState.accumulatedScore += gwActualPoints;
    console.log(`GW${gw} Actual Points: ${gwActualPoints} | Proj Error: ${gwMAE.toFixed(2)} | Dec Error: ${(xiDecisionError + capDecisionError).toFixed(2)} | Randomness: ${footballRandomness.toFixed(2)}`);

    // Update active transfers
    activeTransfers.forEach(t => {
      const gwsPassed = gw - t.gw;
      if (gwsPassed >= 0 && gwsPassed < 8) {
        let ptsIn = 0;
        let ptsOut = 0;
        t.in.forEach((id: number) => ptsIn += provider.getActualPoints(id, gw));
        t.out.forEach((id: number) => ptsOut += provider.getActualPoints(id, gw));
        const diff = ptsIn - ptsOut;
        
        if (gwsPassed === 0) t.actualGain1 += diff;
        if (gwsPassed < 4) t.actualGain4 += diff;
        if (gwsPassed < 8) t.actualGain8 += diff;
      }
    });

    // Logging GW stats
    runLog.gameweeks.push({
      gw,
      points: gwActualPoints,
      captain: {
        id: captain,
        expectedXP: oracle.getXP(captain, gw),
        actualPoints: captainActual },
      viceCaptain: {
        id: viceCaptain,
        actualPoints: provider.getActualPoints(viceCaptain, gw)
      },
      bench: {
        points: benchPoints,
        cost: benchCost / 10
      },
      prediction: {
        mae: gwMAE,
        rmse: gwRMSE,
        expectedSquadPoints,
        actualSquadPoints
      },
      diagnostics: {
        bestXiXp,
        chosenXiXp,
        actualXiPoints: gwActualPoints - captainActual,
        bestCaptainXp,
        chosenCaptainXp,
        actualCaptainPoints: captainActual,
        errors: {
          projectionError: gwMAE, // Average squad MAE
          decisionError: xiDecisionError + capDecisionError,
          decisionDecomp: {
            xiSelection: xiDecisionError,
            captainSelection: capDecisionError,
            squadConstruction: 0, // Placeholder for future logic
            transferTiming: 0, 
            chipTiming: 0
          },
          footballRandomness
        }
      },
      financials: {
        bank: currentState.bank / 10,
        squadPurchaseValue: currentState.squad.reduce((sum, id) => sum + (currentState!.purchasePrices[id] || oracle.getCost(id)), 0) / 10,
        squadSellingValue: currentState.squad.reduce((sum, id) => sum + getSellingPrice(oracle.getCost(id), currentState!.purchasePrices[id] || oracle.getCost(id)), 0) / 10
      },
      action: gwAction,
      squad: [...currentState.squad],
      xi: [...xiIds]
    });
  }

  runLog.transfers = activeTransfers;

  let terminalSquadValue = 0;
  const finalSnapshot = provider.getDeadlineSnapshot(endGw, 1000, 0, {});
  currentState!.squad.forEach(id => {
    const player = finalSnapshot.players[id];
    if (player) {
      const currentCost = Math.round(player.price * 10);
      const purchasePrice = currentState!.purchasePrices[id] || currentCost;
      terminalSquadValue += getSellingPrice(currentCost, purchasePrice) / 10;
    }
  });

  const finalBank = currentState!.bank / 10;
  const OR_EquivalentScore = currentState!.accumulatedScore + (0.1 * finalBank) + terminalSquadValue;

  runLog.finalScore = currentState!.accumulatedScore;
  runLog.finalBank = finalBank;
  runLog.terminalSquadValue = terminalSquadValue;
  runLog.orEquivalentScore = OR_EquivalentScore;
  
  console.log(`\n=== BACKTEST COMPLETE ===`);
  console.log(`Final Season Points: ${runLog.finalScore}`);
  console.log(`Total Hits Taken: ${runLog.totalHits}`);
  console.log(`Remaining Bank: £${runLog.finalBank}m`);
  console.log(`Terminal Squad Value: £${runLog.terminalSquadValue}m`);
  console.log(`OR-Equivalent Score: ${runLog.orEquivalentScore.toFixed(2)}`);
  
  const outDir = path.resolve(process.cwd(), 'backtests', season);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  const outPath = path.resolve(outDir, `run-${weightName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(runLog, null, 2));
  console.log(`Run saved to ${outPath}`);
}

runBacktest().catch(err => {
  console.error(err);
  process.exit(1);
});
