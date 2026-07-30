import fs from 'fs';
import path from 'path';

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
    nextEventId: number = 1,
    fuel: string = 'fplform'
  ) {
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
          let match = null;
          let providedId = (cols.length > 11 && !isNaN(parseInt(cols[11]))) ? parseInt(cols[11]) : null;
          
          if (providedId) {
            match = players.find(p => p.id === providedId);
          }
          
          if (!match) {
            match = players.find(p => {
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
          }

          if (match) {
            fplId = match.id;
            rawOwnership = parseFloat(match.selected_by_percent) || 100.0;
            realTeamId = match.team;
            cost = match.now_cost; // OVERWRITE CSV COST WITH LIVE FPL PRICE
            matchedPlayer = match;
          }
        }
        
        const teamId = parsedTeamId || realTeamId || 0;

        // Eye-test: override CSV merit with live FPL API data (form, xG, xA, PPM)
        // This ensures eye-test scores flow through the full LP Solver pipeline
        let adjustedMerit = meritScore;
        if (fuel === 'eye-test' && matchedPlayer) {
          // Add minimum 3-game (270 mins) threshold to prevent small sample size bias 
          // where players with 10 mins and 1 shot get massive artificially inflated per-90 stats
          const gamesPlayed = Math.max(3.0, (matchedPlayer.minutes || 0) / 90);
          const ppg = parseFloat(matchedPlayer.points_per_game || "0");
          const form = parseFloat(matchedPlayer.form || "0");
          const xG90 = parseFloat(matchedPlayer.expected_goals || "0") / gamesPlayed;
          const xA90 = parseFloat(matchedPlayer.expected_assists || "0") / gamesPlayed;
          
          // Construct a true per-game merit score (similar scale to normal xP, usually 2.0 to 10.0)
          // Calibrated offline: a 1:1 ratio between xG90 and xA90 provides the highest seasonal return.
          const liveMerit = (ppg * 0.3) + (form * 0.4) + (xG90 * 2.5) + (xA90 * 2.5);
          
          // If the season hasn't started yet (all live stats are 0), fallback to the baseline CSV merit
          if (liveMerit > 0) {
            adjustedMerit = liveMerit;
          }
        }

        this.playerNames[fplId] = playerName;
        this.playerPositions[fplId] = pos;
        this.playerCosts[fplId] = cost;
        this.playerTeams[fplId] = team;
        this.allIds.push(fplId);
        
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

        // Base Probabilities
        let baseP90 = 0;
        let baseP60 = 0;
        if (probPlay >= 0.8) {
          baseP90 = probPlay * 0.85;
          baseP60 = probPlay * 0.15;
        } else {
          baseP90 = probPlay * 0.5;
          baseP60 = probPlay * 0.5;
        }

        this.xpMatrix[fplId] = {};
        this.varianceMatrix[fplId] = {};

        for (let step = 0; step < 15; step++) {
          const gw = nextEventId + step;
          
          if (fixtures && fixtures.length > 0 && teamId > 0 && teams && teams.length > 0) {
            const teamFixtures = fixtures.filter(f => f.event === gw && (f.team_h === teamId || f.team_a === teamId));
            
            if (teamFixtures.length > 0) {
              let p90 = baseP90;
              let p60 = baseP60;

              // Apply dynamic congestion penalty conditionally based on rotation risk
              if (teamFixtures.length > 1) {
                p90 *= 1 - ((1 - probPlay) * DGW_ROTATION_PENALTY);
                p60 *= 1 - ((1 - probPlay) * DGW_ROTATION_PENALTY);
              }

              const eApp = p60 + 2 * p90;
              const eApp2 = p60 + 4 * p90;
              const varApp = Math.max(0, eApp2 - eApp * eApp);

              let gwXP = 0;
              let gwVarReturns = 0;
              const decayFactor = Math.pow(0.9, step);

              teamFixtures.forEach(f => {
                let diffMultiplier = 1.0;
                
                const isHome = f.team_h === teamId;
                const opponentId = isHome ? f.team_a : f.team_h;
                
                const teamData = teams.find(t => t.id === teamId);
                const opponentData = teams.find(t => t.id === opponentId);

                const hasValidStrengths = teamData && opponentData && 
                                          opponentData.strength_attack_away > 0 && 
                                          opponentData.strength_attack_home > 0 &&
                                          opponentData.strength_defence_away > 0 &&
                                          opponentData.strength_defence_home > 0;

                if (hasValidStrengths) {
                    let ratio = 1.0;
                    if (pos === 'GKP' || pos === 'DEF') {
                        if (isHome) {
                            ratio = teamData.strength_defence_home / opponentData.strength_attack_away;
                        } else {
                            ratio = teamData.strength_defence_away / opponentData.strength_attack_home;
                        }
                    } else { // MID or FWD
                        if (isHome) {
                            ratio = teamData.strength_attack_home / opponentData.strength_defence_away;
                        } else {
                            ratio = teamData.strength_attack_away / opponentData.strength_defence_home;
                        }
                    }
                    
                    // Eye-test uses full FDR (100%) with wider clamp to be fixture-aggressive
                    // FPLFORM/NATIVE use 50% dampening to avoid double-counting their built-in fixture signal
                    const dampenFactor = fuel === 'eye-test' ? 1.0 : 0.5;
                    let dampened = 1 + ((ratio - 1) * dampenFactor);
                    const clampLow = fuel === 'eye-test' ? 0.70 : 0.85;
                    const clampHigh = fuel === 'eye-test' ? 1.40 : 1.20;
                    diffMultiplier = Math.max(clampLow, Math.min(clampHigh, dampened));
                } else {
                    const fdr = f.team_h === teamId ? f.team_h_difficulty : f.team_a_difficulty;
                    diffMultiplier = 1 + (3 - fdr) * 0.1;
                }

                const fixtureXP = adjustedMerit * diffMultiplier * decayFactor;
                // Calculate returns beyond basic appearance points
                const expectedReturns = Math.max(0, fixtureXP - eApp);
                let fixtureVarReturns = 1.5 * expectedReturns;

                // Scale variance by sqrt of the multiplier to maintain utility curve consistency
                fixtureVarReturns *= Math.sqrt(diffMultiplier);

                gwXP += Math.max(0, eApp + expectedReturns);
                gwVarReturns += fixtureVarReturns;
              });

              // The total appearance variance across multiple games
              const totalVarApp = varApp * teamFixtures.length;

              this.xpMatrix[fplId][gw] = gwXP;
              this.varianceMatrix[fplId][gw] = totalVarApp + gwVarReturns;
            } else {
              // Blank Gameweek
              this.xpMatrix[fplId][gw] = 0;
              this.varianceMatrix[fplId][gw] = 0;
            }
          } else {
            // Fallback for tests/isolated execution
            const eApp = baseP60 + 2 * baseP90;
            const eApp2 = baseP60 + 4 * baseP90;
            const varApp = Math.max(0, eApp2 - eApp * eApp);

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
  getPosition(playerId: number): string {
    const pos = this.playerPositions[playerId];
    return pos === 'GK' ? 'GKP' : pos;
  }
  getCost(playerId: number): number { return this.playerCosts[playerId]; }
  getTeam(playerId: number): string { return this.playerTeams[playerId]; }
  getAllPlayerIds(): number[] { return this.allIds; }
}
