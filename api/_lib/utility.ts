import { UtilityParameters } from './projection.js';

export function calculateUtility(
  xp: number,
  variance: number,
  eo: number,
  params: UtilityParameters,
  playerId?: number
): number {
  let score = xp 
    + params.betaVariance * Math.sqrt(variance)
    + params.betaEO * (eo / 100);

  if (params.betaDifferential && eo < 15) {
    // Only apply differential bonus to players who actually play (prevents degenerate branch-and-bound explosion with 0 xP bench fodders)
    const xpScale = Math.min(1, Math.max(0, xp / 3.0));
    score += params.betaDifferential * (1 - eo / 15) * xpScale;
  }

  // Add deterministic tie-breaker to prevent search explosion in branch-and-bound LP solver
  // This ensures identical players always resolve deterministically.
  if (playerId) {
    score += (playerId % 10000) * 1e-4;
  }

  return score;
}

