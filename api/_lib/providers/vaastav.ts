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
  public supportsHistoricalAnnouncements = false;
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

    // Store gameweek reference for projection use
    (snapshot as any).gameweek = gameweek;

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
        // If still 0, we gracefully accept 0 as they haven't appeared yet. We do not look forward.
      }

      // Calculate Last 4 GW features (Look-back) and new metrics
      let minutesLast4 = 0;
      let startsLast4 = 0;
      let xGLast4 = 0;
      let xALast4 = 0;
      let shotsLast4 = 0;
      let keyPassesLast4 = 0;
      
      let xGI3 = 0;
      let xGI5 = 0;
      let minsLast3 = [];
      
      let matchesCounted = 0;
      for (let prevGw = gameweek - 1; prevGw >= Math.max(1, gameweek - 5); prevGw--) {
        const matches = this.gwDataByPlayer[playerId]?.[prevGw] || [];
        matches.forEach(match => {
          const mins = parseInt(match.minutes) || 0;
          const xG = parseFloat(match.expected_goals) || 0;
          const xA = parseFloat(match.expected_assists) || 0;
          
          if (gameweek - prevGw <= 4) {
            minutesLast4 += mins;
            if (mins >= 60) startsLast4 += 1; 
            xGLast4 += xG;
            xALast4 += xA;
            matchesCounted++;
          }
          
          if (gameweek - prevGw <= 3) {
            xGI3 += (xG + xA);
            minsLast3.push(mins);
          }
          
          if (gameweek - prevGw <= 5) {
            xGI5 += (xG + xA);
          }
        });
      }

      // Calculate minutes trend (e.g., average change between consecutive games)
      let minutesTrend = 0;
      if (minsLast3.length >= 2) {
        // Reverse because we pushed from newest to oldest
        minsLast3.reverse(); 
        const changes = [];
        for (let i = 1; i < minsLast3.length; i++) {
          changes.push(minsLast3[i] - minsLast3[i-1]);
        }
        minutesTrend = changes.reduce((a, b) => a + b, 0) / changes.length;
      }

      // Calculate /90 rolling stats
      const gamesPlayed90 = minutesLast4 / 90;
      const xG90 = gamesPlayed90 > 0 ? (xGLast4 / gamesPlayed90) : 0;
      const xA90 = gamesPlayed90 > 0 ? (xALast4 / gamesPlayed90) : 0;
      const shots90 = gamesPlayed90 > 0 ? (shotsLast4 / gamesPlayed90) : 0;
      const keyPasses90 = gamesPlayed90 > 0 ? (keyPassesLast4 / gamesPlayed90) : 0;

      // Determine upcoming fixtures for 8-week horizon
      const teamId = parseInt(raw.team);
      const fixturesByGw: Record<number, HistoricalFixture[]> = {};
      
      // Compute team strengths based on historical matches before this GW
      // We will look at all matches up to gameweek - 1 to compute xG, xGC
      let teamG = 0, teamxG = 0, teamGA = 0, teamxGA = 0, teamMatches = 0;
      for (let prevGw = 1; prevGw < gameweek; prevGw++) {
        const gwFixs = this.fixturesByGw[prevGw] || [];
        gwFixs.forEach(fix => {
          if (parseInt(fix.team_h) === teamId || parseInt(fix.team_a) === teamId) {
            teamMatches++;
            if (parseInt(fix.team_h) === teamId) {
              teamG += parseInt(fix.team_h_score) || 0;
              teamGA += parseInt(fix.team_a_score) || 0;
            } else {
              teamG += parseInt(fix.team_a_score) || 0;
              teamGA += parseInt(fix.team_h_score) || 0;
            }
          }
        });
      }
      
      const teamStrengthAttack = teamMatches > 0 ? (teamG / teamMatches) : 1.5;
      const teamStrengthDefense = teamMatches > 0 ? (teamGA / teamMatches) : 1.5;

      for (let horizonGw = gameweek; horizonGw < gameweek + 8; horizonGw++) {
        fixturesByGw[horizonGw] = [];
        const gwFixtures = this.fixturesByGw[horizonGw] || [];
        
        gwFixtures.forEach(fix => {
          const homeId = parseInt(fix.team_h);
          const awayId = parseInt(fix.team_a);
          if (homeId === teamId || awayId === teamId) {
            const isHome = homeId === teamId;
            
            // For opponents, calculate their rolling GA to act as our attack multiplier
            const oppId = isHome ? awayId : homeId;
            let oppG = 0, oppGA = 0, oppMatches = 0;
            for (let prevGw = 1; prevGw < gameweek; prevGw++) {
              const oppGwFixs = this.fixturesByGw[prevGw] || [];
              oppGwFixs.forEach(ofix => {
                if (parseInt(ofix.team_h) === oppId || parseInt(ofix.team_a) === oppId) {
                  oppMatches++;
                  if (parseInt(ofix.team_h) === oppId) {
                    oppG += parseInt(ofix.team_h_score) || 0;
                    oppGA += parseInt(ofix.team_a_score) || 0;
                  } else {
                    oppG += parseInt(ofix.team_a_score) || 0;
                    oppGA += parseInt(ofix.team_h_score) || 0;
                  }
                }
              });
            }
            
            const oppStrengthAttack = oppMatches > 0 ? (oppG / oppMatches) : 1.5;
            const oppStrengthDefense = oppMatches > 0 ? (oppGA / oppMatches) : 1.5;
            
            fixturesByGw[horizonGw].push({
              opponentTeamId: oppId,
              isHome,
              difficulty: isHome ? parseInt(fix.team_h_difficulty) : parseInt(fix.team_a_difficulty),
              opponentStrengthDefense: oppStrengthDefense, 
              opponentStrengthAttack: oppStrengthAttack
            });
          }
        });
      }

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
        xGI3,
        xGI5,
        minutesTrend,
        shots90,
        keyPasses90,
        fixturesByGw,
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

  getSeasonToDateAverage(playerId: number, currentGw: number): number {
    let totalPoints = 0;
    let gamesPlayed = 0;
    
    for (let gw = 1; gw < currentGw; gw++) {
      const records = this.gwDataByPlayer[playerId]?.[gw] || [];
      if (records.length > 0) {
        records.forEach(r => {
          totalPoints += parseInt(r.total_points) || 0;
        });
        gamesPlayed += records.length;
      }
    }
    
    return gamesPlayed > 0 ? totalPoints / gamesPlayed : 0;
  }
}
