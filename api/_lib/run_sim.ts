import { CSVOracle } from './ingestion';
import { Simulator, SquadState } from './simulator';

// 1. Initialize the Oracle using the real FPLForm data we scraped
const oracle = new CSVOracle('data/fplform_scraped.csv');

// We will build a dummy squad using the first 15 player IDs we ingested 
// (which should be the highest "Merit" players like Haaland, Fernandes, etc.)
const initialSquadIds = Array.from({ length: 15 }, (_, i) => i + 1);

const initialState: SquadState = {
  squad: initialSquadIds,
  bank: 20, // 2.0M in the bank
  freeTransfers: 1,
  chipState: { 'WC': 1, 'BB': 1, 'TC': 1 }, // Inject chips to test Phase 2
  gameweek: 1, // Start simulating from GW1
  accumulatedScore: 0
};

// 2. Initialize the Simulator (Vercel Mode = true for fast testing)
const simulator = new Simulator(true);

console.log('--- Starting Multi-Horizon Simulation (V3 Phase 2) ---');
console.log(`Initial State Gameweek: ${initialState.gameweek}`);
console.log(`Squad consists of:`);
initialSquadIds.forEach(id => {
  console.log(`- ${oracle.playerNames[id]} (Cost: ${oracle.getCost(id) / 10}M)`);
});

// 3. Run the Beam Search
console.log('\nRunning Beam Search Simulator for a 3-Gameweek Horizon with Chips...');
const bestFutures = simulator.simulateHorizon(initialState, oracle);

// 4. Print the best result
if (bestFutures.length > 0) {
  const topTrajectory = bestFutures[0];
  console.log('\n✅ Simulation Complete!');
  console.log(`Best Future State reached at Gameweek ${topTrajectory.gameweek}`);
  console.log(`Expected Accumulated Points: ${topTrajectory.accumulatedScore.toFixed(2)}`);
  console.log(`Remaining Free Transfers: ${topTrajectory.freeTransfers}`);
} else {
  console.log('Simulation failed to generate any future states.');
}
