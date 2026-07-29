export interface HistoricalFixture {
  opponentTeamId: number;
  isHome: boolean;
  difficulty: number;
  opponentStrengthDefense: number;
  opponentStrengthAttack: number;
}

export interface HistoricalPlayerFeatures {
  id: number;
  name: string;
  position: string; // 'GKP', 'DEF', 'MID', 'FWD'
  teamId: number;
  
  // Observables BEFORE the deadline
  price: number; // Cost in millions (e.g. 12.5)
  minutesLast4: number;
  startsLast4: number;
  xGLast4: number;
  xALast4: number;
  shotsLast4: number;
  keyPassesLast4: number;
  
  // Rolling Form (/90)
  xG90: number;
  xA90: number;
  shots90: number;
  keyPasses90: number;
  
  // Fixture(s) in this gameweek (handles Blanks and Doubles)
  fixtures: HistoricalFixture[];
  
  // Inferred or provided availability
  predictedMinutes: number; 
  injuryStatus: string | null;
  eo: number; // If we can reconstruct it
}

export interface DeadlineSnapshot {
  gameweek: number;
  players: Record<number, HistoricalPlayerFeatures>;
  bank: number;
  freeTransfers: number;
  chipAvailability: Record<string, number>;
}

export interface HistoricalDataProvider {
  /**
   * Load a specific season's data into memory.
   */
  loadSeason(season: string): Promise<void>;

  /**
   * Freeze the universe exactly before the deadline.
   * Returns pristine observables with absolutely zero look-ahead bias.
   */
  getDeadlineSnapshot(
    gameweek: number, 
    currentBank: number, 
    currentFTs: number, 
    chips: Record<string, number>
  ): DeadlineSnapshot;

  /**
   * Used strictly for post-deadline evaluation (The Ground Truth).
   */
  getActualPoints(playerId: number, gameweek: number): number;
}
