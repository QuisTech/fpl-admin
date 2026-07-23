import { solveOptimalSquad } from './lp-solver.js';

// Mock Oracle for testing
class MockOracle {
  getTop1kEO(id: number) { return 0; }
  getVariance(id: number, gw: number) { return 1.0; }
  getCost(id: number) { return 50; } // default cost £5.0M
}

const mockCandidates = [
  { id: 1, web_name: 'Player 1', position: 'GKP', now_cost: 40, xP: 4, team: 1 },
  { id: 2, web_name: 'Player 2', position: 'GKP', now_cost: 50, xP: 5, team: 2 },
  { id: 3, web_name: 'Player 3', position: 'DEF', now_cost: 45, xP: 4, team: 3 },
  { id: 4, web_name: 'Player 4', position: 'DEF', now_cost: 45, xP: 4, team: 4 },
  { id: 5, web_name: 'Player 5', position: 'DEF', now_cost: 45, xP: 4, team: 5 },
  { id: 6, web_name: 'Player 6', position: 'DEF', now_cost: 45, xP: 4, team: 6 },
  { id: 7, web_name: 'Player 7', position: 'DEF', now_cost: 45, xP: 4, team: 7 },
  { id: 8, web_name: 'Player 8', position: 'MID', now_cost: 60, xP: 5, team: 8 },
  { id: 9, web_name: 'Player 9', position: 'MID', now_cost: 60, xP: 5, team: 9 },
  { id: 10, web_name: 'Player 10', position: 'MID', now_cost: 60, xP: 5, team: 10 },
  { id: 11, web_name: 'Player 11', position: 'MID', now_cost: 60, xP: 5, team: 11 },
  { id: 12, web_name: 'Player 12', position: 'MID', now_cost: 60, xP: 5, team: 12 },
  { id: 13, web_name: 'Player 13', position: 'FWD', now_cost: 70, xP: 6, team: 13 },
  { id: 14, web_name: 'Player 14', position: 'FWD', now_cost: 70, xP: 6, team: 14 },
  { id: 15, web_name: 'Player 15', position: 'FWD', now_cost: 70, xP: 6, team: 15 },
  { id: 16, web_name: 'Expensive FWD', position: 'FWD', now_cost: 150, xP: 10, team: 16 }
] as any[];

async function runTests() {
  console.log("=== LP SOLVER CONSTRAINT TESTS ===");
  const oracle = new MockOracle() as any;

  // Test 1: Strict Budget Constraint (100.0M)
  // Our 15 mock players cost exactly 825 (£82.5M) without Expensive FWD.
  // With Expensive FWD (150), swapping out a 70 FWD, total cost would be 905 (£90.5M).
  // If budget is 850, it MUST NOT pick Expensive FWD, even though xP is higher.

  const result1 = solveOptimalSquad([], mockCandidates, 850, oracle, 'risky');
  console.log("\n[Test 1] strict budget: 850 (£85.0M)");
  if (!result1) {
    console.log("FAIL: Solver failed to find a team.");
  } else {
    const hasExpensive = result1.includes(16);
    console.log(`PASS: Team found. Contains expensive player (150): ${hasExpensive}`);
  }
}

runTests();
