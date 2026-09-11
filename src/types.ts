export interface FPLPlayer {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
  now_cost: number;
  element_type: number; // 1: GKP, 2: DEF, 3: MID, 4: FWD
  team: number;
  total_points: number;
  form: string;
  points_per_game: string;
  selected_by_percent: string;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  status: string;
  news: string;
  ep_this: string;
  ep_next: string;
  chance_of_playing_this_round: number | null;
  chance_of_playing_next_round: number | null;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  expected_conceded: string;
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
}

export interface FPLTeam {
  id: number;
  name: string;
  short_name: string;
  strength: number;
  strength_overall_home: number;
  strength_overall_away: number;
  strength_attack_home: number;
  strength_attack_away: number;
  strength_defence_home: number;
  strength_defence_away: number;
}

export interface FPLFixture {
  id: number;
  code: number;
  team_h: number;
  team_a: number;
  team_h_difficulty: number;
  team_a_difficulty: number;
  event: number | null;
  finished: boolean;
  minutes: number;
  provisional_start_time: boolean;
  kickoff_time: string;
}

export interface ScoredPlayer extends FPLPlayer {
  score: number;
  xP: number;
  ppm: number;
  team_name: string;
  team_short_name: string;
  position: string;
  next_fixtures: { event?: number; opponent: string; difficulty: number; is_home: boolean }[];
  isCaptain?: boolean;
  is_captain?: boolean;
  isViceCaptain?: boolean;
  position_in_squad?: number;
  multiplier?: number;
  eo?: number;
  ownership?: number;
  cost?: number;
  horizonXP?: number;
}

export interface OmissionAnalysis {
  omittedPlayer: {
    id: number;
    name: string;
    team: string;
    position: string;
    cost: number;
    eo: number;
    xP: number;
  };
  replacementPlayers: Array<{
    id: number;
    name: string;
    team: string;
    position: string;
    cost: number;
    xP: number;
  }>;
  netXpGain: number;
  explanation: string;
}

export interface ScenarioComparison {
  quant: {
    expectedPoints: number;
    averageXiEo: number;
    captain: string;
    topPicksSummary: string;
  };
  template: {
    expectedPoints: number;
    averageXiEo: number;
    captain: string;
    topPicksSummary: string;
  };
  delta: {
    xpDiff: number;
    eoDiff: number;
    swaps: Array<{
      outPlayer: string;
      inPlayer: string;
      position: string;
      xpDiff: number;
      eoDiff: number;
    }>;
  };
}

export interface RecommendationResponse {
  squad: ScoredPlayer[];
  startingXI: ScoredPlayer[];
  bench: ScoredPlayer[];
  captain: ScoredPlayer | null;
  viceCaptain: ScoredPlayer | null;
  expectedPoints: number;
  totalCost: number;
  isHeuristicFallback?: boolean;
  activeScenario?: 'quant' | 'template';
  lockedPlayerIds?: number[];
  excludedPlayerIds?: number[];
  engineDiagnostics?: {
    budgetUsed: number;
    budgetLimit: number;
    riskMode: string;
    solverStatus: 'optimal' | 'heuristic_fallback';
    activeConstraints: {
      minEoTotal?: number;
      minElitePlayers?: number;
      lockedCount?: number;
      excludedCount?: number;
    };
    metrics?: {
      horizonTotalXp?: number;
      averageXiEo?: number;
      swapAnalysis?: {
        swapCount: number;
        differentialQuality: string;
        withinThresholdPct: number;
        divergenceTier: string;
        avgSwapCostPerGw: number;
        totalXpSacrificed8GW: number;
        avgEoReduction: number;
      };
      scenarioComparison?: ScenarioComparison;
      omissionAnalysis?: OmissionAnalysis[];
    };
  };
  topPicks: {
    gkp: ScoredPlayer[];
    def: ScoredPlayer[];
    mid: ScoredPlayer[];
    fwd: ScoredPlayer[];
  };
  topManagerInsight?: TopManagerInsight;
  nextEventId: number;
  lastUpdated: number;
}

export interface EliteIntelligenceConfig {
  startWeight: number; // default: 1.0
  captainWeight: number; // default: 0.5
  benchPenalty: number; // default: 0.2
  startingWeaponMinStartRate: number; // default: 0.50
  benchEnablerMinBenchRate: number; // default: 0.50
  hardLockMinConviction: number; // default: 1.0
}

export interface EliteConsensusDetail {
  id: number;
  web_name: string;
  position: string;
  cost: number;
  
  // Optional rich display metadata
  code?: number;
  team_code?: number;
  team_name?: string;
  team_short_name?: string;
  full_name?: string;

  // Raw decision counts
  squadCount: number;
  startCount: number;
  benchCount: number;
  captainCount: number;
  viceCaptainCount: number;
  transfersInCount: number;
  transfersOutCount: number;
  eligibleManagers: number;

  // Canonical Rates (0.0 to 1.0)
  // NOTE: transfersInRate and transfersOutRate represent manager participation rates,
  // not the percentage share of all league transfers.
  ownershipRate: number;
  startRate: number;
  benchRate: number;
  captainRate: number;
  viceCaptainRate: number;
  transfersInRate: number;
  transfersOutRate: number;

  // Conviction & Derived Classifications
  convictionScore: number;
  convictionIndex: number; // Normalized (0-100 scale, e.g. 1.25 -> 125)
  isStartingWeapon: boolean;
  isBenchEnabler: boolean;
  qualifiesForHardLock: boolean;
}

export interface ConsensusCaptainDetail {
  id: number;
  web_name: string;
  full_name?: string;
  code?: number;
  team_code?: number;
  team_name?: string;
  team_short_name?: string;
  position: string;
  cost: number;
  captainRate: number;
  captainPercentage: number;
  captainCount: number;
  eligibleManagers: number;
  isQuantCaptainMatch?: boolean;
}

export interface CaptaincyDistributionItem {
  id: number;
  web_name: string;
  full_name?: string;
  code?: number;
  team_code?: number;
  team_name?: string;
  team_short_name?: string;
  position: string;
  cost: number;
  captainRate: number;
  captainPercentage: number;
  captainCount: number;
}

export interface TopManagerInsight {
  noChipLeaderCount: number;
  eligibleManagers: number;
  pureZeroChipCount?: number;
  normalizedChipCount?: number;
  sampleLeaders: Array<{
    rank: number;
    entry: number;
    manager_name: string;
    team_name: string;
    total_points: number;
    normalized_total_points?: number;
    chip_deduction?: number;
    is_chip_normalized?: boolean;
    chips_used?: Array<{ name: string; time: string; event: number }>;
  }>;
  marketDisagreementRating: number;
  eliteConsensusPicks: string[];
  consensusDetails: EliteConsensusDetail[];
  consensusCaptain?: ConsensusCaptainDetail;
  consensusViceCaptain?: ConsensusCaptainDetail;
  captaincyDistribution?: CaptaincyDistributionItem[];
}

export interface TransferRecommendation {
  out: ScoredPlayer;
  in: ScoredPlayer;
  localTransferSignal: number;
  xPDelta: number;
  strategicScore?: number;
  horizon8GwXpIn?: number;
  horizon8GwXpOut?: number;
  horizon8GwDelta?: number;
  squad8GwXpBefore?: number;
  squad8GwXpAfter?: number;
}

export interface ChipAdvice {
  chip: string;
  recommendation: 'STRONG BUY' | 'HOLD' | 'AVOID';
  reason: string;
}

export interface EntryHistory {
  points: number;
  total_points: number;
  overall_rank: number;
  rank: number;
  event_transfers: number;
  event_transfers_cost: number;
  value: number;
  bank: number;
}

export interface ManagerInfo {
  id: number;
  teamName: string;
  managerName: string;
  summary_overall_rank?: number;
  summary_overall_points?: number;
  summary_event_points?: number;
  summary_event_rank?: number;
  last_deadline_total_transfers?: number;
}

export interface TeamSyncResponse {
  squad: ScoredPlayer[];
  transfers: TransferRecommendation[];
  chips: ChipAdvice[];
  bank?: number;
  totalCost?: number;
  entryHistory?: EntryHistory | null;
  managerInfo?: ManagerInfo | null;
  gameweek?: number;
}

