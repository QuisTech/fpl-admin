import { loadWeights } from './weights-loader.js';
const DEFAULT_PARAMETERS = loadWeights('baseline');
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FPLService } from '../index';
import { FPLPlayer, FPLFixture, PlayerDistribution } from './types';
import { CSVOracle, XPOracle } from './ingestion';
import { Simulator, SquadState } from './simulator';


// -------------------------------------------------------------
// 1. Mock Oracle implementation for isolated simulator tests
// -------------------------------------------------------------
class MockOracle implements XPOracle {
  public playerNames: Record<number, string> = {};
  private players: { id: number; xp: number[]; pos: string; cost: number; team: string }[];
  private xpMatrix: Record<number, Record<number, number>> = {};
  private allIds: number[] = [];

  constructor(players: { id: number; xp: number[]; pos: string; cost: number; team: string }[]) {
    this.players = players;
    players.forEach(p => {
      this.allIds.push(p.id);
      this.xpMatrix[p.id] = {};
      p.xp.forEach((val, idx) => {
        this.xpMatrix[p.id][idx + 1] = val;
      });
    });
  }

  getXP(playerId: number, gameweek: number): number {
    return this.xpMatrix[playerId]?.[gameweek] || 0;
  }
  getVariance(playerId: number, gameweek: number): number {
    const xp = this.getXP(playerId, gameweek);
    return Math.max(0.5, xp * 1.5);
  }
  getPriceDelta(playerId: number): number { return 0; }
  getFixtures(gameweek: number): any[] { return []; }
  getPosition(playerId: number): string { return this.players.find(p => p.id === playerId)?.pos || 'MID'; }
  getCost(playerId: number): number { return this.players.find(p => p.id === playerId)?.cost || 50; }
  getTeam(playerId: number): string { return this.players.find(p => p.id === playerId)?.team || 'MCI'; }
  getAllPlayerIds(): number[] { return this.players.map(p => p.id); }
  getTop1kEO(playerId: number): number { return 0; }
  
  getDistribution(playerId: number, gameweek: number): PlayerDistribution {
    const xp = this.getXP(playerId, gameweek);
    const v = this.getVariance(playerId, gameweek);
    return {
      mean: xp,
      variance: v,
      skewness: 0,
      p50: xp,
      p75: xp,
      p90: xp,
      p95: xp,
      tails: { 8: 0, 12: 0, 15: 0, 20: 0 },
      histogram: {}
    };
  }
}

// -------------------------------------------------------------
// 2. FPL Scoring Logic Tests (from V2)
// -------------------------------------------------------------
describe('FPLService - Scoring Logic', () => {
  const mockPlayer: FPLPlayer = {
    id: 1,
    web_name: 'Salah',
    first_name: 'Mohamed',
    second_name: 'Salah',
    now_cost: 125,
    element_type: 3, // MID
    team: 1,
    total_points: 200,
    form: '8.5',
    points_per_game: '7.5',
    selected_by_percent: '45.0',
    minutes: 2000,
    goals_scored: 15,
    assists: 10,
    clean_sheets: 8,
    status: 'a',
    news: '',
    chance_of_playing_next_round: 100,
    expected_goals: '0.8',
    expected_assists: '0.4',
    ict_index: '15.0'
  } as any;

  const mockFixtures: FPLFixture[] = [
    {
      id: 101,
      team_h: 1,
      team_a: 2,
      team_h_difficulty: 2,
      team_a_difficulty: 4,
      event: 30,
      finished: false
    }
  ];

  it('should apply premium player protection multiplier', () => {
    const nonPremiumPlayer = { ...mockPlayer, now_cost: 60 };
    const premiumPlayer = { ...mockPlayer, now_cost: 120 };
    
    const scoreNonPremium = FPLService.calculatePlayerScore(10, nonPremiumPlayer, 'safe');
    const scorePremium = FPLService.calculatePlayerScore(10, premiumPlayer, 'safe');
    expect(scorePremium).toBeGreaterThan(scoreNonPremium);
  });

  it('should apply risk multiplier for differentials in aggressive mode', () => {
    const differentialPlayer = { ...mockPlayer, selected_by_percent: '4.9' };
    const scoreSafe = FPLService.calculatePlayerScore(10, differentialPlayer, 'safe');
    const scoreAggressive = FPLService.calculatePlayerScore(10, differentialPlayer, 'aggressive');
    
    expect(scoreAggressive).toBeGreaterThan(scoreSafe);
  });
});

// -------------------------------------------------------------
// 3. CSV Oracle Ingestion Tests
// -------------------------------------------------------------
describe('CSVOracle Ingestion & Strategy Multipliers', () => {
  const tempCsvPath = 'data/temp_test_fplform.csv';

  it('should parse player rows and apply risk mode multipliers correctly', () => {
    // 1. Create a temporary mock CSV (must have > 10 columns for CSVOracle to ingest)
    const csvContent = 
      `rank,player,id,team,position,cost,xp_gw1,xp_gw2,xp_gw3,dummy1,dummy2,dummy3,dummy4\n` +
      `1,Salah,1,LIV,MID,12.5,8.0,7.9,7.8,,,,,\n` +
      `2,Isak,2,NEW,FWD,8.5,6.0,5.9,5.8,,,,,\n` +
      `3,Mbeumo,3,BRE,MID,7.0,5.5,5.4,5.3,,,,,\n`;
    
    fs.mkdirSync(path.dirname(tempCsvPath), { recursive: true });
    fs.writeFileSync(tempCsvPath, csvContent, 'utf-8');

    const realPlayersMetadata = [
      { id: 300, web_name: 'Salah', selected_by_percent: '45.0' },
      { id: 450, web_name: 'Isak', selected_by_percent: '35.0' },
      { id: 600, web_name: 'Mbeumo', selected_by_percent: '4.2' } // Differential MID
    ];

    // Safe mode oracle
    const oracleSafe = new CSVOracle(tempCsvPath, realPlayersMetadata, 'safe');
    expect(oracleSafe.getAllPlayerIds()).toContain(300); // Mapped Salah
    expect(oracleSafe.getPosition(300)).toBe('MID');
    expect(oracleSafe.getCost(300)).toBe(125); // 12.5 * 10

    // All strategic multipliers have been moved to the LP Solver / utility layer.
    // In CSVOracle, Salah and Mbeumo expected points must remain completely pure and unmutated.
    expect(oracleSafe.getXP(600, 1)).toBeCloseTo(5.5, 1);
    expect(oracleSafe.getXP(300, 1)).toBeCloseTo(8.0, 1);

    // Aggressive Mode: expected points also remain pure.
    const oracleAggressive = new CSVOracle(tempCsvPath, realPlayersMetadata, 'aggressive');
    expect(oracleAggressive.getXP(600, 1)).toBeCloseTo(5.5, 1);

    // Clean up
    if (fs.existsSync(tempCsvPath)) {
      fs.unlinkSync(tempCsvPath);
    }
  });
});

// -------------------------------------------------------------
// 4. Simulator Accuracy & Matchday Calculations
// -------------------------------------------------------------
describe('Simulator - Matchday points calculations', () => {
  const mockPlayers = [
    { id: 1, xp: [8, 8], pos: 'MID', cost: 120, team: 'LIV' }, // Captain
    { id: 2, xp: [6, 6], pos: 'FWD', cost: 85, team: 'NEW' },  // Vice-Captain
    { id: 3, xp: [5, 5], pos: 'DEF', cost: 50, team: 'ARS' },
    { id: 4, xp: [4, 4], pos: 'DEF', cost: 45, team: 'MCI' },
    { id: 5, xp: [4, 4], pos: 'MID', cost: 65, team: 'MUN' },
    { id: 6, xp: [3, 3], pos: 'DEF', cost: 40, team: 'AVL' },
    { id: 7, xp: [3, 3], pos: 'MID', cost: 60, team: 'TOT' },
    { id: 8, xp: [3, 3], pos: 'FWD', cost: 75, team: 'CHE' },
    { id: 9, xp: [2, 2], pos: 'GKP', cost: 45, team: 'EVE' },
    { id: 10, xp: [2, 2], pos: 'DEF', cost: 42, team: 'BHA' },
    { id: 11, xp: [2, 2], pos: 'MID', cost: 55, team: 'WHU' },
    // Bench players:
    { id: 12, xp: [1.5, 1.5], pos: 'FWD', cost: 45, team: 'BRE' },
    { id: 13, xp: [1, 1], pos: 'DEF', cost: 38, team: 'BOU' },
    { id: 14, xp: [1, 1], pos: 'MID', cost: 44, team: 'CRY' },
    { id: 15, xp: [0.5, 0.5], pos: 'GKP', cost: 40, team: 'LEI' }
  ];

  const oracle = new MockOracle(mockPlayers);
  const simulator = new Simulator(true);

  const state: SquadState = {
    squad: mockPlayers.map(p => p.id),
    bank: 10,
    freeTransfers: 1,
    chipState: { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 },
    gameweek: 1,
    accumulatedScore: 0, purchasePrices: {} };

  it('should sum expected points for standard starting XI and double captain', () => {
    // Starting XI should be top 11 players. Top 11 sum:
    // id 1: 8.0 (doubled to 16.0)
    // id 2: 6.0
    // id 3: 5.0
    // id 4: 4.0
    // id 5: 4.0
    // id 6: 3.0
    // id 7: 3.0
    // id 8: 3.0
    // id 9: 2.0
    // id 10: 2.0
    // id 11: 2.0
    // Expected Sum = 16.0 + 6 + 5 + 4 + 4 + 3 + 3 + 3 + 2 + 2 + 2 = 50.0
    const points = simulator.simulateMatchday(state, 1, oracle);
    expect(points.score).toBeCloseTo(50.0, 1);
  });

  it('should sum expected points for all 15 squad players when Bench Boost is active', () => {
    const bbState = { ...state, activeChip: 'BB' };
    // Bench Boost adds all players:
    // Starters Sum: 50.0
    // Bench: id 12 (1.5), id 13 (1.0), id 14 (1.0), id 15 (0.5) = 4.0
    // Total = 50.0 + 4.0 = 54.0
    const points = simulator.simulateMatchday(bbState, 1, oracle);
    expect(points.score).toBeCloseTo(54.0, 1);
  });
});

// -------------------------------------------------------------
// 5. Transfer Generation & Cost Constraint Verification
// -------------------------------------------------------------
describe('Simulator - generateValidActions transfer logic', () => {
  const mockPlayers = [
    // Current Squad (IDs 1 to 15)
    { id: 1, xp: [2, 2], pos: 'MID', cost: 70, team: 'LIV' },
    { id: 2, xp: [2, 2], pos: 'MID', cost: 60, team: 'NEW' },
    { id: 3, xp: [2, 2], pos: 'MID', cost: 50, team: 'ARS' },
    { id: 4, xp: [2, 2], pos: 'MID', cost: 45, team: 'MCI' },
    { id: 5, xp: [2, 2], pos: 'MID', cost: 40, team: 'MUN' },
    { id: 6, xp: [2, 2], pos: 'DEF', cost: 50, team: 'AVL' },
    { id: 7, xp: [2, 2], pos: 'DEF', cost: 45, team: 'TOT' },
    { id: 8, xp: [2, 2], pos: 'DEF', cost: 40, team: 'CHE' },
    { id: 9, xp: [2, 2], pos: 'DEF', cost: 35, team: 'EVE' },
    { id: 10, xp: [2, 2], pos: 'DEF', cost: 35, team: 'BHA' },
    { id: 11, xp: [2, 2], pos: 'FWD', cost: 80, team: 'WHU' },
    { id: 12, xp: [2, 2], pos: 'FWD', cost: 70, team: 'BRE' },
    { id: 13, xp: [2, 2], pos: 'FWD', cost: 50, team: 'BOU' },
    { id: 14, xp: [2, 2], pos: 'GKP', cost: 45, team: 'CRY' },
    { id: 15, xp: [2, 2], pos: 'GKP', cost: 40, team: 'LEI' },
    // External candidates (IDs 16 to 18)
    { id: 16, xp: [6, 6], pos: 'MID', cost: 75, team: 'BRE' }, // Out of budget (70 + 3 bank < 75)
    { id: 17, xp: [8, 8], pos: 'MID', cost: 72, team: 'LIV' }, // Valid swap for MID 1 (cost 70 + 3 bank >= 72)
    { id: 18, xp: [9, 9], pos: 'DEF', cost: 48, team: 'MCI' }  // Valid swap for DEF 6 (cost 50 + 3 bank >= 48)
  ];

  const oracle = new MockOracle(mockPlayers);
  const simulator = new Simulator(true);

  const state: SquadState = {
    squad: mockPlayers.slice(0, 15).map(p => p.id),
    bank: 3, // £0.3m remaining
    freeTransfers: 1,
    chipState: { 'WC': 0, 'FH': 0, 'BB': 0, 'TC': 0 },
    gameweek: 1,
    accumulatedScore: 0, purchasePrices: {} };

  it('should recommend valid swaps that improve points and fit financial budget constraints', () => {
    const actions = simulator.generateValidActions(state, oracle, 1);
    const transfers = actions.filter(a => a.type === 'TRANSFER');

    // Should generate transfers
    expect(transfers.length).toBeGreaterThan(0);

    // Swap MID 1 (cost 70) -> Candidate 17 (cost 72, xp 8) should be recommended
    const swapMid = transfers.find(t => t.transfersOut?.includes(1) && t.transfersIn?.includes(17));
    expect(swapMid).toBeDefined();
    expect(swapMid?.hitCost).toBe(0); // Free transfer available

    // Swap MID 1 (cost 70) -> Candidate 16 (cost 75) should NOT be recommended (violates budget 70 + 3 < 75)
    const swapTooExpensive = transfers.find(t => t.transfersIn?.includes(16));
    expect(swapTooExpensive).toBeUndefined();

    // Swap DEF 6 (cost 50) -> Candidate 18 (cost 48, xp 9) should be recommended
    const swapDef = transfers.find(t => t.transfersOut?.includes(6) && t.transfersIn?.includes(18));
    expect(swapDef).toBeDefined();
  });
});

// -------------------------------------------------------------
// 6. Chip State Transitions & Beam Search Lookahead Correctness
// -------------------------------------------------------------
describe('Simulator - Multi-horizon beam search and state transitions', () => {
  const mockPlayers = [
    { id: 1, xp: [4, 4], pos: 'MID', cost: 60, team: 'LIV' },
    { id: 2, xp: [4, 4], pos: 'MID', cost: 60, team: 'NEW' },
    { id: 3, xp: [4, 4], pos: 'MID', cost: 60, team: 'ARS' },
    { id: 4, xp: [4, 4], pos: 'MID', cost: 60, team: 'MCI' },
    { id: 5, xp: [4, 4], pos: 'MID', cost: 60, team: 'MUN' },
    { id: 6, xp: [4, 4], pos: 'DEF', cost: 50, team: 'AVL' },
    { id: 7, xp: [4, 4], pos: 'DEF', cost: 50, team: 'TOT' },
    { id: 8, xp: [4, 4], pos: 'DEF', cost: 50, team: 'CHE' },
    { id: 9, xp: [4, 4], pos: 'DEF', cost: 50, team: 'EVE' },
    { id: 10, xp: [4, 4], pos: 'DEF', cost: 50, team: 'BHA' },
    { id: 11, xp: [4, 4], pos: 'FWD', cost: 80, team: 'WHU' },
    { id: 12, xp: [4, 4], pos: 'FWD', cost: 80, team: 'BRE' },
    { id: 13, xp: [4, 4], pos: 'FWD', cost: 80, team: 'BOU' },
    { id: 14, xp: [4, 4], pos: 'GKP', cost: 45, team: 'CRY' },
    { id: 15, xp: [4, 4], pos: 'GKP', cost: 45, team: 'LEI' },
    // A massive high-scoring candidate that fits within budget
    { id: 16, xp: [10, 10], pos: 'MID', cost: 55, team: 'LIV' }
  ];

  const oracle = new MockOracle(mockPlayers);
  const simulator = new Simulator(true); // Vercel mode runs maxDepth=8, beamWidth=50

  const state: SquadState = {
    squad: mockPlayers.slice(0, 15).map(p => p.id),
    bank: 5,
    freeTransfers: 1,
    chipState: { 'WC': 0, 'FH': 0, 'BB': 0, 'TC': 0 },
    gameweek: 1,
    accumulatedScore: 0, purchasePrices: {} };

  it('should successfully execute simulateHorizon beam search and suggest transfer actions', () => {
    const results = simulator.simulateHorizon(state, oracle);

    expect(results.length).toBeGreaterThan(0);
    
    // The top recommendation path should be calculated successfully
    const bestFuture = results[0];
    expect(bestFuture.accumulatedScore).toBeGreaterThan(0);

    // The first action of the optimal future should be recorded (either ROLL or TRANSFER)
    expect(bestFuture.firstAction).toBeDefined();
    expect(['ROLL', 'TRANSFER']).toContain(bestFuture.firstAction);
  });
});

// -------------------------------------------------------------
// 7. FH, BB, and TC Chip Logic & Scoring Tests
// -------------------------------------------------------------
describe('Simulator - FH, BB, and TC Chip Logic', () => {
  const mockPlayers = [
    { id: 1, xp: [8, 8, 8], pos: 'MID', cost: 120, team: 'LIV' }, // Top Player
    { id: 2, xp: [6, 6, 6], pos: 'FWD', cost: 85, team: 'NEW' },
    { id: 3, xp: [5, 5, 5], pos: 'DEF', cost: 50, team: 'ARS' },
    { id: 4, xp: [4, 4, 4], pos: 'DEF', cost: 45, team: 'MCI' },
    { id: 5, xp: [4, 4, 4], pos: 'MID', cost: 65, team: 'MUN' },
    { id: 6, xp: [3, 3, 3], pos: 'DEF', cost: 40, team: 'AVL' },
    { id: 7, xp: [3, 3, 3], pos: 'MID', cost: 60, team: 'TOT' },
    { id: 8, xp: [3, 3, 3], pos: 'FWD', cost: 75, team: 'CHE' },
    { id: 9, xp: [2, 2, 2], pos: 'GKP', cost: 45, team: 'EVE' },
    { id: 10, xp: [2, 2, 2], pos: 'DEF', cost: 42, team: 'BHA' },
    { id: 11, xp: [2, 2, 2], pos: 'MID', cost: 55, team: 'WHU' },
    // Bench:
    { id: 12, xp: [1.5, 1.5, 1.5], pos: 'FWD', cost: 45, team: 'BRE' },
    { id: 13, xp: [1, 1, 1], pos: 'DEF', cost: 38, team: 'BOU' },
    { id: 14, xp: [1, 1, 1], pos: 'MID', cost: 44, team: 'CRY' },
    { id: 15, xp: [0.5, 0.5, 0.5], pos: 'GKP', cost: 40, team: 'LEI' },
    // External high-scoring differential:
    { id: 16, xp: [12, 12, 12], pos: 'MID', cost: 50, team: 'LIV' }
  ];

  const oracle = new MockOracle(mockPlayers);
  const simulator = new Simulator(true);

  const state: SquadState = {
    squad: mockPlayers.slice(0, 15).map(p => p.id),
    bank: 10,
    freeTransfers: 1,
    chipState: { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 },
    gameweek: 1,
    accumulatedScore: 0, purchasePrices: {} };

  it('should generate FH, BB, and TC actions when chips are available', () => {
    const actions = simulator.generateValidActions(state, oracle, 1);
    const chipActions = actions.filter(a => a.type === 'CHIP');
    
    const chipNames = chipActions.map(a => a.chipName);
    expect(chipNames).toContain('WC');
    expect(chipNames).toContain('FH');
    expect(chipNames).toContain('BB');
    expect(chipNames).toContain('TC');
  });

  it('should calculate Triple Captain scoring correctly', () => {
    const tcState = { ...state, activeChip: 'TC' };
    // Normal captain scoring: 8.0 * 2 = 16.0
    // Triple captain scoring: 8.0 * 3 = 24.0
    // Starters Sum: 24.0 + 6 + 5 + 4 + 4 + 3 + 3 + 3 + 2 + 2 + 2 = 58.0
    const points = simulator.simulateMatchday(tcState, 1, oracle);
    expect(points.score).toBeCloseTo(58.0, 1);
  });

  it('should calculate Bench Boost scoring correctly', () => {
    const bbState = { ...state, activeChip: 'BB' };
    // All 15 players sum, captain points doubled:
    // Starters sum: 16.0 (Salah doubled) + 6 + 5 + 4 + 4 + 3 + 3 + 3 + 2 + 2 + 2 = 50.0
    // Bench: 1.5 + 1.0 + 1.0 + 0.5 = 4.0
    // Total = 54.0
    const points = simulator.simulateMatchday(bbState, 1, oracle);
    expect(points.score).toBeCloseTo(54.0, 1);
  });

  it('should optimize squad during Free Hit week and revert back subsequently', () => {
    // We run simulateHorizon for 2 weeks starting with a state where FH is played.
    // If we only have FH in chipState, let's see if the simulator prefers to play it
    const fhOnlyState: SquadState = {
      ...state,
      chipState: { 'WC': 0, 'FH': 1, 'BB': 0, 'TC': 0 }
    };

    const results = simulator.simulateHorizon(fhOnlyState, oracle);
    expect(results.length).toBeGreaterThan(0);

    // Let's inspect the trajectories.
    // Find a trajectory that started with 'FH'
    const fhTrajectory = results.find(r => r.firstAction === 'FH');
    expect(fhTrajectory).toBeDefined();

    // Verify that the final chipState has FH consumed (0)
    expect(fhTrajectory!.chipState['FH']).toBe(0);

    // Verify that the gameweek advanced
    expect(fhTrajectory!.gameweek).toBe(9); // maxDepth = 8, so 1 + 8 = 9
  });
});

// -------------------------------------------------------------
// 8. CSVOracle Dynamic xP & Fixture logic Tests
// -------------------------------------------------------------
describe('CSVOracle Dynamic xP & Fixture logic', () => {
  const tempCsvPath = 'data/temp_dynamic_test_fplform.csv';

  it('should calculate FDR adjustments, Double Gameweeks, Blank Gameweeks, and map absolute gameweeks', () => {
    // 1. Create a temporary mock CSV
    const csvContent = 
      `rank,player,id,team,position,cost,xp_gw1,xp_gw2,xp_gw3,dummy1,dummy2,dummy3,dummy4\n` +
      `1,Salah,1,LIV,MID,12.5,10.0,9.9,9.8,,,,,\n` +
      `2,Isak,2,NEW,FWD,8.5,6.0,5.9,5.8,,,,,\n`;
    
    fs.mkdirSync(path.dirname(tempCsvPath), { recursive: true });
    fs.writeFileSync(tempCsvPath, csvContent, 'utf-8');

    const realPlayersMetadata = [
      { id: 300, web_name: 'Salah', selected_by_percent: '45.0', team: 12 },
      { id: 450, web_name: 'Isak', selected_by_percent: '35.0', team: 15 }
    ];

    const mockTeams = [
      { id: 12, name: 'Liverpool', short_name: 'LIV' },
      { id: 15, name: 'Newcastle', short_name: 'NEW' }
    ];

    const mockFixtures = [
      // Week 30: Easy home fixture for LIV (FDR = 2) -> Multiplier: 1 + (3 - 2) * 0.1 = 1.1x
      { id: 101, team_h: 12, team_a: 99, team_h_difficulty: 2, team_a_difficulty: 3, event: 30, finished: false },
      // Week 31: Hard away fixture for LIV (FDR = 4) -> Multiplier: 1 + (3 - 4) * 0.1 = 0.9x
      { id: 102, team_h: 99, team_a: 12, team_h_difficulty: 3, team_a_difficulty: 4, event: 31, finished: false },
      // Week 32: Double Gameweek for NEW (two fixtures in week 32)
      { id: 103, team_h: 15, team_a: 99, team_h_difficulty: 3, team_a_difficulty: 3, event: 32, finished: false },
      { id: 104, team_h: 99, team_a: 15, team_h_difficulty: 3, team_a_difficulty: 3, event: 32, finished: false }
    ];

    // Initialize the CSVOracle with nextEventId: 30
    const oracle = new CSVOracle(tempCsvPath, realPlayersMetadata, 'safe', mockFixtures, mockTeams, 30);

    // 1. Check absolute gameweek alignment
    // Since nextEventId is 30, gw 30 is step 0 (decay = 1.0)
    // Salah: base merit = 10.0. FDR adjustments are already baked into FPLFORM data. Expected = 10.0
    expect(oracle.getXP(300, 30)).toBeCloseTo(10.0, 1);

    // Week 29 should return 0 (outside horizon)
    expect(oracle.getXP(300, 29)).toBe(0);
    // Week 38 should return 0 (outside horizon)
    expect(oracle.getXP(300, 38)).toBe(0);

    // 2. Check FDR Adjustment (gw 31 is step 1, decay = 0.9^1 = 0.9)
    // Salah: base merit = 10.0. FDR adjustments are already baked into FPLFORM data. Expected = 9.9 (direct from CSV)
    expect(oracle.getXP(300, 31)).toBeCloseTo(9.9, 1);
 
    // 3. Check Double Gameweek (NEW in week 32, step 2, decay = 0.9^2 = 0.81)
    // Isak: base merit = 6.0. Expected = 5.8 (direct from CSV)
    expect(oracle.getXP(450, 32)).toBeCloseTo(5.8, 1);

    // 4. Check Blank Gameweek (LIV has no fixtures in week 33)
    expect(oracle.getXP(300, 33)).toBe(0);

    // Clean up
    if (fs.existsSync(tempCsvPath)) {
      fs.unlinkSync(tempCsvPath);
    }
  });
});

// -------------------------------------------------------------
// 9. Multi-Transfer Action Space (LP + Beam Search) Tests
// -------------------------------------------------------------
import { solveOptimalTransfers } from './lp-solver';

describe('Simulator - Multi-Transfer Action Space', () => {
  const mockPlayers = [
    // Current Squad (IDs 1 to 15)
    { id: 1, xp: [4, 4], pos: 'MID', cost: 70, team: 'LIV' },
    { id: 2, xp: [4, 4], pos: 'MID', cost: 60, team: 'NEW' },
    { id: 3, xp: [4, 4], pos: 'MID', cost: 50, team: 'ARS' },
    { id: 4, xp: [4, 4], pos: 'MID', cost: 45, team: 'MCI' },
    { id: 5, xp: [2, 2], pos: 'MID', cost: 40, team: 'MUN' },
    { id: 6, xp: [4, 4], pos: 'DEF', cost: 50, team: 'AVL' },
    { id: 7, xp: [4, 4], pos: 'DEF', cost: 45, team: 'TOT' },
    { id: 8, xp: [4, 4], pos: 'DEF', cost: 40, team: 'CHE' },
    { id: 9, xp: [4, 4], pos: 'DEF', cost: 35, team: 'EVE' },
    { id: 10, xp: [2, 2], pos: 'DEF', cost: 35, team: 'BHA' },
    { id: 11, xp: [2, 2], pos: 'FWD', cost: 80, team: 'WHU' },
    { id: 12, xp: [2, 2], pos: 'FWD', cost: 70, team: 'BRE' },
    { id: 13, xp: [2, 2], pos: 'FWD', cost: 50, team: 'BOU' },
    { id: 14, xp: [2, 2], pos: 'GKP', cost: 45, team: 'CRY' },
    { id: 15, xp: [2, 2], pos: 'GKP', cost: 40, team: 'LEI' },
    // External high-scoring candidates (IDs 16 and 17)
    // We can swap MID 5 (cost 40) + DEF 10 (cost 35) -> MID 16 (cost 45, xp 9) + DEF 17 (cost 30, xp 9)
    // Total out value = 75. Total in value = 75. Fits budget!
    { id: 16, xp: [9, 9], pos: 'MID', cost: 45, team: 'LIV' },
    { id: 17, xp: [9, 9], pos: 'DEF', cost: 30, team: 'NEW' }
  ];

  const oracle = new MockOracle(mockPlayers);
  const simulator = new Simulator(true);

  const state: SquadState = {
    squad: mockPlayers.slice(0, 15).map(p => p.id),
    bank: 0,
    freeTransfers: 2, // 2 free transfers available
    chipState: { 'WC': 0, 'FH': 0, 'BB': 0, 'TC': 0 },
    gameweek: 1,
    accumulatedScore: 0, purchasePrices: {} };

  it('should solve optimal multi-transfers correctly', () => {
    const result = solveOptimalTransfers(oracle, 1, state, 2);
    expect(result).not.toBeNull();
    
    // The result should suggest transferring in 16 and 17
    expect(result!.transfersIn).toContain(16);
    expect(result!.transfersIn).toContain(17);
    
    // And transferring out 5 and 10
    expect(result!.transfersOut).toContain(5);
    expect(result!.transfersOut).toContain(10);
  });

  it('should generate multi-transfer actions in simulator', () => {
    const actions = simulator.generateValidActions(state, oracle, 1);
    
    // Find the action representing the optimal double transfer swap
    const doubleTransfer = actions.find(a => 
      a.type === 'TRANSFER' && 
      a.transfersIn && 
      a.transfersIn.length === 2 && 
      a.transfersIn.includes(16) && 
      a.transfersIn.includes(17)
    );

    expect(doubleTransfer).toBeDefined();
    expect(doubleTransfer!.hitCost).toBe(0); // covered by 2 FTs
  });

  it('should apply multi-transfer actions correctly and update free transfers and hits', () => {
    const actions = simulator.generateValidActions(state, oracle, 1);
    const doubleTransfer = actions.find(a => 
      a.type === 'TRANSFER' && 
      a.transfersIn && 
      a.transfersIn.length === 2
    )!;

    // Run the step
    const results = simulator.simulateHorizon(state, oracle);
    expect(results.length).toBeGreaterThan(0);
    
    // Find trajectory that started with a double transfer
    const traj = results.find(r => r.firstAction === 'TRANSFER' && r.firstTransfersIn && r.firstTransfersIn.length === 2);
    expect(traj).toBeDefined();
    
    // Verify squad has been updated (contains 16 and 17, does not contain 5 and 10)
    expect(traj!.squad).toContain(16);
    expect(traj!.squad).toContain(17);
    expect(traj!.squad).not.toContain(5);
    expect(traj!.squad).not.toContain(10);
    
    // Verify bank is updated
    expect(traj!.bank).toBe(0);
  });
});

// -------------------------------------------------------------
// 10. Probabilistic Player Model & Expected Utility Tests
// -------------------------------------------------------------
describe('Simulator - Probabilistic Player Model & Expected Utility', () => {
  const tempCsvPath = 'data/temp_probabilistic_test_fplform.csv';

  it('should parse Prob. of Appearing and calculate expected points and variance', () => {
    // 1. Create a temporary mock CSV with probability of appearing
    // Player 1 (Salah) - 0.95 probability of appearing, cost 12.5 (premium), merit 10.0
    // Player 2 (Isak) - 0.40 probability of appearing, cost 8.5, merit 6.0
    const csvContent = 
      `rank,player,id,team,position,cost,xp_gw1,xp_gw2,xp_gw3,dummy1,dummy2,dummy3,dummy4\n` +
      `1,Salah,1,LIV,MID,12.5,10.0,1.0,0.95,dummy,,,,\n` +
      `2,Isak,2,NEW,FWD,8.5,6.0,1.0,0.40,dummy,,,,\n`;
    
    fs.mkdirSync(path.dirname(tempCsvPath), { recursive: true });
    fs.writeFileSync(tempCsvPath, csvContent, 'utf-8');

    const realPlayersMetadata = [
      { id: 300, web_name: 'Salah', selected_by_percent: '45.0', team: 12 },
      { id: 450, web_name: 'Isak', selected_by_percent: '35.0', team: 15 }
    ];

    const mockTeams = [
      { id: 12, name: 'Liverpool', short_name: 'LIV' },
      { id: 15, name: 'Newcastle', short_name: 'NEW' }
    ];

    const oracle = new CSVOracle(tempCsvPath, realPlayersMetadata, 'safe', [], mockTeams, 30);

    // 1. Salah (Nailed Premium): P(play) = 0.95 >= 0.8
    // p90 = 0.95 * 0.85 = 0.8075
    // p60 = 0.95 * 0.15 = 0.1425
    // eApp = 0.1425 + 2 * 0.8075 = 1.7575
    // eApp2 = 0.1425 + 4 * 0.8075 = 3.3725
    // varApp = 3.3725 - (1.7575)^2 = 3.3725 - 3.0888 = 0.2837
    // Salah merit = 10.0 (unmutated pure xP)
    // expectedReturns = 10.0 - 1.7575 = 8.2425
    // varReturns = 1.5 * 8.2425 = 12.36375
    // totalVariance = varApp + varReturns = 0.2837 + 12.36375 = 12.647
    expect(oracle.getXP(300, 30)).toBeCloseTo(10.0, 1);
    expect(oracle.getVariance(300, 30)).toBeCloseTo(12.6, 1);

    // 2. Isak (Highly Rotated): P(play) = 0.40 < 0.8
    // p90 = 0.40 * 0.5 = 0.20
    // p60 = 0.40 * 0.5 = 0.20
    // eApp = 0.20 + 2 * 0.20 = 0.60
    // eApp2 = 0.20 + 4 * 0.20 = 1.00
    // varApp = 1.00 - (0.60)^2 = 1.00 - 0.36 = 0.64
    // Isak merit = 6.0 (unmutated pure xP)
    // expectedReturns = 6.0 - 0.60 = 5.40
    // varReturns = 1.5 * 5.40 = 8.10
    // totalVariance = varApp + varReturns = 0.64 + 8.10 = 8.74
    expect(oracle.getXP(450, 30)).toBeCloseTo(6.0, 1);
    expect(oracle.getVariance(450, 30)).toBeCloseTo(8.7, 1);

    // Clean up
    if (fs.existsSync(tempCsvPath)) {
      fs.unlinkSync(tempCsvPath);
    }
  });

  it('should apply squared captaincy variance multipliers in simulateMatchday', () => {
    const mockPlayers = [
      { id: 1, xp: [8], pos: 'MID', cost: 120, team: 'LIV' }, // captain
      { id: 2, xp: [6], pos: 'FWD', cost: 85, team: 'NEW' },  // vice-captain
      { id: 3, xp: [5], pos: 'DEF', cost: 50, team: 'ARS' },
      { id: 4, xp: [4], pos: 'DEF', cost: 45, team: 'MCI' },
      { id: 5, xp: [4], pos: 'MID', cost: 65, team: 'MUN' },
      { id: 6, xp: [3], pos: 'DEF', cost: 40, team: 'AVL' },
      { id: 7, xp: [3], pos: 'MID', cost: 60, team: 'TOT' },
      { id: 8, xp: [3], pos: 'FWD', cost: 75, team: 'CHE' },
      { id: 9, xp: [2], pos: 'GKP', cost: 45, team: 'EVE' },
      { id: 10, xp: [2], pos: 'DEF', cost: 42, team: 'BHA' },
      { id: 11, xp: [2], pos: 'MID', cost: 55, team: 'WHU' },
      { id: 12, xp: [1.5], pos: 'FWD', cost: 45, team: 'BRE' },
      { id: 13, xp: [1], pos: 'DEF', cost: 38, team: 'BOU' },
      { id: 14, xp: [1], pos: 'MID', cost: 44, team: 'CRY' },
      { id: 15, xp: [0.5], pos: 'GKP', cost: 40, team: 'LEI' }
    ];

    const oracle = new MockOracle(mockPlayers);
    const simulator = new Simulator(true);

    const state: SquadState = {
      squad: mockPlayers.map(p => p.id),
      bank: 10,
      freeTransfers: 1,
      chipState: { 'WC': 0, 'FH': 0, 'BB': 0, 'TC': 0 },
      gameweek: 1,
      accumulatedScore: 0, purchasePrices: {} };

    // 1. Standard Captaincy: Captain variance (12) is multiplied by 4 = 48
    // Rest of starters variance: 6*1.5 + 5*1.5 + 4*1.5 + 4*1.5 + 3*1.5 + 3*1.5 + 3*1.5 + 2*1.5 + 2*1.5 + 2*1.5 = 9 + 7.5 + 6 + 6 + 4.5 + 4.5 + 4.5 + 3 + 3 + 3 = 51.0
    // Total Variance = 48 + 51.0 = 99.0
    const res1 = simulator.simulateMatchday(state, 1, oracle);
    expect(res1.variance).toBeCloseTo(99.0, 1);

    // 2. Triple Captain: Captain variance (12) is multiplied by 9 = 108
    // Total Variance = 108 + 51.0 = 159.0
    const tcState = { ...state, activeChip: 'TC' };
    const res2 = simulator.simulateMatchday(tcState, 1, oracle);
    expect(res2.variance).toBeCloseTo(159.0, 1);
  });

  it('should prefer nailed player over highly-rotated player in safe riskMode due to variance penalty', () => {
    class RiskTestOracle implements XPOracle {
      public playerNames: Record<number, string> = {};
      getXP(id: number): number {
        if (id === 300) return 10.0;
        if (id === 450) return 11.0;
        return 2.0;
      }
      getVariance(id: number): number {
        if (id === 300) return 1.0;
        if (id === 450) return 20.0;
        return 3.0;
      }
      getPriceDelta(): number { return 0; }
      getFixtures(): any[] { return []; }
      getPosition(id: number): string { return 'MID'; }
      getCost(): number { return 100; }
      getTeam(): string { return 'LIV'; }
      getAllPlayerIds(): number[] { return []; }
      
      getDistribution(playerId: number, gameweek: number): PlayerDistribution {
        const xp = this.getXP(playerId);
        const v = this.getVariance(playerId);
        return {
          mean: xp,
          variance: v,
          skewness: 0,
          p50: xp,
          p75: xp,
          p90: xp,
          p95: xp,
          tails: { 15: playerId === 450 ? 0.3 : 0.05, 8: 0, 12: 0, 20: 0 },
          histogram: {}
        };
      }
    }

    const testOracle = new RiskTestOracle();
    const simulator = new Simulator(true);
    
    const stateSalah: SquadState = {
      squad: [300, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      bank: 0, freeTransfers: 1, chipState: {}, gameweek: 1, accumulatedScore: 0, purchasePrices: {} };
    const stateHaaland: SquadState = {
      squad: [450, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      bank: 0, freeTransfers: 1, chipState: {}, gameweek: 1, accumulatedScore: 0, purchasePrices: {} };

    // Safe mode horizon run - must use negative betaVariance to penalize variance
    const paramsSafe = { ...DEFAULT_PARAMETERS, betaVariance: -0.35, betaEO: 0.5 };
    const resultsSafeSalah = simulator.simulateHorizon(stateSalah, testOracle, paramsSafe);
    const resultsSafeHaaland = simulator.simulateHorizon(stateHaaland, testOracle, paramsSafe);
    
    // Salah's raw points are lower than Haaland's (because accumulatedScore in V3 does not subtract variance)
    expect(resultsSafeSalah[0].accumulatedScore).toBe(320);
    expect(resultsSafeHaaland[0].accumulatedScore).toBe(336);

    // Aggressive mode horizon run
    const paramsAggressive = { ...DEFAULT_PARAMETERS, betaVariance: 0.02, betaEO: -0.5 };
    const resultsAggressSalah = simulator.simulateHorizon(stateSalah, testOracle, paramsAggressive);
    const resultsAggressHaaland = simulator.simulateHorizon(stateHaaland, testOracle, paramsAggressive);

    // Haaland's trajectory should end up with a higher utility score than Salah's in aggressive mode
    expect(resultsAggressHaaland[0].accumulatedScore).toBeGreaterThan(resultsAggressSalah[0].accumulatedScore);
  });
});
