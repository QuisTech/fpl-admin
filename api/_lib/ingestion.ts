import fs from 'fs';
import path from 'path';
import { ProjectionEngine, ProjectionInput, getParamsForRiskMode } from './projection.js';
import { loadWeights } from './weights-loader.js';
import { HistoricalPlayerFeatures, HistoricalFixture } from './providers/historical.js';
import { FeatureStoreRepository } from './providers/feature-store.js';
import { PlayerDistribution } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// XPOracle Interface
// ─────────────────────────────────────────────────────────────────────────────
export interface XPOracle {
  getXP(playerId: number, gameweek: number): number;
  getVariance(playerId: number, gameweek: number): number;
  getDistribution(playerId: number, gameweek: number): PlayerDistribution;
  getPriceDelta(playerId: number): number;
  getPosition(playerId: number): string;
  getCost(playerId: number): number;
  getTeam(playerId: number): string;
  getAllPlayerIds(): number[];
  getTop1kEO?(playerId: number): number;
  getTop1kOwnership?(playerId: number): number;
  playerNames: Record<number, string>;
}

const fileCache: Record<string, { content: string; mtimeMs: number }> = {};
function getCachedFile(filePath: string): string | null {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) return null;
    const stat = fs.statSync(fullPath);
    const cached = fileCache[fullPath];
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.content;
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    fileCache[fullPath] = { content, mtimeMs: stat.mtimeMs };
    return content;
  } catch {
    return null;
  }
}

let cachedTop1kData: { raw: string; parsed: any } | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// BaseOracle — Shared metadata, Sentiment, and Feature mappings from FPL API.
// ─────────────────────────────────────────────────────────────────────────────
export abstract class BaseOracle implements XPOracle {
  protected xpMatrix: Record<number, Record<number, number>> = {};
  protected distributionMatrix: Record<number, Record<number, PlayerDistribution>> = {};
  public playerNames: Record<number, string> = {};
  protected playerPositions: Record<number, string> = {};
  protected playerCosts: Record<number, number> = {};
  protected playerTeams: Record<number, string> = {};
  protected allIds: number[] = [];
  protected top1kData: Record<number, { ownership: number; started: number; eo: number; captain: number; tripleCaptain: number }> = {};
  
  protected featuresMatrix: Record<number, HistoricalPlayerFeatures> = {};
  protected projectionEngine: ProjectionEngine;
  protected nextEventId: number;
  protected hasFixtures: boolean = false;

  protected abstract get fuelSource(): 'NATIVE' | 'EYE_TEST' | 'FPLFORM';

  constructor(players: any[] = [], nextEventId: number = 1, riskMode: string = 'safe') {
    this.nextEventId = nextEventId;
    const baseWeights = loadWeights('baseline');
    const riskAdjustedWeights = getParamsForRiskMode(riskMode, baseWeights);
    this.projectionEngine = new ProjectionEngine(riskAdjustedWeights);
    this.loadTop1kData(players);
  }

  private loadTop1kData(players: any[] = []) {
    const raw = getCachedFile('data/top_1000_eo.json');
    if (raw) {
      try {
        let parsed = (cachedTop1kData && cachedTop1kData.raw === raw) ? cachedTop1kData.parsed : null;
        if (!parsed) {
          parsed = JSON.parse(raw);
          cachedTop1kData = { raw, parsed };
        }
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
        }
      } catch (err: any) {
        console.warn(`[${this.fuelSource}Oracle] Failed to parse Top 1,000 EO data: ${err.message}`);
      }
    }
  }

  getTop1kEO(playerId: number): number {
    return this.top1kData[playerId]?.eo ?? 0;
  }

  getTop1kOwnership(playerId: number): number {
    return this.top1kData[playerId]?.ownership ?? 0;
  }

  protected populateMetadataAndFeatures(
    players: any[],
    fixtures: any[],
    teams: any[],
    nextEventId: number
  ) {
    this.hasFixtures = fixtures && fixtures.length > 0;
    const featureStore = new FeatureStoreRepository();
    const liveTeamRatings: Record<number, { attack: number, defense: number }> = {};
    const teamNameMap: Record<number, string> = {};

    // 1. Build live team ratings and team short name map
    if (teams && teams.length > 0) {
      const currentSeason = '2023-24';
      const previousGw = nextEventId > 1 ? nextEventId - 1 : 38;
      teams.forEach(t => {
        teamNameMap[t.id] = t.short_name;
        const features = featureStore.getFeatures(currentSeason, previousGw, t.id);
        liveTeamRatings[t.id] = { 
           attack: features.attack, 
           defense: features.defense 
        };
      });
    }

    // 2. Loop over every player from the official FPL API
    players.forEach(p => {
      const fplId = p.id;
      const playerName = p.web_name || p.second_name || 'Unknown';
      const teamId = p.team;
      const teamShort = teamNameMap[teamId] || `TEAM_${teamId}`;
      
      const expectedElementType = p.element_type;
      const pos = expectedElementType === 1 ? 'GKP' : 
                  expectedElementType === 2 ? 'DEF' : 
                  expectedElementType === 3 ? 'MID' : 'FWD';
      
      const cost = p.now_cost || 50; // default 5.0m if missing

      this.playerNames[fplId] = playerName;
      this.playerPositions[fplId] = pos;
      this.playerCosts[fplId] = cost;
      this.playerTeams[fplId] = teamShort;
      this.allIds.push(fplId);

      // Build fixtures by GW
      const fixturesByGw: Record<number, HistoricalFixture[]> = {};
      for (let step = 0; step < 15; step++) {
        const gw = nextEventId + step;
        if (fixtures && fixtures.length > 0) {
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

      let probPlay = p.chance_of_playing_next_round;
      if (probPlay === null || probPlay === undefined) probPlay = 100;
      probPlay = Math.max(0, Math.min(100, probPlay)) / 100;

      const safeParseFloat = (val: any) => {
        const parsed = parseFloat(val);
        return isNaN(parsed) ? 0 : parsed;
      };

      const expectedGoalsPer90 = typeof p.expected_goals_per_90 === 'number' ? p.expected_goals_per_90 : safeParseFloat(p.expected_goals_per_90 || p.expected_goals || "0");
      const expectedAssistsPer90 = typeof p.expected_assists_per_90 === 'number' ? p.expected_assists_per_90 : safeParseFloat(p.expected_assists_per_90 || p.expected_assists || "0");

      const priceScale = (cost / 10) / 7.0;
      const priorXG = (pos === 'FWD' ? 0.35 : pos === 'MID' ? 0.18 : pos === 'DEF' ? 0.04 : 0.0) * priceScale;
      const priorXA = (pos === 'MID' ? 0.18 : pos === 'FWD' ? 0.12 : pos === 'DEF' ? 0.06 : 0.0) * priceScale;

      let xG90 = Math.min(1.0, (expectedGoalsPer90 * 0.25) + (priorXG * 0.75));
      let xA90 = Math.min(0.7, (expectedAssistsPer90 * 0.25) + (priorXA * 0.75));

      const completedGws = Math.max(1, nextEventId - 1);
      const rawMinutes = p.minutes || 0;
      const starts = p.starts || 0;
      const avgMins = rawMinutes / completedGws;
      const startRate = starts / completedGws;
      const isAvail = p.status === 'a' && probPlay > 0.5;

      let dynamicPredictedMins = 0;
      if (!isAvail) {
        dynamicPredictedMins = 0;
      } else if (nextEventId === 1) {
        // Pre-season before GW1: use price baseline & availability
        dynamicPredictedMins = (cost >= 45 ? 85 : 0) * probPlay;
      } else if (startRate >= 0.5 || (completedGws <= 1 && starts >= 1)) {
        // Regular confirmed starter (started >=50% of matches)
        dynamicPredictedMins = Math.max(65, Math.min(90, avgMins)) * probPlay;
      } else if (rawMinutes > 0) {
        // Impact substitute (played minutes but not a starter)
        dynamicPredictedMins = Math.max(15, Math.min(35, avgMins)) * probPlay;
      } else {
        // Unused bench / reserve (0 minutes played)
        dynamicPredictedMins = 0;
      }

      this.featuresMatrix[fplId] = {
        id: fplId,
        name: playerName,
        position: pos,
        teamId,
        price: cost / 10,
        minutesLast4: dynamicPredictedMins * 4,
        startsLast4: (dynamicPredictedMins >= 60 ? 1 : 0) * 4,
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
        
        minutesLast1: dynamicPredictedMins,
        minutesLast3: dynamicPredictedMins * 3,
        minutesLast5: dynamicPredictedMins * 5,
        minutesEWMA: dynamicPredictedMins,
        startsLast5: (dynamicPredictedMins >= 60 ? 1 : 0) * 5,
        seasonMinutesPercent: dynamicPredictedMins / 90,
        restHours: 168,
        fixturesLast7Days: 1,
        fixturesLast14Days: 2,
        minutesVolatility: 0,
        chanceOfPlayingThisRound: probPlay * 100,
        selectionMomentum: 0,
        consecutiveStarts: starts,

        predictedMinutes: dynamicPredictedMins,
        injuryStatus: probPlay < 1.0 ? 'Injured/Doubtful' : null,
        eo: this.top1kData[fplId]?.eo || 0
      };
    });
  }

  protected predictionCache: Record<number, Record<number, { expected: number, variance: number }>> = {};

  private getProjectionInput(playerId: number, gameweek: number): ProjectionInput {
    return {
      playerId,
      source: this.fuelSource,
      features: this.featuresMatrix[playerId],
      externalXP: this.xpMatrix[playerId]?.[gameweek] || 0
    };
  }

  private getPrediction(playerId: number, gameweek: number): { expected: number, variance: number } {
    if (!this.predictionCache[playerId]) {
      this.predictionCache[playerId] = {};
    }
    if (!this.predictionCache[playerId][gameweek]) {
      this.predictionCache[playerId][gameweek] = this.projectionEngine.predict(
        this.getProjectionInput(playerId, gameweek), 
        gameweek
      );
    }
    return this.predictionCache[playerId][gameweek];
  }

  getXP(playerId: number, gameweek: number): number { 
    if (gameweek < this.nextEventId || gameweek >= this.nextEventId + 8) {
      return 0;
    }
    const features = this.featuresMatrix[playerId];
    if (this.hasFixtures && features && (!features.fixturesByGw?.[gameweek] || features.fixturesByGw[gameweek].length === 0)) {
      return 0;
    }
    return this.getPrediction(playerId, gameweek).expected;
  }
  getVariance(playerId: number, gameweek: number): number { 
    return this.getPrediction(playerId, gameweek).variance;
  }
  getDistribution(playerId: number, gameweek: number): PlayerDistribution {
    if (!this.distributionMatrix[playerId]) this.distributionMatrix[playerId] = {};
    if (!this.distributionMatrix[playerId][gameweek]) {
      this.distributionMatrix[playerId][gameweek] = this.projectionEngine.simulatePlayerDistribution(this.getProjectionInput(playerId, gameweek), gameweek);
    }
    return this.distributionMatrix[playerId][gameweek];
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

// ─────────────────────────────────────────────────────────────────────────────
// FplformOracle — Reads crowdsourced CSV file and maps names to FPL IDs
// ─────────────────────────────────────────────────────────────────────────────
export class FplformOracle extends BaseOracle {
  protected get fuelSource() { return 'FPLFORM' as const; }

  constructor(
    filePath: string,
    players: any[] = [],
    riskMode: string = 'safe',
    fixtures: any[] = [],
    teams: any[] = [],
    nextEventId: number = 1
  ) {
    super(players, nextEventId, riskMode);
    
    // 1. Populate metadata and features from API
    this.populateMetadataAndFeatures(players, fixtures, teams, nextEventId);

    // 2. Load and parse the FPLForm CSV file to override expected points (xpMatrix)
    const fileContent = getCachedFile(filePath);
    if (!fileContent) {
      console.warn(`[FplformOracle] Data file not found at ${filePath}`);
      return;
    }

    const lines = fileContent.split('\n');

    const teamShortMap: Record<string, number> = {};
    if (teams && teams.length > 0) {
      teams.forEach(t => teamShortMap[t.short_name.toLowerCase()] = t.id);
    }

    let parsedCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
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
      } catch (err) {
        continue;
      }

      if (cols.length >= 7 && cols[3]) {
        const playerName = cols[1];
        const teamName = cols[3].toLowerCase();
        const pos = cols[4] === 'GK' ? 'GKP' : cols[4];
        const expectedElementType = pos === 'GKP' ? 1 : pos === 'DEF' ? 2 : pos === 'MID' ? 3 : 4;
        const csvCost = parseFloat(cols[5]) * 10;
        const meritScore = parseFloat(cols[6]) || 0;

        // Try to match CSV row to FPL API player
        const csvTeamId = teamShortMap[teamName] || 0;
        const matchedPlayer = players.find(p => {
          if (csvTeamId > 0 && p.team !== undefined && p.team !== csvTeamId) return false;
          if (p.element_type !== undefined && p.element_type !== expectedElementType) return false;

          const wName = (p.web_name || '').toLowerCase();
          const sName = (p.second_name || '').toLowerCase();
          const pName = playerName.toLowerCase();

          return wName === pName || (wName.length > 2 && pName.includes(wName)) || 
                 sName === pName || (sName.length > 2 && pName.includes(sName));
        });

        if (matchedPlayer) {
          const fplId = matchedPlayer.id;
          
          // Populate multi-gw expected points using decayed merit score
          this.xpMatrix[fplId] = {};
          for (let step = 0; step < 15; step++) {
            const gw = nextEventId + step;
            // meritScore decays across future gameweeks
            const projectedXp = Math.min(25.0, Math.max(0, meritScore * Math.pow(0.9, step)));
            this.xpMatrix[fplId][gw] = projectedXp;
          }
          
          // Override position and team from CSV if they were defaults
          this.playerPositions[fplId] = pos;
          this.playerTeams[fplId] = teamName.toUpperCase();
          this.playerCosts[fplId] = matchedPlayer.now_cost ?? csvCost;

          // Override probability-dependent features from CSV if available
          let probPlay = parseFloat(cols[8]);
          if (!isNaN(probPlay)) {
            // CSV might hold probability as percentage (e.g. 95) or fraction (e.g. 0.95)
            if (probPlay > 1.0) {
              probPlay = probPlay / 100;
            }
            probPlay = Math.max(0, Math.min(1.0, probPlay));

            const features = this.featuresMatrix[fplId];
            if (features) {
              features.chanceOfPlayingThisRound = probPlay * 100;
              features.predictedMinutes = probPlay * 90;
              features.minutesLast4 = probPlay * 90 * 4;
              features.startsLast4 = probPlay * 4;
              features.minutesLast1 = probPlay * 90;
              features.minutesLast3 = probPlay * 90 * 3;
              features.minutesLast5 = probPlay * 90 * 5;
              features.minutesEWMA = probPlay * 90;
              features.startsLast5 = probPlay * 5;
              features.seasonMinutesPercent = probPlay;
              features.injuryStatus = probPlay < 1.0 ? 'Injured/Doubtful' : null;
            }
          }
          parsedCount++;
        }
      }
    }
    console.log(`[FplformOracle] Successfully loaded FPLForm projections for ${parsedCount} matched players.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NativeOracle — Communicates ONLY with FPL API data. No CSV file is read.
// ─────────────────────────────────────────────────────────────────────────────
export class NativeOracle extends BaseOracle {
  protected get fuelSource() { return 'NATIVE' as const; }

  constructor(
    _filePath: string, // ignored
    players: any[] = [],
    riskMode: string = 'safe',
    fixtures: any[] = [],
    teams: any[] = [],
    nextEventId: number = 1
  ) {
    super(players, nextEventId, riskMode);
    
    // Populate metadata and features from live API
    this.populateMetadataAndFeatures(players, fixtures, teams, nextEventId);

    // Populate xpMatrix directly from official API's ep_next, with decay for future weeks
    players.forEach(p => {
      const fplId = p.id;
      const meritScore = parseFloat(p.ep_next) || 0;
      
      this.xpMatrix[fplId] = {};
      for (let step = 0; step < 15; step++) {
        const gw = nextEventId + step;
        const decayFactor = Math.pow(0.9, step);
        this.xpMatrix[fplId][gw] = meritScore * decayFactor;
      }
    });

    console.log(`[NativeOracle] Successfully loaded native API projections for ${players.length} players.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EyeTestOracle — Skips CSVs completely. Feeds the Machine Learning engine.
// ─────────────────────────────────────────────────────────────────────────────
export class EyeTestOracle extends BaseOracle {
  protected get fuelSource() { return 'EYE_TEST' as const; }

  constructor(
    _filePath: string, // ignored
    players: any[] = [],
    riskMode: string = 'safe',
    fixtures: any[] = [],
    teams: any[] = [],
    nextEventId: number = 1,
    fixturesFilePath?: string
  ) {
    super(players, nextEventId, riskMode);
    
    // For EyeTest 2026-27 fixtures override if custom path provided
    if (fixturesFilePath) {
      const fixturesFullPath = path.resolve(process.cwd(), fixturesFilePath);
      if (fs.existsSync(fixturesFullPath)) {
        try {
          const fixturesContent = fs.readFileSync(fixturesFullPath, 'utf-8');
          fixtures = JSON.parse(fixturesContent);
          nextEventId = 1;
          this.nextEventId = 1;
        } catch (err: any) {
          console.warn(`[EyeTestOracle] Failed to load custom fixtures: ${err.message}`);
        }
      }
    }

    // Populate metadata and features from live API
    this.populateMetadataAndFeatures(players, fixtures, teams, nextEventId);

    // Leave xpMatrix empty: ProjectionEngine ML model predictions will run entirely on features
    players.forEach(p => {
      this.xpMatrix[p.id] = {};
    });

    console.log(`[EyeTestOracle] Loaded ML features for ${players.length} players.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OracleFactory — Clean router mapping user fuel parameter to strategy classes
// ─────────────────────────────────────────────────────────────────────────────
export class OracleFactory {
  static create(
    csvFilePath: string, 
    players: any[], 
    fuel: string, 
    fixtures: any[] = [], 
    teams: any[] = [], 
    nextEventId: number = 1,
    riskMode: string = 'safe',
    fixturesFilePath?: string
  ): XPOracle {
    console.log(`[OracleFactory] Creating ${fuel} oracle...`);
    if (fuel === 'native') {
      return new NativeOracle(csvFilePath, players, riskMode, fixtures, teams, nextEventId);
    }
    if (fuel === 'eye-test' || fuel === 'eyetest') {
      return new EyeTestOracle(csvFilePath, players, riskMode, fixtures, teams, nextEventId, fixturesFilePath);
    }
    return new FplformOracle(csvFilePath, players, riskMode, fixtures, teams, nextEventId);
  }
}

// Backward Compatibility Alias
export class CSVOracle extends FplformOracle {}
