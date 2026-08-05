import { DeadlineSnapshot } from './providers/historical.js';
import { XPOracle } from './ingestion.js';

export interface UtilityParameters {
  // Attacking Model
  betaAttackBase: number;
  betaXG: number;
  betaXA: number;
  betaXGI3: number;
  betaXGI5: number;
  betaTeamAttack: number;
  betaOppDefense: number;
  betaAttHome: number;
  
  betaAttFixture?: number;
  
  // Clean Sheet Model
  betaCsBase: number;
  betaTeamDefense: number;
  betaOppAttack: number;
  betaCsHome: number;
  betaCsFixture?: number;
  
  // Bonus Model
  betaBonusBase: number;
  betaBpsBaseline: number;
  
  // Variance
  betaVariance: number;
  betaEO: number;

  // Minutes Model
  betaMinutesBase: number;
  betaMinutesTrend?: number;
  betaMinutesLast1: number;
  betaMinutesLast3: number;
  betaMinutesLast5: number;
  betaMinutesEWMA: number;
  betaStartsLast5: number;
  betaSeasonMins: number;
  betaRestHours: number;
  betaFix7Days: number;
  betaFix14Days: number;
  betaMinVolatility: number;
  betaChanceOfPlaying: number;
  betaSelectionMomentum: number;
  betaConsecutiveStarts: number;
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
    // Fallback to player.predictedMinutes (chance_of_playing * 90) if model lacks complex minutes weights
    let expectedMinutes = Math.max(0, Math.min(90, 
      (this.params.betaMinutesBase || 0) +
      (this.params.betaMinutesLast1 || 0) * (player.minutesLast1 || 0) +
      (this.params.betaMinutesLast3 || 0) * (player.minutesLast3 || 0) +
      (this.params.betaMinutesLast5 || 0) * (player.minutesLast5 || 0) +
      (this.params.betaMinutesEWMA || 0) * (player.minutesEWMA || 0) +
      (this.params.betaStartsLast5 || 0) * (player.startsLast5 || 0) +
      (this.params.betaSeasonMins || 0) * (player.seasonMinutesPercent || 0) +
      (this.params.betaRestHours || 0) * (player.restHours || 168) +
      (this.params.betaFix7Days || 0) * (player.fixturesLast7Days || 0) +
      (this.params.betaFix14Days || 0) * (player.fixturesLast14Days || 0) +
      (this.params.betaMinVolatility || 0) * (player.minutesVolatility || 0) +
      (this.params.betaChanceOfPlaying || 0) * (player.chanceOfPlayingThisRound !== undefined ? player.chanceOfPlayingThisRound : 100) +
      (this.params.betaSelectionMomentum || 0) * (player.selectionMomentum || 0) +
      (this.params.betaConsecutiveStarts || 0) * (player.consecutiveStarts || 0) +
      (this.params.betaMinutesTrend || 0) * (player.minutesTrend || 0)
    ));
    
    // If the ML model didn't provide enough weights to predict > 20 mins, but the player is fit, 
    // fall back to their basic predicted probability of playing to prevent zeroing out xP.
    if (expectedMinutes < 20 && player.predictedMinutes > 20) {
        expectedMinutes = player.predictedMinutes;
    }
    // Save to player so oracle can expose it if needed
    player.predictedMinutes = expectedMinutes;
    
    // Weight the points model by expected minutes fraction
    const minuteFraction = expectedMinutes / 90;
    
    fixtures.forEach(fix => {
      const isHome = fix.isHome ? 1 : 0;
      
      const oppDefense = fix.opponentDefenseRating || 1.5; 
      const oppAttack = fix.opponentAttackRating || 1.5;
      const teamAttack = fix.teamAttackRating || 1.5;
      const teamDefense = fix.teamDefenseRating || 1.5;
      
      // Sub-model 1: Attacking Returns
      let expectedAttack = (this.params.betaAttackBase || 0) 
        + (this.params.betaXG || 0) * player.xG90
        + (this.params.betaXA || 0) * player.xA90
        + (this.params.betaXGI3 || 0) * player.xGI3
        + (this.params.betaXGI5 || 0) * player.xGI5
        + (this.params.betaTeamAttack || 0) * teamAttack
        + (this.params.betaOppDefense || 0) * oppDefense
        + (this.params.betaAttFixture || 0) * (fix.difficulty || 3)
        + (this.params.betaAttHome || 0) * isHome;
        
      expectedAttack = Math.max(0, expectedAttack) * minuteFraction;

      // Sub-model 2: Clean Sheet Probability
      // Only Defenders and GKs get full CS points (4). Mids get (1). Fwds get 0.
      let csMultiplier = player.position === 'DEF' || player.position === 'GKP' ? 4 : (player.position === 'MID' ? 1 : 0);
      let expectedCsProb = (this.params.betaCsBase || 0)
        + (this.params.betaTeamDefense || 0) * teamDefense 
        + (this.params.betaOppAttack || 0) * oppAttack
        + (this.params.betaCsFixture || 0) * (fix.difficulty || 3)
        + (this.params.betaCsHome || 0) * isHome;

      expectedCsProb = Math.max(0, Math.min(1, expectedCsProb)) * minuteFraction;
      const expectedCS = expectedCsProb * csMultiplier;

      // Sub-model 3: Bonus
      let expectedBonus = Math.max(0, (this.params.betaBonusBase || 0) + (this.params.betaBpsBaseline || 0) * (expectedAttack + (expectedCS > 0 ? 0.5 : 0)));

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
