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
  ict_index: z.string().nullish().default("0.0"),
}).passthrough();


export const FPLTeamSchema = z.object({
  id: z.number(),
  name: z.string(),
  short_name: z.string(),
  strength: z.number(),
});

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
  ppm: number;
  team_name: string;
  team_short_name: string;
  position: string;
  next_fixtures: { opponent: string; difficulty: number }[];
  isCaptain: boolean;
  isViceCaptain: boolean;
  position_in_squad?: number;
  multiplier?: number;
  eo?: number;
  ownership?: number;
}


export interface RecommendationResponse {
  squad: ScoredPlayer[];
  startingXI: ScoredPlayer[];
  bench: ScoredPlayer[];
  captain: ScoredPlayer;
  viceCaptain: ScoredPlayer;
  expectedPoints: number;
  totalCost: number;
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

