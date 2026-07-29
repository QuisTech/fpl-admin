export function getRiskLambda(riskMode: string): number {
  if (riskMode === 'safe') return 0.02; // Mathematically optimized for 2023/24 season
  if (riskMode === 'aggressive') return 0.00; // Total risk blindness
  return 0.02; // value or default
}

export function calculatePlayerUtility(
  totalXP: number,
  totalVariance: number,
  costInMillions: number,
  riskMode: string,
  playerId?: number
): number {
  let score = totalXP;

  if (riskMode === 'value') {
    if (costInMillions > 0) {
      score = (0.7 * totalXP) + (0.3 * (totalXP / costInMillions));
    }
    // Add deterministic tie-breaker to prevent search explosion in branch-and-bound LP solver
    if (playerId) {
      score += (playerId % 10000) * 1e-4;
    }
    return score;
  }

  // Apply risk lambda
  const lambda = getRiskLambda(riskMode);
  score = score - (lambda * totalVariance);

  return score;
}

export function calculateCaptainUtility(
  xp: number,
  variance: number,
  eo: number,
  riskMode: string
): number {
  // A basic #1-contending captain model:
  // We want high expected points, but we also want a high ceiling (variance).
  // Depending on the mode, EO is either a safety net or something to avoid.
  let utility = xp;

  // Ceiling factor: Captiancy is about explosive potential
  utility += (Math.sqrt(variance) * 0.5);

  if (riskMode === 'safe') {
    // In safe mode, captaining highly owned players is good (shield)
    utility += (eo / 100) * 0.5;
  } else if (riskMode === 'aggressive') {
    // In aggressive mode, we want low EO captains (differentials)
    utility -= (eo / 100) * 0.5;
  }

  return utility;
}
