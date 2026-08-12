import { DeadlineSnapshot } from './providers/historical.js';
import { XPOracle } from './ingestion.js';
import { PlayerDistribution } from './types.js';

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
  betaDifferential?: number;
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
    params.betaVariance = 0.8; // Favor high variance (differentials)
    params.betaEO = -5.0; // Strongly penalize high EO template players
    params.betaDifferential = 5.0; // Directly reward low-ownership differential gems (< 15% EO)
  } else if (riskMode === 'safe') {
    params.betaVariance = -0.1; // Slight penalty to variance
    params.betaEO = 3.5; // Strongly reward high EO template players
    params.minEoTotal = 200; // Force solid template coverage
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
      const xp = input.externalXP || 0;
      const pApp = input.features ? (input.features.chanceOfPlayingThisRound / 100) : 1.0;
      
      let p90 = 0, p60 = 0, pSub = 0;
      if (pApp >= 0.8) {
        p90 = pApp * 0.85;
        p60 = pApp * 0.15;
      } else {
        p90 = pApp * 0.5;
        p60 = pApp * 0.3;
        pSub = pApp * 0.2;
      }
      const eApp = pSub * 1 + p60 * 1 + p90 * 2;
      const eApp2 = pSub * 1 + p60 * 1 + p90 * 4;
      const varApp = eApp2 - (eApp * eApp);
      
      const expectedReturns = Math.max(0, xp - eApp);
      const varReturns = 1.5 * expectedReturns;
      
      return { expected: xp, variance: varApp + varReturns };
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

  // Error function approximation for Normal CDF
  private erf(x: number): number {
    const sign = (x >= 0) ? 1 : -1;
    x = Math.abs(x);
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  private normalCDF(x: number, mean: number, variance: number): number {
    if (variance <= 0) return x >= mean ? 1 : 0;
    const sd = Math.sqrt(variance);
    return 0.5 * (1 + this.erf((x - mean) / (sd * Math.sqrt(2))));
  }

  private approximateDistribution(mean: number, variance: number): PlayerDistribution {
    const tails: Record<number, number> = {
      8: 1 - this.normalCDF(8, mean, variance),
      12: 1 - this.normalCDF(12, mean, variance),
      15: 1 - this.normalCDF(15, mean, variance),
      20: 1 - this.normalCDF(20, mean, variance)
    };
    
    // Discretized histogram approximation for Normal CDF
    const histogram: Record<number, number> = {};
    for (let i = 0; i <= 25; i++) {
       const lower = this.normalCDF(i - 0.5, mean, variance);
       const upper = this.normalCDF(i + 0.5, mean, variance);
       histogram[i] = Math.max(0, upper - lower);
    }

    return {
      mean,
      variance,
      skewness: 0, // Normal distribution has 0 skewness
      p50: mean, // In a normal distribution, mean == median
      p75: mean + 0.674 * Math.sqrt(variance),
      p90: mean + 1.282 * Math.sqrt(variance),
      p95: mean + 1.645 * Math.sqrt(variance),
      tails,
      histogram
    };
  }

  simulatePlayerDistribution(input: ProjectionInput, gameweek: number): PlayerDistribution {
    const { expected: mean, variance } = this.predict(input, gameweek);
    
    // For Native/FPLForm, we lack latent variables, so we use Normal approximation
    if (input.source !== 'EYE_TEST') {
      return this.approximateDistribution(mean, variance);
    }
    
    // For EyeTest, we can run a Monte Carlo simulation
    const player = input.features;
    if (!player || !player.fixturesByGw || !player.fixturesByGw[gameweek]) {
      return this.approximateDistribution(mean, variance);
    }

    const fixtures = player.fixturesByGw[gameweek];
    const iterations = 5000;
    const scores: number[] = new Array(iterations).fill(0);
    
    // We calculate the latent expectations per fixture once, then simulate 5000 times
    const fixProbs = fixtures.map(fix => {
      const isHome = fix.isHome ? 1 : 0;
      const oppDefense = fix.opponentDefenseRating || 1.5; 
      const oppAttack = fix.opponentAttackRating || 1.5;
      const teamAttack = fix.teamAttackRating || 1.5;
      const teamDefense = fix.teamDefenseRating || 1.5;
      
      let expectedAttack = (this.params.betaAttackBase || 0) 
        + (this.params.betaXG || 0) * player.xG90
        + (this.params.betaXA || 0) * player.xA90
        + (this.params.betaXGI3 || 0) * player.xGI3
        + (this.params.betaXGI5 || 0) * player.xGI5
        + (this.params.betaTeamAttack || 0) * teamAttack
        + (this.params.betaOppDefense || 0) * oppDefense
        + (this.params.betaAttFixture || 0) * (fix.difficulty || 3)
        + (this.params.betaAttHome || 0) * isHome;
      expectedAttack = Math.max(0, expectedAttack);

      let csMultiplier = player.position === 'DEF' || player.position === 'GKP' ? 4 : (player.position === 'MID' ? 1 : 0);
      let expectedCsProb = (this.params.betaCsBase || 0)
        + (this.params.betaTeamDefense || 0) * teamDefense 
        + (this.params.betaOppAttack || 0) * oppAttack
        + (this.params.betaCsFixture || 0) * (fix.difficulty || 3)
        + (this.params.betaCsHome || 0) * isHome;
      expectedCsProb = Math.max(0, Math.min(1, expectedCsProb));
      
      const expectedBonus = Math.max(0, (this.params.betaBonusBase || 0) + (this.params.betaBpsBaseline || 0) * (expectedAttack + (expectedCsProb > 0 ? 0.5 : 0)));
      
      return { expectedAttack, expectedCsProb, csMultiplier, expectedBonus };
    });

    const expectedMinutes = Math.min(90 * fixtures.length, Math.max(0, (player.minutes || 0) * (fixtures.length)));
    const pApp = Math.min(1, Math.max(0, expectedMinutes / 90));

    // Helper to sample Poisson
    const samplePoisson = (lambda: number) => {
      let L = Math.exp(-lambda), k = 0, p = 1;
      do { k++; p *= Math.random(); } while (p > L);
      return k - 1;
    };

    let sum3 = 0;
    const histogram: Record<number, number> = {};

    for (let i = 0; i < iterations; i++) {
      let gwScore = 0;
      
      fixProbs.forEach(fp => {
         // Did they appear?
         if (Math.random() <= pApp) {
           // Appearance points
           gwScore += (Math.random() < 0.6) ? 2 : 1; // Rough assumption for >60 mins
           
           // Attack points (simulate roughly 4 pts per return)
           const returns = samplePoisson(fp.expectedAttack / 4);
           gwScore += returns * 4;
           
           // Clean sheet
           if (Math.random() <= fp.expectedCsProb) {
             gwScore += fp.csMultiplier;
           }
           
           // Bonus
           const b = samplePoisson(fp.expectedBonus);
           gwScore += b;
         }
      });
      scores[i] = gwScore;
      histogram[gwScore] = (histogram[gwScore] || 0) + 1;
      sum3 += Math.pow(gwScore - mean, 3);
    }

    scores.sort((a, b) => a - b);
    
    // Convert histogram counts to probabilities
    Object.keys(histogram).forEach(k => {
      histogram[Number(k)] = histogram[Number(k)] / iterations;
    });

    const stdDev = Math.sqrt(variance);
    const skewness = (stdDev > 0) ? (sum3 / iterations) / Math.pow(stdDev, 3) : 0;
    
    return {
      mean,
      variance,
      skewness,
      p50: scores[Math.floor(iterations * 0.5)],
      p75: scores[Math.floor(iterations * 0.75)],
      p90: scores[Math.floor(iterations * 0.9)],
      p95: scores[Math.floor(iterations * 0.95)],
      tails: {
        8: scores.filter(s => s >= 8).length / iterations,
        12: scores.filter(s => s >= 12).length / iterations,
        15: scores.filter(s => s >= 15).length / iterations,
        20: scores.filter(s => s >= 20).length / iterations
      },
      histogram
    };
  }
}

export class HistoricalOracle implements XPOracle {
  public playerNames: Record<number, string> = {};
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
  
  private distributionMatrix: Record<number, Record<number, PlayerDistribution>> = {};
  getDistribution(playerId: number, gameweek: number): PlayerDistribution {
    if (!this.distributionMatrix[playerId]) this.distributionMatrix[playerId] = {};
    if (!this.distributionMatrix[playerId][gameweek]) {
      this.distributionMatrix[playerId][gameweek] = this.engine.simulatePlayerDistribution(this.getProjectionInput(playerId), gameweek);
    }
    return this.distributionMatrix[playerId][gameweek];
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
