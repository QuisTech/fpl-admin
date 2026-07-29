import fs from 'fs';
import path from 'path';
import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { Simulator, SquadState } from '../api/_lib/simulator.js';
import { ProjectionEngine, UtilityParameters, DEFAULT_PARAMETERS } from '../api/_lib/projection.js';
import { solveOptimalSquad } from '../api/_lib/lp-solver.js';

// Generic parameter object sweeper
async function calibrateWeights() {
  const season = '2023-24';
  const provider = new VaastavProvider();
  await provider.loadSeason(season);

  console.log(`\nStarting Calibration Sweep on ${season} dataset...`);

  // Define parameter grids
  const xpWeights = [0.8, 1.0, 1.2];
  const formWeights = [0.0, 0.5, 1.0]; // Represents xG90 + xA90 + minutes impact
  const lambdas = [0.02, 0.05, 0.10];
  
  let bestScore = -9999;
  let bestConfig: UtilityParameters = DEFAULT_PARAMETERS;
  
  // We'll run a mini 5-week backtest for calibration to save time during this scaffold.
  // In production, this would sweep across the entire 38 week season.
  const startGw = 1;
  const endGw = 5;

  for (const xpW of xpWeights) {
    for (const formW of formWeights) {
      for (const lam of lambdas) {
        
        const params: UtilityParameters = {
          xpWeight: xpW,
          xG90Weight: formW,
          xA90Weight: formW,
          minutesWeight: 0,
          fixtureWeight: 0,
          eoWeight: 0,
          varianceLambda: lam,
          valueWeight: 0
        };

        console.log(`\nTesting Config: xPW=${xpW}, formW=${formW}, lambda=${lam}`);
        
        let currentState: SquadState | null = null;
        let runScore = 0;

        for (let gw = startGw; gw <= endGw; gw++) {
          const currentBank = currentState ? currentState.bank : 1000;
          const currentFTs = currentState ? currentState.freeTransfers : 0;
          const chips = currentState ? currentState.chipState : { 'WC': 2, 'FH': 1, 'BB': 1, 'TC': 1 };
          
          const snapshot = provider.getDeadlineSnapshot(gw, currentBank, currentFTs, chips);
          const engine = new ProjectionEngine(snapshot, params);
          const oracle = engine.getOracle();

          if (gw === startGw) {
            const initialSquad = solveOptimalSquad(oracle, gw, 1000, 8, 'safe');
            let spent = 0;
            initialSquad.forEach(id => spent += oracle.getCost(id));
            currentState = {
              squad: initialSquad,
              bank: 1000 - spent,
              freeTransfers: 1,
              chipState: chips,
              gameweek: gw,
              accumulatedScore: 0
            };
          } else {
            const simulator = new Simulator(false);
            const bestPaths = simulator.simulateHorizon(currentState!, oracle, 'safe');
            const bestPath = bestPaths[0];
            
            const inIds = bestPath.firstTransfersIn || [];
            const outIds = bestPath.firstTransfersOut || [];
            
            if (bestPath.firstAction === 'TRANSFER' && inIds.length > 0) {
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
              
              currentState!.bank = currentState!.bank + costOut - costIn;
              const hitCost = Math.max(0, inIds.length - currentState!.freeTransfers) * 4;
              runScore -= hitCost;
              currentState!.freeTransfers = Math.min(5, Math.max(0, currentState!.freeTransfers - inIds.length) + 1);
            } else {
              currentState!.freeTransfers = Math.min(5, currentState!.freeTransfers + 1);
            }
          }

          // Evaluate
          let captainId = currentState!.squad[0];
          let maxCapUtil = -999;
          currentState!.squad.forEach(id => {
            const xp = oracle.getXP(id, gw);
            if (xp > maxCapUtil) {
              maxCapUtil = xp;
              captainId = id;
            }
          });

          const playerPoints = currentState!.squad.map(id => ({
            id,
            pts: provider.getActualPoints(id, gw),
            isCap: id === captainId
          }));
          playerPoints.sort((a, b) => b.pts - a.pts);
          
          const capIndex = playerPoints.findIndex(p => p.isCap);
          const cap = playerPoints.splice(capIndex, 1)[0];
          runScore += cap.pts * 2;
          
          for (let i = 0; i < 10; i++) {
            if (playerPoints[i]) runScore += playerPoints[i].pts;
          }
        }

        console.log(`Result: ${runScore} points`);
        if (runScore > bestScore) {
          bestScore = runScore;
          bestConfig = params;
          console.log(`🌟 NEW BEST! (${bestScore})`);
        }
      }
    }
  }

  console.log(`\n=== CALIBRATION COMPLETE ===`);
  console.log(`Best Score: ${bestScore}`);
  console.log(`Optimal Parameters:`, bestConfig);
}

calibrateWeights().catch(err => {
  console.error(err);
  process.exit(1);
});
