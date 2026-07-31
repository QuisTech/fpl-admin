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
      // Gather all chronological previous matches up to gameweek - 1
      const allPrevMatches = [];
      for (let prevGw = 1; prevGw < gameweek; prevGw++) {
        const matches = this.gwDataByPlayer[playerId]?.[prevGw] || [];
        matches.forEach(m => allPrevMatches.push(m));
      }

      // Existing rolling stats
      let minutesLast4 = 0;
      let startsLast4 = 0;
      let xGLast4 = 0;
      let xALast4 = 0;
      let shotsLast4 = 0;
      let keyPassesLast4 = 0;
      let xGI3 = 0;
      let xGI5 = 0;

      // New Expected Minutes features
      let minutesLast1 = 0;
      let minutesLast3 = 0;
      let minutesLast5 = 0;
      let startsLast5 = 0;
      let minutesEWMA = 0;
      let minutesVolatility = 0;
      let consecutiveStarts = 0;
      let consecutiveStartsBroken = false;

      const nMatches = allPrevMatches.length;
      
      // Calculate EWMA, Volatility and rolling mins
      if (nMatches > 0) {
        const ewmaWeights = [0.50, 0.25, 0.15, 0.07, 0.03];
        const last5Mins = [];
        
        for (let i = 0; i < 5 && i < nMatches; i++) {
          const m = allPrevMatches[nMatches - 1 - i];
          const mGw = parseInt(m.GW || m.round);
          const mins = parseInt(m.minutes) || 0;
          const xG = parseFloat(m.expected_goals) || 0;
          const xA = parseFloat(m.expected_assists) || 0;

          // Rolling features
          if (i === 0) minutesLast1 += mins;
          if (i < 3) minutesLast3 += mins;
          if (i < 5) minutesLast5 += mins;
          if (i < 5 && mins >= 60) startsLast5 += 1;
          
          if (!consecutiveStartsBroken) {
            if (mins >= 60) {
              consecutiveStarts++;
            } else if (m.minutes !== undefined) { 
              consecutiveStartsBroken = true;
            }
          }
          
          if (gameweek - mGw <= 3) xGI3 += (xG + xA);
          if (gameweek - mGw <= 5) xGI5 += (xG + xA);
          
          // Legacy Last 4
          if (gameweek - mGw <= 4) {
            minutesLast4 += mins;
            if (mins >= 60) startsLast4 += 1;
            xGLast4 += xG;
            xALast4 += xA;
          }
          
          minutesEWMA += mins * ewmaWeights[i];
          last5Mins.push(mins);
        }
        
        // Compute Volatility (Stdev of last up to 5 matches)
        if (last5Mins.length > 0) {
          const mean = last5Mins.reduce((a, b) => a + b, 0) / last5Mins.length;
          const variance = last5Mins.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / last5Mins.length;
          minutesVolatility = Math.sqrt(variance);
        }
      }

      // Calculate minutes trend
      let minutesTrend = 0;

      // Calculate /90 rolling stats (Legacy)
      const gamesPlayed90 = minutesLast4 / 90;
      const xG90 = gamesPlayed90 > 0 ? (xGLast4 / gamesPlayed90) : 0;
      const xA90 = gamesPlayed90 > 0 ? (xALast4 / gamesPlayed90) : 0;
      const shots90 = gamesPlayed90 > 0 ? (shotsLast4 / gamesPlayed90) : 0;
      const keyPasses90 = gamesPlayed90 > 0 ? (keyPassesLast4 / gamesPlayed90) : 0;

      // Parse chance of playing
      let chanceOfPlayingThisRound = parseFloat(raw.chance_of_playing_this_round);
      if (isNaN(chanceOfPlayingThisRound)) {
         chanceOfPlayingThisRound = 100; // Default to 100% if missing/null
      }
      
      // Calculate Season Minutes Percent
      let totalSeasonMins = 0;
      allPrevMatches.forEach(m => totalSeasonMins += (parseInt(m.minutes) || 0));
      let teamMatchesSoFar = 0;
      const teamIdStr = raw.team;
      for (let prevGw = 1; prevGw < gameweek; prevGw++) {
        const gwFixs = this.fixturesByGw[prevGw] || [];
        gwFixs.forEach(fix => {
          if (fix.team_h == teamIdStr || fix.team_a == teamIdStr) {
             teamMatchesSoFar++;
          }
        });
      }
      const seasonMinutesPercent = teamMatchesSoFar > 0 ? (totalSeasonMins / (teamMatchesSoFar * 90)) : 1.0;
      
      // Calculate Rest Hours and Fixture Congestion
      let restHours = 168; // Default to 7 days
      let fixturesLast7Days = 0;
      let fixturesLast14Days = 0;
      
      // We need the kickoff time of the upcoming fixture in this gameweek
      const upcomingGwFixs = this.fixturesByGw[gameweek] || [];
      let upcomingKickoff = null;
      upcomingGwFixs.forEach(fix => {
        if (fix.team_h == teamIdStr || fix.team_a == teamIdStr) {
           if (!upcomingKickoff && fix.kickoff_time) {
             upcomingKickoff = new Date(fix.kickoff_time);
           }
        }
      });
      
      if (upcomingKickoff) {
         const t0 = upcomingKickoff.getTime();
         // Check recent matches
         const recentMatches = [];
         for (let prevGw = 1; prevGw < gameweek; prevGw++) {
           const gwFixs = this.fixturesByGw[prevGw] || [];
           gwFixs.forEach(fix => {
             if ((fix.team_h == teamIdStr || fix.team_a == teamIdStr) && fix.kickoff_time) {
                const tPrev = new Date(fix.kickoff_time).getTime();
                if (tPrev < t0) {
                   recentMatches.push(tPrev);
                }
             }
           });
         }
         
         recentMatches.sort((a,b) => b - a); // descending
         if (recentMatches.length > 0) {
            const lastMatchTime = recentMatches[0];
            restHours = (t0 - lastMatchTime) / (1000 * 60 * 60);
         }
         
         recentMatches.forEach(tPrev => {
            const hoursDiff = (t0 - tPrev) / (1000 * 60 * 60);
            if (hoursDiff <= 7 * 24) fixturesLast7Days++;
            if (hoursDiff <= 14 * 24) fixturesLast14Days++;
         });
      }

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
              opponentStrengthAttack: oppStrengthAttack,
              kickoff_time: fix.kickoff_time
            });
          }
        });
      }

      const selectionMomentum = minutesEWMA - (seasonMinutesPercent * 90);
      
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
        
        minutesLast1,
        minutesLast3,
        minutesLast5,
        minutesEWMA,
        startsLast5,
        seasonMinutesPercent,
        restHours,
        fixturesLast7Days,
        fixturesLast14Days,
        minutesVolatility,
        chanceOfPlayingThisRound,
        selectionMomentum,
        consecutiveStarts,
        
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
