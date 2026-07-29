import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { 
  HistoricalDataProvider, 
  DeadlineSnapshot, 
  HistoricalPlayerFeatures, 
  HistoricalFixture 
} from './historical.js';

export class VaastavProvider implements HistoricalDataProvider {
  private season: string = '';
  private dataDir: string = '';
  
  // Parsed datasets
  private playersRaw: any[] = [];
  private fixtures: any[] = [];
  private mergedGw: any[] = [];
  
  // Quick lookups
  private gwDataByPlayer: Record<number, Record<number, any>> = {}; // playerId -> gw -> data
  private fixturesByGw: Record<number, any[]> = {}; // gw -> fixtures

  async loadSeason(season: string): Promise<void> {
    this.season = season;
    this.dataDir = path.resolve(process.cwd(), 'data', 'vaastav', season);

    console.log(`[VaastavProvider] Loading datasets for ${season}...`);
    
    this.playersRaw = this.loadCsv('players_raw.csv');
    this.fixtures = this.loadCsv('fixtures.csv');
    this.mergedGw = this.loadCsv('merged_gw.csv');

    this.buildLookups();
    console.log(`[VaastavProvider] Successfully loaded ${this.playersRaw.length} players, ${this.fixtures.length} fixtures, ${this.mergedGw.length} GW records.`);
  }

  private loadCsv(filename: string): any[] {
    const filePath = path.join(this.dataDir, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Data file not found: ${filePath}. Please run download-vaastav.ts first.`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const result = Papa.parse(content, { header: true, skipEmptyLines: true });
    return result.data;
  }

  private buildLookups() {
    // Group GW data by player and GW
    this.mergedGw.forEach(row => {
      const playerId = parseInt(row.element || row.id); 
      // 'GW' or 'round' indicates the gameweek
      const gw = parseInt(row.GW || row.round);
      
      if (!isNaN(playerId) && !isNaN(gw)) {
        if (!this.gwDataByPlayer[playerId]) this.gwDataByPlayer[playerId] = {};
        // Note: A player might have a double gameweek. merged_gw.csv has two rows for the same GW.
        // We will store an array of matches for the GW.
        if (!this.gwDataByPlayer[playerId][gw]) this.gwDataByPlayer[playerId][gw] = [];
        this.gwDataByPlayer[playerId][gw].push(row);
      }
    });

    // Group fixtures by event (GW)
    this.fixtures.forEach(fixture => {
      const gw = parseInt(fixture.event);
      if (!isNaN(gw)) {
        if (!this.fixturesByGw[gw]) this.fixturesByGw[gw] = [];
        this.fixturesByGw[gw].push(fixture);
      }
    });
  }

  getDeadlineSnapshot(
    gameweek: number, 
    currentBank: number, 
    currentFTs: number, 
    chips: Record<string, number>
  ): DeadlineSnapshot {
    const snapshot: DeadlineSnapshot = {
      gameweek,
      bank: currentBank,
      freeTransfers: currentFTs,
      chipAvailability: chips,
      players: {}
    };

    // Reconstruct the universe for this Gameweek.
    // To ensure ZERO look-ahead bias, we only look at GW N for price/fixtures, 
    // and GW 1 to (N-1) for observable features (minutes played, xG, xA).

    this.playersRaw.forEach(raw => {
      const playerId = parseInt(raw.id);
      if (isNaN(playerId)) return;
      
      // We need the player's price at the exact deadline of this GW.
      const gwRecords = this.gwDataByPlayer[playerId]?.[gameweek] || [];
      let currentPrice = 0;
      
      if (gwRecords.length > 0) {
        currentPrice = parseFloat(gwRecords[0].value) / 10;
      } else {
        // Look backwards for the most recent price
        for (let prevGw = gameweek - 1; prevGw > 0; prevGw--) {
          const prevRecords = this.gwDataByPlayer[playerId]?.[prevGw];
          if (prevRecords && prevRecords.length > 0) {
            currentPrice = parseFloat(prevRecords[0].value) / 10;
            break;
          }
        }
        // If still 0 (e.g. they haven't appeared yet), look forward but NEVER beyond their first appearance
        if (currentPrice === 0) {
           for (let nextGw = gameweek + 1; nextGw <= 38; nextGw++) {
             const nextRecords = this.gwDataByPlayer[playerId]?.[nextGw];
             if (nextRecords && nextRecords.length > 0) {
                currentPrice = parseFloat(nextRecords[0].value) / 10;
                break;
             }
           }
        }
      }

      // Calculate Last 4 GW features (Look-back)
      let minutesLast4 = 0;
      let startsLast4 = 0;
      let xGLast4 = 0;
      let xALast4 = 0;
      let shotsLast4 = 0;
      let keyPassesLast4 = 0;
      
      let matchesCounted = 0;
      for (let prevGw = gameweek - 1; prevGw >= Math.max(1, gameweek - 4); prevGw--) {
        const matches = this.gwDataByPlayer[playerId]?.[prevGw] || [];
        matches.forEach(match => {
          const mins = parseInt(match.minutes) || 0;
          minutesLast4 += mins;
          if (mins >= 60) startsLast4 += 1; 
          xGLast4 += parseFloat(match.expected_goals) || 0;
          xALast4 += parseFloat(match.expected_assists) || 0;
          matchesCounted++;
        });
      }

      // Calculate /90 rolling stats
      const gamesPlayed90 = minutesLast4 / 90;
      const xG90 = gamesPlayed90 > 0 ? (xGLast4 / gamesPlayed90) : 0;
      const xA90 = gamesPlayed90 > 0 ? (xALast4 / gamesPlayed90) : 0;
      const shots90 = gamesPlayed90 > 0 ? (shotsLast4 / gamesPlayed90) : 0;
      const keyPasses90 = gamesPlayed90 > 0 ? (keyPassesLast4 / gamesPlayed90) : 0;

      // Determine upcoming fixtures
      const teamId = parseInt(raw.team);
      const upcomingFixtures: HistoricalFixture[] = [];
      const gwFixtures = this.fixturesByGw[gameweek] || [];
      
      gwFixtures.forEach(fix => {
        const homeId = parseInt(fix.team_h);
        const awayId = parseInt(fix.team_a);
        if (homeId === teamId || awayId === teamId) {
          const isHome = homeId === teamId;
          upcomingFixtures.push({
            opponentTeamId: isHome ? awayId : homeId,
            isHome,
            difficulty: isHome ? parseInt(fix.team_h_difficulty) : parseInt(fix.team_a_difficulty),
            // We can enrich these opponent strengths later from team standings
            opponentStrengthDefense: 3, 
            opponentStrengthAttack: 3
          });
        }
      });

      const position = raw.element_type === '1' ? 'GKP' : 
                       raw.element_type === '2' ? 'DEF' : 
                       raw.element_type === '3' ? 'MID' : 'FWD';

      snapshot.players[playerId] = {
        id: playerId,
        name: `${raw.first_name} ${raw.second_name}`,
        position,
        teamId,
        price: currentPrice,
        minutesLast4,
        startsLast4,
        xGLast4,
        xALast4,
        shotsLast4,
        keyPassesLast4,
        xG90,
        xA90,
        shots90,
        keyPasses90,
        fixtures: upcomingFixtures,
        predictedMinutes: 0, // Computed later by Projection Layer
        injuryStatus: null,
        eo: 0 
      };
    });

    return snapshot;
  }

  getActualPoints(playerId: number, gameweek: number): number {
    const records = this.gwDataByPlayer[playerId]?.[gameweek] || [];
    let total = 0;
    records.forEach(r => {
      total += parseInt(r.total_points) || 0;
    });
    return total;
  }
}
