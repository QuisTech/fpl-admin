export interface MonteCarloAuditPlayer {
  id: number;
  name: string;
  team: string;
  position: string;
  projectedXp: number;
  actualPoints: number;
  played: boolean;
  subbedIn?: boolean;
}

export interface MonteCarloModeResult {
  mode: 'safe' | 'aggressive' | 'value';
  scenario: 'quant' | 'template';
  scenarioLabel: string;
  startingXI: MonteCarloAuditPlayer[];
  bench: MonteCarloAuditPlayer[];
  captain: {
    id: number;
    name: string;
    actualPoints: number;
    multiplier: number;
    originalName?: string;
    isVcPromoted?: boolean;
  };
  viceCaptain: {
    id: number;
    name: string;
    actualPoints: number;
  };
  transfers: {
    in: string[];
    out: string[];
    hitCost: number;
  };
  chipUsed?: string;
  monteCarlo: {
    meanXp: number;
    median: number;
    p10: number;
    p90: number;
    confidenceInterval: [number, number];
    haulProbability: number;
    blankProbability: number;
    variance: number;
  };
  reconciliation: {
    actualScore: number;
    netActualScore: number;
    insideConfidenceInterval: boolean;
    predictionError: number;
    haulAchieved: boolean;
    blankOccurred: boolean;
    alphaVsTemplate: number;
  };
}

export interface MonteCarloGwArchive {
  gameweek: number;
  templateScore: number;
  averageScore: number;
  results: Record<string, MonteCarloModeResult>; // keyed by `${scenario}_${mode}` e.g. "quant_safe", "template_aggressive"
}

export interface MonteCarloAuditDataset {
  generatedAt: string;
  fuel: string;
  startGw: number;
  endGw: number;
  hasLivePoints: boolean;
  scenarios: ('quant' | 'template')[];
  modes: ('safe' | 'aggressive' | 'value')[];
  calibrationSummary: {
    totalEvaluated: number;
    ciHitCount: number;
    ciCoverageRate: number;
    avgAbsoluteError: number;
    haulHitCount: number;
    haulPredictedCount: number;
  };
  cumulativeTotals: Record<string, {
    totalPoints: number;
    netAlpha: number;
  }>;
  gameweeks: MonteCarloGwArchive[];
}
