import fs from 'fs';
import path from 'path';
import { ProjectionEngine, ProjectionInput } from './projection.js';
import { loadWeights } from './weights-loader.js';
import { HistoricalPlayerFeatures, HistoricalFixture } from './providers/historical.js';

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
    fuel: string = 'fplform'
  ) {
    this.fuel = fuel;
    const weights = loadWeights('baseline');
    this.projectionEngine = new ProjectionEngine(weights);
    this.loadTop1kData(players);
    this.loadData(filePath, players, fixtures, teams, nextEventId, riskMode, fuel);
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
    fuel: string = 'fplform'
  ) {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[CSVOracle] Data file not found at ${fullPath}`);
      return;
    }

    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const lines = fileContent.split('\n');

    let syntheticId = 100000; // Increased to 100000 to prevent collisions with future FPL API IDs

    const teamMap: Record<string, number> = {};
    if (teams && teams.length > 0) {
      teams.forEach(t => {
        teamMap[t.short_name.toLowerCase()] = t.id;
      });
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
      
      if (cols.length >= 9 && cols[3] && cols[3].length === 3) {
        const playerName = cols[1];
        const team = cols[3];
        const pos = cols[4] === 'GK' ? 'GKP' : cols[4];
        let cost = parseFloat(cols[5]) * 10; 
        const meritScore = parseFloat(cols[6]) || 0; 
        
        const parsedTeamId = teamMap[team.toLowerCase()] || 0;
        const expectedElementType = pos === 'GKP' ? 1 : pos === 'DEF' ? 2 : pos === 'MID' ? 3 : pos === 'FWD' ? 4 : 0;

        let fplId = syntheticId++; 
        let rawOwnership = 100.0;
        let realTeamId = parsedTeamId;
        let matchedPlayer: any = null;

        if (players.length > 0) {
          let match = players.find(p => {
            if (parsedTeamId > 0 && p.team !== parsedTeamId) return false;
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
            realTeamId = match.team;
            cost = match.now_cost; // OVERWRITE CSV COST WITH LIVE FPL PRICE
            matchedPlayer = match;
          }
        }
        
        const teamId = parsedTeamId || realTeamId || 0;

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
        const form = matchedPlayer ? parseFloat(matchedPlayer.form || "0") : 0;
        const xG90 = matchedPlayer && gamesPlayed > 0 ? (parseFloat(matchedPlayer.expected_goals || "0") / gamesPlayed) : 0;
        const xA90 = matchedPlayer && gamesPlayed > 0 ? (parseFloat(matchedPlayer.expected_assists || "0") / gamesPlayed) : 0;
        
        // Build Fixtures
        const fixturesByGw: Record<number, HistoricalFixture[]> = {};
        for (let step = 0; step < 15; step++) {
          const gw = nextEventId + step;
          if (fixtures && fixtures.length > 0 && teamId > 0 && teams && teams.length > 0) {
            const teamFixtures = fixtures.filter(f => f.event === gw && (f.team_h === teamId || f.team_a === teamId));
            fixturesByGw[gw] = teamFixtures.map(f => {
               const isHome = f.team_h === teamId;
               return {
                  opponentTeamId: isHome ? f.team_a : f.team_h,
                  isHome,
                  difficulty: isHome ? f.team_h_difficulty : f.team_a_difficulty,
                  // FPL API doesn't have opponentStrengthDefense easily accessible inside f fixture.
                  // Default fallback for historical engine. 
                  opponentStrengthDefense: isHome ? f.team_a_difficulty : f.team_h_difficulty, 
                  opponentStrengthAttack: isHome ? f.team_a_difficulty : f.team_h_difficulty
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
