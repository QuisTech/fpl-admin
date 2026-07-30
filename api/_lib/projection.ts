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
}

export const DEFAULT_PARAMETERS: UtilityParameters = {
  betaMinutesBase: 0.8,
  betaMinutesTrend: 0.1,

  betaAttackBase: 0.5,
  betaXG: 1.5,
  betaXA: 1.0,
  betaXGI3: 0.2,
  betaXGI5: 0.1,
  betaAttFixture: -0.1,
  betaTeamAttack: 0.5,
  betaOppDefense: -0.5,
  betaAttHome: 0.2,

  betaCsBase: 0.2,
  betaTeamDefense: 0.6,
  betaOppAttack: -0.6,
  betaCsFixture: -0.1,
  betaCsHome: 0.3,

  betaBonusBase: 0.0,
  betaBpsBaseline: 0.5,

  betaVariance: 0.05,
  betaEO: 0.0
};

export function getParamsForRiskMode(riskMode: string): UtilityParameters {
  const params = { ...DEFAULT_PARAMETERS };
  if (riskMode === 'aggressive') {
    params.betaVariance = 0.02;
    params.betaEO = -0.5;
  } else if (riskMode === 'safe') {
    params.betaVariance = 0.15;
    params.betaEO = 0.5;
    params.minEoTotal = 150;
    params.minElitePlayers = 1;
  } else if (riskMode === 'value') {
    params.betaVariance = 0.05;
    params.betaEO = 0.0;
    // Value mode constraints? Maybe none, just different beta
  } else {
    params.betaVariance = 0.05;
    params.betaEO = 0.0;
  }
  return params;
}

export class ProjectionEngine {
  private snapshot: DeadlineSnapshot;
  private params: UtilityParameters;

  constructor(snapshot: DeadlineSnapshot, params: UtilityParameters = DEFAULT_PARAMETERS) {
    this.snapshot = snapshot;
    this.params = params;
  }

  /**
   * Data-driven generic predictor for Expected Points (XP) and Variance
   */
  public getDistribution(playerId: number, targetGw: number): { expected: number, variance: number } {
    const player = this.snapshot.players[playerId];
    if (!player) return { expected: 0, variance: 0 };
    
    const fixtures = player.fixturesByGw[targetGw] || [];
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

  public predict(playerId: number, targetGw: number): number {
    return this.getDistribution(playerId, targetGw).expected;
  }

  public getOracle(): XPOracle {
    const { players } = this.snapshot;
    
    return {
      getXP: (playerId: number, targetGw: number) => {
        return this.predict(playerId, targetGw);
      },
      
      getVariance: (playerId: number, targetGw: number) => {
        return this.getDistribution(playerId, targetGw).variance;
      },
      
      getCost: (playerId: number) => {
        const player = players[playerId];
        return player ? Math.round(player.price * 10) : 0;
      },

      getPosition: (playerId: number) => {
        return players[playerId]?.position || 'MID';
      },

      getTeam: (playerId: number) => {
        return (players[playerId]?.teamId || 0).toString();
      },

      getAllPlayerIds: () => {
        return Object.keys(players).map(id => parseInt(id));
      },

      getPriceDelta: () => 0,

      getTop1kEO: (playerId: number) => {
        return players[playerId]?.eo || 0;
      }
    };
  }
}

