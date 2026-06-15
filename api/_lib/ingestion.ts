import fs from 'fs';
import path from 'path';

export interface XPOracle {
  getXP(playerId: number, gameweek: number): number;
  getVariance(playerId: number, gameweek: number): number;
  getPriceDelta(playerId: number): number;
  getFixtures(gameweek: number): any[]; 
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
  private varianceMatrix: Record<number, Record<number, number>> = {};
  public playerNames: Record<number, string> = {}; // Helper for debugging output
  private playerPositions: Record<number, string> = {};
  private playerCosts: Record<number, number> = {};
  private playerTeams: Record<number, string> = {};
  private allIds: number[] = [];
  private top1kData: Record<number, { ownership: number; started: number; eo: number; captain: number; tripleCaptain: number }> = {};

  constructor(
    filePath: string, 
    players: any[] = [], 
    riskMode: string = 'safe',
    fixtures: any[] = [], 
    teams: any[] = [], 
    nextEventId: number = 1
  ) {
    this.loadTop1kData();
    this.loadData(filePath, players, fixtures, teams, nextEventId, riskMode);
  }

  private loadTop1kData() {
    const jsonPath = path.resolve(process.cwd(), 'data', 'top_1000_eo.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.players) {
          Object.keys(parsed.players).forEach(pId => {
            this.top1kData[parseInt(pId)] = parsed.players[pId];
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
    riskMode: string
  ) {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[CSVOracle] Data file not found at ${fullPath}`);
      return;
    }

    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const lines = fileContent.split('\n');

    let syntheticId = 9000;

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
        cols = line.split(',').map(c => (c || '').replace(/"/g, ''));
      } catch (err: any) {
        console.error(`[CSVOracle] Parsing failed at line ${i}: "${line}"`);
        throw err;
      }
      
      if (cols.length > 10 && cols[3] && cols[3].length === 3) {
        const playerName = cols[1];
        const team = cols[3];
        const pos = cols[4] === 'GK' ? 'GKP' : cols[4];
        const cost = parseFloat(cols[5]) * 10; 
        const meritScore = parseFloat(cols[6]) || 0; 
        
        // Match player name to real FPL ID
        let fplId = syntheticId++; 
        let rawOwnership = 100.0; // default safe value
        let realTeamId = 0;
        if (players.length > 0) {
          const match = players.find(p => 
            p.web_name?.toLowerCase() === playerName.toLowerCase() ||
            p.second_name?.toLowerCase().includes(playerName.toLowerCase()) ||
            playerName.toLowerCase().includes(p.second_name?.toLowerCase()) ||
            playerName.toLowerCase().includes(p.web_name?.toLowerCase())
          );
          if (match) {
            fplId = match.id;
            rawOwnership = parseFloat(match.selected_by_percent) || 100.0;
            realTeamId = match.team;
          }
        }
        
        const teamId = teamMap[team.toLowerCase()] || realTeamId || 0;

        const adjustedMerit = meritScore;

        this.playerNames[fplId] = playerName;
        this.playerPositions[fplId] = pos;
        this.playerCosts[fplId] = cost;
        this.playerTeams[fplId] = team;
        this.allIds.push(fplId);
        
        // Calculate P(play) from cols[8] (Prob. of Appearing) or FPL metadata
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

        // Model P(0), P(60), P(90)
        const p0 = 1 - probPlay;
        let p90 = 0;
        let p60 = 0;
        if (probPlay >= 0.8) {
          p90 = probPlay * 0.85;
          p60 = probPlay * 0.15;
        } else {
          p90 = probPlay * 0.5;
          p60 = probPlay * 0.5;
        }

        // Appearance expected value and variance
        const eApp = p60 + 2 * p90;
        const eApp2 = p60 + 4 * p90;
        const varApp = Math.max(0, eApp2 - eApp * eApp);

        this.xpMatrix[fplId] = {};
        this.varianceMatrix[fplId] = {};
        for (let step = 0; step < 15; step++) {
          const gw = nextEventId + step;
          
          if (fixtures && fixtures.length > 0 && teamId > 0) {
            const teamFixtures = fixtures.filter(f => f.event === gw && (f.team_h === teamId || f.team_a === teamId));
            if (teamFixtures.length > 0) {
              let gwXP = 0;
              const decayFactor = Math.pow(0.9, step);
              teamFixtures.forEach(f => {
                const fdr = f.team_h === teamId ? f.team_h_difficulty : f.team_a_difficulty;
                const diffMultiplier = 1 + (3 - fdr) * 0.1;
                gwXP += adjustedMerit * diffMultiplier * decayFactor;
              });

              const expectedReturns = Math.max(0, gwXP - eApp);
              const varReturns = 1.5 * expectedReturns;
              this.xpMatrix[fplId][gw] = Math.max(0, eApp + expectedReturns);
              this.varianceMatrix[fplId][gw] = varApp + varReturns;
            } else {
              // Blank Gameweek
              this.xpMatrix[fplId][gw] = 0;
              this.varianceMatrix[fplId][gw] = 0;
            }
          } else {
            // Fallback for tests/isolated execution
            const gwXP = adjustedMerit * Math.pow(0.9, step);
            const expectedReturns = Math.max(0, gwXP - eApp);
            const varReturns = 1.5 * expectedReturns;
            this.xpMatrix[fplId][gw] = Math.max(0, eApp + expectedReturns);
            this.varianceMatrix[fplId][gw] = varApp + varReturns;
          }
        }
      }
    }
    console.log(`[CSVOracle] Ingested expected points and metadata for ${Object.keys(this.xpMatrix).length} players.`);
  }

  getXP(playerId: number, gameweek: number): number { return this.xpMatrix[playerId]?.[gameweek] || 0; }
  getVariance(playerId: number, gameweek: number): number { return this.varianceMatrix[playerId]?.[gameweek] || 0; }
  getPriceDelta(playerId: number): number { return 0; }
  getFixtures(gameweek: number): any[] { return []; }
  getPosition(playerId: number): string {
    const pos = this.playerPositions[playerId];
    return pos === 'GK' ? 'GKP' : pos;
  }
  getCost(playerId: number): number { return this.playerCosts[playerId]; }
  getTeam(playerId: number): string { return this.playerTeams[playerId]; }
  getAllPlayerIds(): number[] { return this.allIds; }
}
