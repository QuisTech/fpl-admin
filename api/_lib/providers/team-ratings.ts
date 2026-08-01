import { FeatureStoreRepository, TeamFeatures } from './feature-store.js';

export class TeamRatingService {
  private repository: FeatureStoreRepository;

  constructor(repository?: FeatureStoreRepository) {
    this.repository = repository || new FeatureStoreRepository();
  }

  /**
   * Build the entire gameweek-by-gameweek feature history for a given season.
   * This is called by the training pipeline (VaastavProvider) or data ingestion pipeline.
   */
  public buildRatings(
    season: string,
    playersRaw: any[],
    mergedGw: any[],
    fixturesByGw: Record<number, any[]>
  ) {
    console.log(`[TeamRatingService] Building latent features for season ${season}...`);
    
    // Initialize teams at GW 0
    const teamToId: Record<string, number> = {};
    const playerToTeam: Record<number, number> = {};
    
    playersRaw.forEach(p => {
       const tid = parseInt(p.team);
       const pid = parseInt(p.id);
       if (!isNaN(tid)) {
           playerToTeam[pid] = tid;
           
           // Seed GW 0 with baseline and low confidence
           this.repository.setFeatures(season, 0, tid, { attack: 1.5, defense: 1.5, confidence: 0.1 });
       }
    });

    // Pre-calculate Team xG per Gameweek
    const gwTeamXg: Record<number, Record<number, number>> = {}; 
    const maxGw = Math.max(...Object.keys(fixturesByGw).map(Number), 0);
    
    for (let gw = 1; gw <= maxGw; gw++) {
        gwTeamXg[gw] = {};
    }
    
    mergedGw.forEach(row => {
        const gw = parseInt(row.GW || row.round);
        if (gw > 0 && gw <= maxGw) {
            const pid = parseInt(row.element || row.id);
            const tid = playerToTeam[pid];
            if (tid) {
                let xg = parseFloat(row.expected_goals || row.xG);
                if (isNaN(xg)) {
                   xg = (row.position === 'FWD' || row.position === 'MID' || row.position === 'DEF') ? (parseFloat(row.goals_scored || "0") * 0.8) : 0;
                }
                gwTeamXg[gw][tid] = (gwTeamXg[gw][tid] || 0) + xg;
            }
        }
    });

    // Track active state to carry forward
    const currentRatings: Record<number, TeamFeatures> = {};
    playersRaw.forEach(p => {
       const tid = parseInt(p.team);
       if (!isNaN(tid)) {
           currentRatings[tid] = { attack: 1.5, defense: 1.5, confidence: 0.1 };
       }
    });

    // Chronologically process gameweeks
    for (let gw = 1; gw <= maxGw; gw++) {
      const alpha = gw < 10 ? 0.20 : 0.10; // Adaptive EWMA
      const gwFixs = fixturesByGw[gw] || [];
      
      // Update confidence as season progresses (maxes out around 0.95 after 15 games)
      const confidence = Math.min(0.95, 0.1 + (gw * 0.05));

      gwFixs.forEach(fix => {
          const homeId = parseInt(fix.team_h);
          const awayId = parseInt(fix.team_a);
          
          if (currentRatings[homeId] && currentRatings[awayId]) {
              const homeXg = gwTeamXg[gw][homeId] || 0;
              const awayXg = gwTeamXg[gw][awayId] || 0;

              // Update ratings
              currentRatings[homeId].attack = (1 - alpha) * currentRatings[homeId].attack + alpha * homeXg;
              currentRatings[homeId].defense = (1 - alpha) * currentRatings[homeId].defense + alpha * awayXg;

              currentRatings[awayId].attack = (1 - alpha) * currentRatings[awayId].attack + alpha * awayXg;
              currentRatings[awayId].defense = (1 - alpha) * currentRatings[awayId].defense + alpha * homeXg;
          }
      });

      // Save the state at the end of this gameweek to the repository
      for (const tid in currentRatings) {
         this.repository.setFeatures(season, gw, parseInt(tid), {
           attack: currentRatings[tid].attack,
           defense: currentRatings[tid].defense,
           confidence
         });
      }
    }
  }

  public getRating(season: string, gameweek: number, teamId: number): TeamFeatures {
    return this.repository.getFeatures(season, gameweek, teamId);
  }

  public save() {
    this.repository.save();
  }
}
