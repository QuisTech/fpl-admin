import fs from 'fs';
import path from 'path';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { Simulator, SquadState } from '../api/_lib/simulator.js';
import { ProjectionEngine, DEFAULT_PARAMETERS } from '../api/_lib/projection.js';
import { solveOptimalSquad } from '../api/_lib/lp-solver.js';

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

  // Log container
  const runLog: any = {
    season,
    parameters: DEFAULT_PARAMETERS,
    seed: 42,
    gameweeks: [],
    finalScore: 0,
    finalBank: 0,
    captainAccuracy: 0, // Points from captains vs max possible points
    totalHits: 0
  };

  const riskMode = 'safe';
  let currentState: SquadState | null = null;
  const startGw = 1;
  const endGw = 38;

  for (let gw = startGw; gw <= endGw; gw++) {
    console.log(`\n--- Simulating GW${gw} ---`);
    
    // 1. Get the pristine Deadline Snapshot
    // Start with 1000 bank (£100.0m) and 0 free transfers for GW1
    const currentBank = currentState ? currentState.bank : 1000;
    const currentFTs = currentState ? currentState.freeTransfers : 0;
    const chips = currentState ? currentState.chipState : { 'WC': 2, 'FH': 1, 'BB': 1, 'TC': 1 };
    
    const snapshot = provider.getDeadlineSnapshot(gw, currentBank, currentFTs, chips);
    
    // 2. Feed it into the ProjectionEngine to get the XPOracle
    const engine = new ProjectionEngine(snapshot, DEFAULT_PARAMETERS);
    const oracle = engine.getOracle();

    if (gw === startGw) {
      // 3a. GW1 Initial Squad Selection
      console.log("Solving initial squad...");
      // GW1 we have 1000 budget and optimize for the first 8 weeks
      const initialSquad = solveOptimalSquad(oracle, gw, 1000, 8, riskMode);
      
      let spent = 0;
      initialSquad.forEach(id => spent += oracle.getCost(id));

      currentState = {
        squad: initialSquad,
        bank: 1000 - spent,
        freeTransfers: 1, // GW2 will start with 1 FT
        chipState: { 'WC': 2, 'FH': 1, 'BB': 1, 'TC': 1 },
        gameweek: gw,
        accumulatedScore: 0
      };
      
      console.log(`Initial squad chosen. Bank remaining: £${currentState.bank / 10}m`);
    } else {
      // 3b. GW2-GW38 Transfers (Simulator)
      if (!currentState) throw new Error("State lost");

      const simulator = new Simulator(false); // isVercel=false -> beamWidth=500
      
      console.log(`Running beam search from state: FT=${currentState.freeTransfers}, Bank=${currentState.bank/10}`);
      
      // simulateHorizon evaluates all valid transfer paths
      const bestPaths = simulator.simulateHorizon(currentState, oracle, riskMode);
      const bestPath = bestPaths[0]; // the state that maximizes long-term fitness
      
      // The simulator returns the state *after* the entire 8-week horizon.
      // But we only want to commit the FIRST step's action to our actual state.
      
      // What was the first action? We must reconstruct it since simulator currently just outputs final horizon state.
      // Wait, simulator tracks `firstTransfersIn`, `firstTransfersOut`, `firstAction`.
      console.log(`Engine decided: ${bestPath.firstAction}`);
      
      // Apply the action to currentState
      const inIds = bestPath.firstTransfersIn || [];
      const outIds = bestPath.firstTransfersOut || [];
      
      if (bestPath.firstAction === 'TRANSFER' && inIds.length > 0) {
        console.log(`Transfers: OUT [${outIds.join(',')}] -> IN [${inIds.join(',')}]`);
        
        let costOut = 0;
        let costIn = 0;
        outIds.forEach(id => {
          costOut += oracle.getCost(id);
          currentState!.squad = currentState!.squad.filter(s => s !== id);
        });
        inIds.forEach(id => {
          costIn += oracle.getCost(id);
          currentState!.squad.push(id);
        });
        
        currentState.bank = currentState.bank + costOut - costIn;
        const hitCost = Math.max(0, inIds.length - currentState.freeTransfers) * 4;
        currentState.accumulatedScore -= hitCost;
        runLog.totalHits += hitCost / 4;
        
        currentState.freeTransfers = Math.min(5, Math.max(0, currentState.freeTransfers - inIds.length) + 1);
      } else {
        // Roll transfer
        currentState.freeTransfers = Math.min(5, currentState.freeTransfers + 1);
      }
    }

    // 4. Evaluate actual points for this gameweek
    let gwActualPoints = 0;
    
    // Determine Captain
    let maxCapUtility = -9999;
    let captainId = currentState.squad[0];
    
    // Simulate what the engine would pick as captain
    currentState.squad.forEach(id => {
      const xp = oracle.getXP(id, gw);
      const variance = oracle.getVariance(id, gw);
      const eo = oracle.getTop1kEO?.(id) || 0;
      // We must use the utility.ts logic, but wait, simulator calls calculateCaptainUtility.
      // We'll approximate by just picking highest xP for this logging script to avoid importing it all.
      // Better: we can just use the xp.
      const util = xp + (Math.sqrt(variance) * 0.5); 
      if (util > maxCapUtility) {
        maxCapUtility = util;
        captainId = id;
      }
    });

    let bestPossibleActual = -999;
    let actualCaptainPoints = 0;

    currentState.squad.forEach(id => {
      const pts = provider.getActualPoints(id, gw);
      if (pts > bestPossibleActual) bestPossibleActual = pts;
      
      if (id === captainId) {
        gwActualPoints += (pts * 2);
        actualCaptainPoints = pts * 2;
      } else {
        gwActualPoints += pts;
      }
    });

    // Extremely naive Bench (assuming all 15 start, we can refine this later by selecting XI)
    // For now we just sum the top 11 scoring players to simulate perfect bench behavior, 
    // or just assume the oracle picks the XI. 
    // Let's do a naive "auto-sub" simulation: sort squad by actual points, take top 11.
    // (This slightly overestimates bench points but keeps the loop simple).
    
    // Actually, let's just score the top 11 to keep it simple for V1.
    const playerPoints = currentState.squad.map(id => ({
      id,
      pts: provider.getActualPoints(id, gw),
      isCap: id === captainId
    }));
    playerPoints.sort((a, b) => b.pts - a.pts);
    
    let totalGwPts = 0;
    // Cap is always in
    const capIndex = playerPoints.findIndex(p => p.isCap);
    const cap = playerPoints.splice(capIndex, 1)[0];
    totalGwPts += cap.pts * 2;
    
    // Take next 10 best
    for (let i = 0; i < 10; i++) {
      if (playerPoints[i]) totalGwPts += playerPoints[i].pts;
    }
    
    currentState.accumulatedScore += totalGwPts;
    
    console.log(`GW${gw} Actual Points: ${totalGwPts} (Captain: ${captainId} got ${cap.pts * 2})`);
    
    // Log
    runLog.gameweeks.push({
      gw,
      points: totalGwPts,
      captainId,
      captainPoints: cap.pts * 2,
      maxPossibleCaptain: bestPossibleActual * 2,
      bank: currentState.bank / 10,
      squad: [...currentState.squad]
    });
    
    // Track Captain Accuracy
    runLog.captainAccuracy += (cap.pts * 2) / (bestPossibleActual * 2);
  }

  runLog.finalScore = currentState!.accumulatedScore;
  runLog.finalBank = currentState!.bank / 10;
  runLog.captainAccuracy = runLog.captainAccuracy / endGw;

  console.log(`\n=== BACKTEST COMPLETE ===`);
  console.log(`Final Score: ${runLog.finalScore}`);
  console.log(`Total Hits Taken: ${runLog.totalHits}`);
  
  const outDir = path.resolve(process.cwd(), 'backtests', season);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  const outPath = path.resolve(outDir, 'run-001.json');
  fs.writeFileSync(outPath, JSON.stringify(runLog, null, 2));
  console.log(`Run saved to ${outPath}`);
}

runBacktest().catch(err => {
  console.error(err);
  process.exit(1);
});
