import { DeadlineSnapshot } from './providers/historical.js';
import { XPOracle } from './ingestion.js';

export interface UtilityParameters {
  // Minutes Model
  betaMinutesBase: number;
  betaMinutesTrend: number;

  // Attacking Model
  betaAttackBase: number;
  betaXG: number;
  betaXA: number;
  betaXGI3: number;
  betaXGI5: number;
  betaAttFixture: number;
  betaTeamAttack: number;
  betaOppDefense: number;
  betaAttHome: number;

  // Clean Sheet Model
  betaCsBase: number;
  betaTeamDefense: number;
  betaOppAttack: number;
  betaCsFixture: number;
  betaCsHome: number;
  
  // Bonus Model
  betaBonusBase: number;
  betaBpsBaseline: number; // Derived from xG/xA

  // Variance
  betaVariance: number;
  betaEO: number;
  // Constraints
  minEoTotal?: number;
  minElitePlayers?: number;
  budgetMultiplier?: number;
}

export interface ProjectionInput {
  playerId: number;
  source: 'EYE_TEST' | 'NATIVE' | 'FPLFORM';
  features?: any; // Will use HistoricalPlayerFeatures
  externalXP?: number;
}

export function getParamsForRiskMode(riskMode: string, baseWeights: UtilityParameters): UtilityParameters {
  const params = { ...baseWeights };
  if (riskMode === 'aggressive') {
    params.betaVariance = 0.5; // Favor high variance (differentials)
    params.betaEO = -2.0; // Heavily penalize high EO players (-2 points for 100% EO)
  } else if (riskMode === 'safe') {
    params.betaVariance = -0.1; // Slight penalty to variance
    params.betaEO = 2.0; // Heavily reward high EO players
    params.minEoTotal = 150;
    params.minElitePlayers = 1;
  } else if (riskMode === 'value') {
    params.betaVariance = 0.0;
    params.betaEO = 0.0;
    params.budgetMultiplier = 0.85; // Force a strict 85% budget to maximize ROI
  } else {
    params.betaVariance = 0.05;
    params.betaEO = 0.0;
  }
  return params;
}

export class ProjectionEngine {
  private params: UtilityParameters;

  constructor(params: UtilityParameters) {
    this.params = params;
  }

  /**
   * Universal Predictor for Expected Points (XP) and Variance
   */
  public predict(input: ProjectionInput, targetGw: number): { expected: number, variance: number } {
    if (input.source === 'NATIVE' || input.source === 'FPLFORM') {
      return { expected: input.externalXP || 0, variance: (input.externalXP || 0) * this.params.betaVariance };
    }

    if (!input.features) return { expected: 0, variance: 0 };
    const player = input.features;
    
    const fixtures = player.fixturesByGw?.[targetGw] || [];
    if (fixtures.length === 0) return { expected: 0, variance: 0 };

    let totalXp = 0;
    let totalVar = 0;
    
    // Stage 1: Minutes Model
    const expectedMinutes = Math.max(0, Math.min(90, 
      this.params.betaMinutesBase * (player.minutesLast4 / 4) +
      this.params.betaMinutesTrend * player.minutesTrend
    ));
    // Save to player so oracle can expose it if needed
    player.predictedMinutes = expectedMinutes;
    
    // Weight the points model by expected minutes fraction
    const minuteFraction = expectedMinutes / 90;
    
    fixtures.forEach(fix => {
      const isHome = fix.isHome ? 1 : 0;
      const fixtureDiff = fix.difficulty;
      
      const oppDefense = fix.opponentStrengthDefense; 
      const oppAttack = fix.opponentStrengthAttack;
      
      // Sub-model 1: Attacking Returns
      let expectedAttack = this.params.betaAttackBase 
        + this.params.betaXG * player.xG90
        + this.params.betaXA * player.xA90
        + this.params.betaXGI3 * player.xGI3
        + this.params.betaXGI5 * player.xGI5
        + this.params.betaAttFixture * fixtureDiff
        + this.params.betaTeamAttack * 1.5 // Simplified team attack metric
        + this.params.betaOppDefense * oppDefense
        + this.params.betaAttHome * isHome;
        
      expectedAttack = Math.max(0, expectedAttack) * minuteFraction;

      // Sub-model 2: Clean Sheet Probability
      // Only Defenders and GKs get full CS points (4). Mids get (1). Fwds get 0.
      let csMultiplier = player.position === 'DEF' || player.position === 'GKP' ? 4 : (player.position === 'MID' ? 1 : 0);
      let expectedCsProb = this.params.betaCsBase
        + this.params.betaTeamDefense * 1.5 
        + this.params.betaOppAttack * oppAttack
        + this.params.betaCsFixture * fixtureDiff
        + this.params.betaCsHome * isHome;

      expectedCsProb = Math.max(0, Math.min(1, expectedCsProb)) * minuteFraction;
      const expectedCS = expectedCsProb * csMultiplier;

      // Sub-model 3: Bonus
      const expectedBonus = Math.max(0, this.params.betaBonusBase + this.params.betaBpsBaseline * (expectedAttack / 3));

      // Sub-model 4: Appearance
      // Roughly 2 points if > 60 mins, 1 pt if < 60 mins
      const expectedAppearance = expectedMinutes > 60 ? 2 : (expectedMinutes > 0 ? 1 : 0);

      // Appearance variance (Binomial)
      const pApp = Math.min(1, Math.max(0, expectedMinutes / 90));
      const appVar = pApp * (1 - pApp) * 4; // 2 points squared

      // Attack variance (Poisson assumption: Var = Mean)
      // Since goals are ~5 points and assists ~3, the variance in points is much higher than the mean in points.
      // Roughly Var(Attacking Points) ≈ Mean(Attacking Points) * Average Point Value
      const attackVar = expectedAttack * 4; 

      // CS variance (Binomial)
      const csVar = expectedCsProb * (1 - expectedCsProb) * (csMultiplier * csMultiplier);

      // Bonus variance
      const bonusVar = expectedBonus * 1.5; // Heuristic

      // Total XP and Variance
      totalXp += expectedAppearance + expectedAttack + expectedCS + expectedBonus;
      totalVar += appVar + attackVar + csVar + bonusVar;
    });
    
    // Scale by user's risk preference (betaVariance)
    totalVar *= (1 + this.params.betaVariance);

    return { expected: totalXp, variance: totalVar };
  }
}

export class HistoricalOracle implements XPOracle {
  private engine: ProjectionEngine;
  private snapshot: DeadlineSnapshot;

  constructor(snapshot: DeadlineSnapshot, engine: ProjectionEngine) {
    this.snapshot = snapshot;
    this.engine = engine;
  }

  private getProjectionInput(playerId: number): ProjectionInput {
    return {
      playerId,
      source: 'EYE_TEST', // Historical backtests construct features like EYE_TEST
      features: this.snapshot.players[playerId]
    };
  }

  getXP(playerId: number, gameweek: number): number {
    return this.engine.predict(this.getProjectionInput(playerId), gameweek).expected;
  }

  getVariance(playerId: number, gameweek: number): number {
    return this.engine.predict(this.getProjectionInput(playerId), gameweek).variance;
  }

  getCost(playerId: number): number {
    const player = this.snapshot.players[playerId];
    return player ? Math.round(player.price * 10) : 0;
  }

  getPosition(playerId: number): string {
    return this.snapshot.players[playerId]?.position || 'MID';
  }

  getTeam(playerId: number): string {
    return (this.snapshot.players[playerId]?.teamId || 0).toString();
  }

  getAllPlayerIds(): number[] {
    return Object.keys(this.snapshot.players).map(id => parseInt(id));
  }

  getPriceDelta(playerId: number): number {
    return 0;
  }

  getTop1kEO(playerId: number): number {
    return this.snapshot.players[playerId]?.eo || 0;
  }
}
