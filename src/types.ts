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
  next_fixtures: { opponent: string; difficulty: number; is_home: boolean }[];
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  position_in_squad?: number;
  multiplier?: number;
  eo?: number;
  ownership?: number;
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
  engineDiagnostics?: {
    budgetUsed: number;
    budgetLimit: number;
    riskMode: string;
    solverStatus: 'optimal' | 'heuristic_fallback';
    activeConstraints: {
      minEoTotal?: number;
      minElitePlayers?: number;
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
    };
  };
  topPicks: {
    gkp: ScoredPlayer[];
    def: ScoredPlayer[];
    mid: ScoredPlayer[];
    fwd: ScoredPlayer[];
  };
  nextEventId: number;
  lastUpdated: number;
}

export interface TransferRecommendation {
  out: ScoredPlayer;
  in: ScoredPlayer;
  localTransferSignal: number;
  xPDelta: number;
}

export interface ChipAdvice {
  chip: string;
  recommendation: 'STRONG BUY' | 'HOLD' | 'AVOID';
  reason: string;
}

export interface TeamSyncResponse {
  squad: ScoredPlayer[];
  transfers: TransferRecommendation[];
  chips: ChipAdvice[];
  bank?: number;
  totalCost?: number;
}
