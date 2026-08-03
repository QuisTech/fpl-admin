import fs from 'fs';
import path from 'path';
import { ProjectionEngine, ProjectionInput } from './projection.js';
import { loadWeights } from './weights-loader.js';
import { HistoricalPlayerFeatures, HistoricalFixture } from './providers/historical.js';
import { FeatureStoreRepository } from './providers/feature-store.js';

const SHORT_REST_ROTATION_PENALTY = 0.90;
const DGW_ROTATION_PENALTY = 0.85;

export interface XPOracle {
  getXP(playerId: number, gameweek: number): number;
  getVariance(playerId: number, gameweek: number): number;
  getPriceDelta(playerId: number): number;
  getPosition(playerId: number): string;
  getCost(playerId: number): number;
  getTeam(playerId: number): string;
  getAllPlayerIds(): number[];
  getTop1kEO?(playerId: number): number;
  getTop1kOwnership?(playerId: number): number;
}

/**
 * Real Oracle that reads the expected points matrix from the scraped FPLForm CSV.
 */
export class CSVOracle implements XPOracle {
  private xpMatrix: Record<number, Record<number, number>> = {};
  public playerNames: Record<number, string> = {}; // Helper for debugging output
  private playerPositions: Record<number, string> = {};
  private playerCosts: Record<number, number> = {};
  private playerTeams: Record<number, string> = {};
  private allIds: number[] = [];
  private top1kData: Record<number, { ownership: number; started: number; eo: number; captain: number; tripleCaptain: number }> = {};
  private fuel: string = 'fplform';
  
  private featuresMatrix: Record<number, HistoricalPlayerFeatures> = {};
  private projectionEngine: ProjectionEngine;

  constructor(
    filePath: string, 
    players: any[] = [], 
    riskMode: string = 'safe',
    fixtures: any[] = [], 
    teams: any[] = [], 
    nextEventId: number = 1,
    fuel: string = 'fplform',
    fixturesFilePath?: string
  ) {
    this.fuel = fuel;
    const weights = loadWeights('baseline');
    this.projectionEngine = new ProjectionEngine(weights);
    this.loadTop1kData(players);
    this.loadData(filePath, players, fixtures, teams, nextEventId, riskMode, fuel, fixturesFilePath);
  }

  private loadTop1kData(players: any[] = []) {
    const jsonPath = path.resolve(process.cwd(), 'data', 'top_1000_eo.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.players) {
          Object.keys(parsed.players).forEach(pId => {
            const data = parsed.players[pId];
            let fplId = parseInt(pId);
            
            if (players.length > 0 && data.name) {
              const pName = data.name.toLowerCase();
              const match = players.find(p => {
                const wName = (p.web_name || '').toLowerCase();
                const sName = (p.second_name || '').toLowerCase();
                return wName === pName || sName === pName || 
                       (wName.length > 2 && pName.includes(wName)) || 
                       (sName.length > 2 && pName.includes(sName));
              });
              if (match) {
                fplId = match.id;
              }
            }
            this.top1kData[fplId] = data;
          });
          console.log(`[CSVOracle] Loaded Top 1,000 sentiment data for ${Object.keys(this.top1kData).length} players.`);
        }
      } catch (err: any) {
        console.warn(`[CSVOracle] Failed to parse Top 1,000 EO data: ${err.message}`);
      }
    } else {
      console.log('[CSVOracle] No Top 1,000 EO data found. Defaulting to standard metadata.');
    }
  }

  getTop1kEO(playerId: number): number {
    return this.top1kData[playerId]?.eo ?? 0;
  }

  getTop1kOwnership(playerId: number): number {
    return this.top1kData[playerId]?.ownership ?? 0;
  }

  private loadData(
    filePath: string, 
    players: any[], 
    fixtures: any[], 
    teams: any[], 
    nextEventId: number, 
    riskMode: string,
    fuel: string = 'fplform',
    fixturesFilePath?: string
  ) {
    // For eye-test fuel, load fixtures from the provided JSON file
    console.log(`[CSVOracle] Fuel: ${fuel}, fixturesFilePath: ${fixturesFilePath}`);
    if (fuel === 'eye-test' && fixturesFilePath) {
      const fixturesFullPath = path.resolve(process.cwd(), fixturesFilePath);
      console.log(`[CSVOracle] Fixtures full path: ${fixturesFullPath}, exists: ${fs.existsSync(fixturesFullPath)}`);
      if (fs.existsSync(fixturesFullPath)) {
        try {
          const fixturesContent = fs.readFileSync(fixturesFullPath, 'utf-8');
          fixtures = JSON.parse(fixturesContent);
          console.log(`[CSVOracle] Loaded ${fixtures.length} fixtures from ${fixturesFilePath}`);
        } catch (err: any) {
          console.warn(`[CSVOracle] Failed to load fixtures from ${fixturesFilePath}: ${err.message}`);
        }
      } else {
        console.warn(`[CSVOracle] Fixtures file not found at ${fixturesFullPath}`);
      }
    }

    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[CSVOracle] Data file not found at ${fullPath}`);
      return;
    }

    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const lines = fileContent.split('\n');

    let syntheticId = 100000; // Increased to 100000 to prevent collisions with future FPL API IDs

    const teamMap: Record<string, number> = {};
    const liveTeamRatings: Record<number, { attack: number, defense: number }> = {};
    const featureStore = new FeatureStoreRepository();
    
    // Hardcoded team short name to ID mapping for 2026-27
    const shortNameToId: Record<string, number> = {
      'ars': 1, 'avl': 2, 'bou': 3, 'bre': 4, 'bha': 5, 'che': 6, 'cry': 7, 'eve': 8, 'ful': 9, 'ips': 10,
      'lei': 11, 'liv': 12, 'mci': 13, 'mun': 14, 'nfo': 15, 'sou': 16, 'tot': 17, 'whu': 18, 'wol': 19, 'new': 20
    };
    
    // For eye-test mode with no live teams, build team map from fixtures
    if (fuel === 'eye-test' && (!teams || teams.length === 0) && fixtures.length > 0) {
      // Extract unique teams from fixtures and assign synthetic IDs
      const uniqueTeams = new Set<number>();
      fixtures.forEach(f => {
        uniqueTeams.add(f.team_h);
        uniqueTeams.add(f.team_a);
      });
      
      // Use 2026-27 season for future fixture data
      const futureSeason = '2026-27';
      uniqueTeams.forEach(teamId => {
        teamMap[teamId.toString()] = teamId; // Use actual team IDs from fixtures
        // Get projected ratings from Feature Store for 2026-27
        const features = featureStore.getFeatures(futureSeason, 1, teamId);
        liveTeamRatings[teamId] = { 
           attack: features.attack, 
           defense: features.defense 
        };
      });
      console.log(`[CSVOracle] Built team map from ${uniqueTeams.size} teams in fixtures using ${futureSeason} ratings`);
    } else if (teams && teams.length > 0) {
      const currentSeason = '2023-24';
      const previousGw = nextEventId > 1 ? nextEventId - 1 : 38;

      teams.forEach(t => {
        teamMap[t.short_name.toLowerCase()] = t.id;
        
        const features = featureStore.getFeatures(currentSeason, previousGw, t.id);
        
        liveTeamRatings[t.id] = { 
           attack: features.attack, 
           defense: features.defense 
        };
      });
    }
    
    // For eye-test mode with CSV using short names, map to numeric IDs
    if (fuel === 'eye-test' && (!teams || teams.length === 0)) {
      Object.keys(shortNameToId).forEach(shortName => {
        teamMap[shortName] = shortNameToId[shortName];
      });
      console.log('[CSVOracle] Added hardcoded team name to ID mapping for eye-test mode');
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      let cols: string[] = [];
      try {
        let inQuotes = false;
        let current = '';
        for (let j = 0; j < line.length; j++) {
          const char = line[j];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            cols.push(current);
            current = '';
          } else {
            current += char;
          }
        }
        cols.push(current);
        cols = cols.map(c => c.trim().replace(/^"|"$/g, ''));
      } catch (err: any) {
        console.error(`[CSVOracle] Parsing failed at line ${i}: "${line}"`);
        throw err;
      }
      
      if (cols.length >= 9 && cols[3]) {
        const playerName = cols[1];
        const team = cols[3];
        const pos = cols[4] === 'GK' ? 'GKP' : cols[4];
        let cost = parseFloat(cols[5]) * 10; 
        const meritScore = parseFloat(cols[6]) || 0; 
        
        // Handle both short name (3 chars) and numeric team ID from fixtures
        let parsedTeamId = 0;
        if (team.length === 3) {
          parsedTeamId = teamMap[team.toLowerCase()] || 0;
        } else {
          // Try to parse as numeric team ID directly
          parsedTeamId = parseInt(team) || 0;
          if (parsedTeamId > 0 && !liveTeamRatings[parsedTeamId]) {
            liveTeamRatings[parsedTeamId] = { attack: 1.5, defense: 1.5 };
          }
        }
        
        const expectedElementType = pos === 'GKP' ? 1 : pos === 'DEF' ? 2 : pos === 'MID' ? 3 : pos === 'FWD' ? 4 : 0;

        let fplId = syntheticId++; 
        let rawOwnership = 100.0;
        let realTeamId = parsedTeamId;
        let matchedPlayer: any = null;

        if (players.length > 0) {
          let match = players.find(p => {
            // For eye-test mode, be more lenient with team matching since CSV may have different team assignments
            if (fuel !== 'eye-test' && parsedTeamId > 0 && p.team !== parsedTeamId) return false;
            if (expectedElementType > 0 && p.element_type !== expectedElementType) return false;

            const wName = (p.web_name || '').toLowerCase();
            const sName = (p.second_name || '').toLowerCase();
            const pName = playerName.toLowerCase();

            // Require string length > 2 for substring matches to prevent single-letter/empty matches
            const wMatch = wName === pName || (wName.length > 2 && pName.includes(wName));
            const sMatch = sName === pName || (sName.length > 2 && pName.includes(sName));

            return wMatch || sMatch;
          });

          if (match) {
            fplId = match.id;
            rawOwnership = parseFloat(match.selected_by_percent) || 100.0;
            // For eye-test mode, use the team ID from fixtures/CSV, not live FPL API
            realTeamId = fuel === 'eye-test' ? parsedTeamId : match.team;
            cost = match.now_cost; // OVERWRITE CSV COST WITH LIVE FPL PRICE
            matchedPlayer = match;
          }
        }
        
        // For eye-test mode, prioritize the CSV team ID over live FPL API team ID
        const teamId = fuel === 'eye-test' ? (parsedTeamId || realTeamId || 0) : (realTeamId || parsedTeamId || 0);

        let probPlay = parseFloat(cols[8]);
        if (isNaN(probPlay)) {
          let chance = 100;
          if (players.length > 0) {
            const match = players.find(p => 
              p.web_name?.toLowerCase() === playerName.toLowerCase() ||
              p.second_name?.toLowerCase().includes(playerName.toLowerCase()) ||
              playerName.toLowerCase().includes(p.second_name?.toLowerCase()) ||
              playerName.toLowerCase().includes(p.web_name?.toLowerCase())
            );
            if (match) {
              chance = match.chance_of_playing_next_round ?? 100;
            }
          }
          probPlay = chance / 100;
        }
        probPlay = Math.max(0, Math.min(1.0, probPlay));

        const gamesPlayed = matchedPlayer ? Math.max(3.0, (matchedPlayer.minutes || 0) / 90) : 0;
        let xG90 = matchedPlayer && gamesPlayed > 0 ? (parseFloat(matchedPlayer.expected_goals || "0") / gamesPlayed) : 0;
        let xA90 = matchedPlayer && gamesPlayed > 0 ? (parseFloat(matchedPlayer.expected_assists || "0") / gamesPlayed) : 0;
        
        // Cap absurdly high xG90/xA90 caused by low minutes / small sample sizes in the live FPL API
        xG90 = Math.min(1.0, xG90);
        xA90 = Math.min(0.7, xA90);
        
        // Build Fixtures
        const fixturesByGw: Record<number, HistoricalFixture[]> = {};
        for (let step = 0; step < 15; step++) {
          const gw = nextEventId + step;
          // For eye-test mode, use fixtures loaded from JSON file without requiring live teams
          if (fixtures && fixtures.length > 0 && teamId > 0 && (fuel === 'eye-test' || (teams && teams.length > 0))) {
            const teamFixtures = fixtures.filter(f => f.event === gw && (f.team_h === teamId || f.team_a === teamId));
            fixturesByGw[gw] = teamFixtures.map(f => {
               const isHome = f.team_h === teamId;
               const oppId = isHome ? f.team_a : f.team_h;
               const oppRatings = liveTeamRatings[oppId] || { attack: 1.5, defense: 1.5 };
               const teamRatings = liveTeamRatings[teamId] || { attack: 1.5, defense: 1.5 };
               
               return {
                  opponentTeamId: oppId,
                  isHome,
                  difficulty: isHome ? f.team_h_difficulty : f.team_a_difficulty,
                  opponentAttackRating: oppRatings.attack,
                  opponentDefenseRating: oppRatings.defense,
                  teamAttackRating: teamRatings.attack,
                  teamDefenseRating: teamRatings.defense
               };
            });
          } else {
             fixturesByGw[gw] = [];
          }
        }

        this.featuresMatrix[fplId] = {
          id: fplId,
          name: playerName,
          position: pos === 'GK' ? 'GKP' : pos,
          teamId,
          price: cost / 10,
          minutesLast4: probPlay * 90 * 4,
          startsLast4: probPlay * 4,
          xGLast4: xG90 * 4,
          xALast4: xA90 * 4,
          shotsLast4: 0,
          keyPassesLast4: 0,
          xG90,
          xA90,
          xGI3: (xG90 + xA90) * 3,
          xGI5: (xG90 + xA90) * 5,
          minutesTrend: 0,
          shots90: 0,
          keyPasses90: 0,
          fixturesByGw,
          
          minutesLast1: probPlay * 90,
          minutesLast3: probPlay * 90 * 3,
          minutesLast5: probPlay * 90 * 5,
          minutesEWMA: probPlay * 90,
          startsLast5: probPlay * 5,
          seasonMinutesPercent: probPlay,
          restHours: 168,
          fixturesLast7Days: 1,
          fixturesLast14Days: 2,
          minutesVolatility: 0,
          chanceOfPlayingThisRound: probPlay * 100,
          selectionMomentum: 0,
          consecutiveStarts: 0,

          predictedMinutes: probPlay * 90,
          injuryStatus: probPlay < 1.0 ? 'Injured/Doubtful' : null,
          eo: this.top1kData[fplId]?.eo || 0
        };

        this.playerNames[fplId] = playerName;
        this.playerPositions[fplId] = pos;
        this.playerCosts[fplId] = cost;
        this.playerTeams[fplId] = team;
        this.allIds.push(fplId);

        // Store external xp from CSV directly
        this.xpMatrix[fplId] = {};
        for (let step = 0; step < 15; step++) {
          const gw = nextEventId + step;
          const decayFactor = Math.pow(0.9, step);
          this.xpMatrix[fplId][gw] = meritScore * decayFactor;
        }
      }
    }
    console.log(`[CSVOracle] Ingested expected points and metadata for ${Object.keys(this.xpMatrix).length} players.`);
  }

  private getProjectionInput(playerId: number, gameweek: number): ProjectionInput {
    return {
      playerId,
      source: this.fuel === 'native' ? 'NATIVE' : (this.fuel === 'eye-test' ? 'EYE_TEST' : 'FPLFORM'),
      features: this.featuresMatrix[playerId],
      externalXP: this.xpMatrix[playerId]?.[gameweek] || 0
    };
  }

  getXP(playerId: number, gameweek: number): number { 
    return this.projectionEngine.predict(this.getProjectionInput(playerId, gameweek), gameweek).expected;
  }
  getVariance(playerId: number, gameweek: number): number { 
    return this.projectionEngine.predict(this.getProjectionInput(playerId, gameweek), gameweek).variance;
  }
  getPriceDelta(playerId: number): number { return 0; }
  getPosition(playerId: number): string {
    const pos = this.playerPositions[playerId];
    return pos === 'GK' ? 'GKP' : pos;
  }
  getCost(playerId: number): number { return this.playerCosts[playerId]; }
  getTeam(playerId: number): string { return this.playerTeams[playerId]; }
  getAllPlayerIds(): number[] { return this.allIds; }
}
