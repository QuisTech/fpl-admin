import { z } from 'zod';

export const FPLPlayerSchema = z.object({
  id: z.number(),
  web_name: z.string(),
  first_name: z.string(),
  second_name: z.string(),
  now_cost: z.number(),
  element_type: z.number(),
  team: z.number(),
  total_points: z.number().nullish().default(0),
  form: z.string().nullish().default("0.0"),
  points_per_game: z.string().nullish().default("0.0"),
  selected_by_percent: z.string().nullish().default("0.0"),
  minutes: z.number().nullish().default(0),
  goals_scored: z.number().nullish().default(0),
  assists: z.number().nullish().default(0),
  clean_sheets: z.number().nullish().default(0),
  status: z.string(),
  news: z.string().nullish().default(""),
  chance_of_playing_next_round: z.number().nullish().default(100),
  expected_goals: z.string().nullish().default("0.0"),
  expected_assists: z.string().nullish().default("0.0"),
  expected_goals_conceded: z.string().nullish().default("0.0"),
  ict_index: z.string().nullish().default("0.0"),
}).passthrough();


export const FPLTeamSchema = z.object({
  id: z.number(),
  name: z.string(),
  short_name: z.string(),
  strength: z.number().nullish().default(0),
  strength_attack_home: z.number().nullish().default(0),
  strength_attack_away: z.number().nullish().default(0),
  strength_defence_home: z.number().nullish().default(0),
  strength_defence_away: z.number().nullish().default(0),
}).passthrough();

export const FPLFixtureSchema = z.object({
  id: z.number(),
  team_h: z.number(),
  team_a: z.number(),
  team_h_difficulty: z.number(),
  team_a_difficulty: z.number(),
  event: z.number().nullable(),
  finished: z.boolean(),
});

export type FPLPlayer = z.infer<typeof FPLPlayerSchema>;
export type FPLTeam = z.infer<typeof FPLTeamSchema>;
export type FPLFixture = z.infer<typeof FPLFixtureSchema>;

export interface ScoredPlayer extends FPLPlayer {
  score: number;
  xP: number;
  horizonXP?: number;
  ppm: number;
  team_name: string;
  team_short_name: string;
  position: string;
  next_fixtures: { event?: number; opponent: string; difficulty: number; is_home?: boolean }[];
  isCaptain: boolean;
  isViceCaptain: boolean;
  position_in_squad?: number;
  multiplier?: number;
  eo?: number;
  ownership?: number;
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
  captain: ScoredPlayer;
  viceCaptain: ScoredPlayer;
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
      averageXiEo: number;
      horizonTotalXp: number;
      swapAnalysis?: {
        swapCount: number;
        divergenceTier: 'LOW_DIVERGENCE_WARNING' | 'HEALTHY_DIFFERENTIAL' | 'HIGH_DIVERGENCE_WARNING';
        totalXpSacrificed8GW: number;
        avgSwapCostPerGw: number;
        avgEoReduction: number;
        withinThresholdCount: number;
        withinThresholdPct: number;
        differentialQuality: 'PASS' | 'WARNING';
        swaps: Array<{
          outPlayer: string;
          inPlayer: string;
          position: string;
          xpSacrifice8GW: number;
          xpSacrificePerGw: number;
          eoReduction: number;
        }>;
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
  nextEventId: number;
  lastUpdated: number;
}

export interface TransferRecommendation {
  out: ScoredPlayer;
  in: ScoredPlayer;
  localTransferSignal: number;
  xPDelta: number;
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

export interface PlayerDistribution {
  mean: number;
  variance: number;
  skewness: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  tails: Record<number, number>;
  histogram: Record<number, number>;
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
}

