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

  // Add deterministic tie-breaker to prevent search explosion in branch-and-bound LP solver
  // This ensures identical players always resolve deterministically.
  if (playerId) {
    score += (playerId % 10000) * 1e-4;
  }

  return score;
}

