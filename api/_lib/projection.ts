import { DeadlineSnapshot } from './providers/historical.js';
import { XPOracle } from './ingestion.js';

export interface UtilityParameters {
  xpWeight: number;
  xG90Weight: number;
  xA90Weight: number;
  minutesWeight: number;
  fixtureWeight: number;
  eoWeight: number;
  varianceLambda: number;
  valueWeight: number;
}

export const DEFAULT_PARAMETERS: UtilityParameters = {
  xpWeight: 1.0,
  xG90Weight: 0.0,
  xA90Weight: 0.0,
  minutesWeight: 0.0,
  fixtureWeight: 0.0,
  eoWeight: 0.0,
  varianceLambda: 0.05,
  valueWeight: 0.0
};

export class ProjectionEngine {
  private snapshot: DeadlineSnapshot;
  private params: UtilityParameters;

  constructor(snapshot: DeadlineSnapshot, params: UtilityParameters = DEFAULT_PARAMETERS) {
    this.snapshot = snapshot;
    this.params = params;
  }

  /**
   * Generates an XPOracle that the LP Solver and Simulator can use.
   * This oracle projects future gameweeks using ONLY the data frozen in the DeadlineSnapshot.
   */
  public getOracle(): XPOracle {
    const { players, gameweek: currentGw } = this.snapshot;
    
    return {
      getXP: (playerId: number, targetGw: number) => {
        const player = players[playerId];
        if (!player) return 0;
        
        // This is a placeholder for a true predictive model.
        // For now, it heavily weights recent form and fixture difficulty.
        
        let projectedXP = 0;
        
        // Example logic:
        // We look at the player's fixtures for the targetGw.
        // Note: The DeadlineSnapshot only contains fixtures for the CURRENT gameweek.
        // Wait, to project forward 8 weeks, the snapshot needs the fixture schedule for future weeks too!
        // We will assume for now that if targetGw > currentGw, we return a baseline xP.
        // (In a real implementation, the Snapshot should contain the known schedule for the rest of the season).
        
        const isCurrentGw = targetGw === currentGw;
        const fixtures = isCurrentGw ? player.fixtures : [];
        const numFixtures = fixtures.length;
        
        if (numFixtures === 0 && isCurrentGw) {
          return 0; // Blank Gameweek
        }

        // Base projection based on parameterized weights
        const xGI90 = player.xG90 + player.xA90;
        let baseExpectedPts = player.position === 'DEF' || player.position === 'GKP' ? 2 : 1; 
        
        // Example parameterized calculation
        baseExpectedPts += (player.xG90 * this.params.xG90Weight);
        baseExpectedPts += (player.xA90 * this.params.xA90Weight);
        
        if (player.minutesLast4 < 90) {
          baseExpectedPts *= 0.5; // High rotation risk
        }

        // Apply global xpWeight (can scale the whole projection)
        baseExpectedPts *= this.params.xpWeight;

        // Multiply by number of fixtures (Double Gameweeks)
        projectedXP = baseExpectedPts * Math.max(1, numFixtures);
        
        return projectedXP;
      },
      
      getVariance: (playerId: number, targetGw: number) => {
        const player = players[playerId];
        if (!player) return 0;
        const xGI90 = player.xG90 + player.xA90;
        // The variance itself is not modified by the lambda here. Lambda is applied in utility.ts
        // But we can return a baseline variance that the simulator uses.
        return (xGI90 * 10) + 2; 
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
