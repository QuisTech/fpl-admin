import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import solver from "javascript-lp-solver";
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { 
  FPLPlayer, FPLTeam, FPLFixture, ScoredPlayer, 
  FPLPlayerSchema, FPLTeamSchema, FPLFixtureSchema,
  RecommendationResponse, TeamSyncResponse, TransferRecommendation, ChipAdvice, PlayerDistribution,
  EntryHistory, ManagerInfo
} from './_lib/types.js';
import { OracleFactory, XPOracle, CSVOracle } from './_lib/ingestion.js';
import { getParamsForRiskMode } from './_lib/projection.js';
import { loadWeights } from './_lib/weights-loader.js';
const baseWeights = loadWeights('baseline');
import { Simulator } from './_lib/simulator.js';
import { solveOptimalSquad, solveStartingXI, solveCaptain } from './_lib/lp-solver.js';
import { getUserTier, mergeUserTiers, getFirestore, isAdminUser } from '../lib/firestore.js';
import { getLLMTransferDecision, getLLMChipAdvice, generateSocialThread } from './_lib/llm-agent.js';
import { getNewsContextFromCache } from './_lib/news-service.js';
import { verifyAuth } from './_lib/auth.js';

const FPL_BASE_URL = "https://fantasy.premierleague.com/api";

interface LPSolverModel {
  optimize: string;
  opType: "max" | "min";
  constraints: Record<string, { max?: number; min?: number; equal?: number }>;
  variables: Record<string, Record<string, number>>;
  ints: Record<string, 1>;
}

export class FPLService {
  private static cache: { data: any; timestamp: number } | null = null;
  private static CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private static recCache: Map<string, { data: RecommendationResponse; timestamp: number }> = new Map();
  private static REC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private static teamPicksCache: Map<string, { teamRes: any; managerInfo: ManagerInfo | null; timestamp: number }> = new Map();
  private static TEAM_PICKS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

  private static getHeaders() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Referer": "https://fantasy.premierleague.com/",
      "Origin": "https://fantasy.premierleague.com",
      "Connection": "keep-alive",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site"
    };
  }

  private static parseCsvRows(text: string): Record<string, string>[] {
    const lines = text.split('\n');
    if (lines.length === 0) return [];
    const header = lines[0].split(',').map(h => h.trim());
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      let cols: string[] = [];
      let inQuotes = false;
      let cur = '';
      for (let c = 0; c < line.length; c++) {
        const char = line[c];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) {
          cols.push(cur.trim());
          cur = '';
        } else cur += char;
      }
      cols.push(cur.trim());
      if (cols.length >= header.length) {
        const row: Record<string, string> = {};
        header.forEach((h, idx) => {
          let val = cols[idx] ? cols[idx].replace(/^"|"$/g, '') : '';
          row[h] = val;
        });
        rows.push(row);
      }
    }
    return rows;
  }

  private static async fetchWithRetry(url: string, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
      try {
        const config = { headers: this.getHeaders(), timeout: 10000 };
        const res = await axios.get(url, config);
        return res;
      } catch (err: any) {
        console.warn(`[FPL API] Attempt ${i + 1}/${retries} failed for ${url}: ${err.response?.status || err.message}`);
        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
        } else {
          // If official FPL API returns 403, fallback to GitHub CSV mirrors
          if (url.includes('bootstrap-static')) {
            try {
              console.log("[FPL API] Falling back to GitHub players_raw & teams CSV mirror...");
              const [pRes, tRes] = await Promise.all([
                axios.get('https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/2024-25/players_raw.csv', { timeout: 10000 }),
                axios.get('https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/2024-25/teams.csv', { timeout: 10000 })
              ]);
              const rawPlayers = this.parseCsvRows(pRes.data);
              const rawTeams = this.parseCsvRows(tRes.data);

              const elements = rawPlayers.map(p => ({
                id: parseInt(p.id),
                web_name: p.web_name || '',
                first_name: p.first_name || '',
                second_name: p.second_name || '',
                now_cost: parseInt(p.now_cost) || 50,
                element_type: parseInt(p.element_type) || 3,
                team: parseInt(p.team) || 1,
                total_points: parseInt(p.total_points) || 0,
                form: p.form || '0.0',
                points_per_game: p.points_per_game || '0.0',
                selected_by_percent: p.selected_by_percent || '0.0',
                minutes: parseInt(p.minutes) || 0,
                goals_scored: parseInt(p.goals_scored) || 0,
                assists: parseInt(p.assists) || 0,
                clean_sheets: parseInt(p.clean_sheets) || 0,
                status: p.status || 'a',
                news: p.news || '',
                ep_this: p.ep_this || '0.0',
                ep_next: p.ep_next || '0.0',
                chance_of_playing_this_round: p.chance_of_playing_this_round && !isNaN(parseInt(p.chance_of_playing_this_round)) ? parseInt(p.chance_of_playing_this_round) : null,
                chance_of_playing_next_round: p.chance_of_playing_next_round && !isNaN(parseInt(p.chance_of_playing_next_round)) ? parseInt(p.chance_of_playing_next_round) : null,
                expected_goals: p.expected_goals || '0.0',
                expected_assists: p.expected_assists || '0.0',
                expected_goal_involvements: p.expected_goal_involvements || '0.0',
                expected_conceded: p.expected_goals_conceded || '0.0',
                influence: p.influence || '0.0',
                creativity: p.creativity || '0.0',
                threat: p.threat || '0.0',
                ict_index: p.ict_index || '0.0'
              }));

              const teams = rawTeams.map(t => ({
                id: parseInt(t.id),
                name: t.name || '',
                short_name: t.short_name || '',
                strength: parseInt(t.strength) || 3,
                strength_overall_home: parseInt(t.strength_overall_home) || 1000,
                strength_overall_away: parseInt(t.strength_overall_away) || 1000,
                strength_attack_home: parseInt(t.strength_attack_home) || 1000,
                strength_attack_away: parseInt(t.strength_attack_away) || 1000,
                strength_defence_home: parseInt(t.strength_defence_home) || 1000,
                strength_defence_away: parseInt(t.strength_defence_away) || 1000
              }));

              const now = new Date();
              const seasonStart = new Date('2026-08-15T17:30:00Z');
              const events = Array.from({ length: 38 }, (_, idx) => {
                const id = idx + 1;
                const deadline = new Date(seasonStart.getTime() + (idx * 7 * 24 * 60 * 60 * 1000));
                return {
                  id,
                  name: `Gameweek ${id}`,
                  is_current: false,
                  is_next: false,
                  deadline_time: deadline.toISOString()
                };
              });
              const upcomingEvent = events.find(e => new Date(e.deadline_time) > now) || events[0];
              upcomingEvent.is_next = true;
              const currentEventIdx = events.indexOf(upcomingEvent) - 1;
              if (currentEventIdx >= 0) {
                events[currentEventIdx].is_current = true;
              }

              console.log(`[FPL API] Successfully parsed ${elements.length} players & ${teams.length} teams from CSV mirror.`);
              return { data: { elements, teams, events } };
            } catch (fallbackErr: any) {
              console.error("[FPL API] Bootstrap CSV mirror fallback failed:", fallbackErr.message);
            }
          }

          if (url.includes('fixtures')) {
            try {
              console.log("[FPL API] Falling back to GitHub fixtures.csv mirror...");
              const fRes = await axios.get('https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/2024-25/fixtures.csv', { timeout: 10000 });
              const rawFixtures = this.parseCsvRows(fRes.data);
              const fixtures = rawFixtures.map(f => ({
                id: parseInt(f.id),
                team_h: parseInt(f.team_h),
                team_a: parseInt(f.team_a),
                team_h_difficulty: parseInt(f.team_h_difficulty) || 3,
                team_a_difficulty: parseInt(f.team_a_difficulty) || 3,
                event: f.event && f.event !== '' && !isNaN(parseInt(f.event)) ? parseInt(f.event) : null,
                finished: f.finished?.toLowerCase() === 'true'
              })).filter(f => !isNaN(f.id) && !isNaN(f.team_h) && !isNaN(f.team_a));

              console.log(`[FPL API] Successfully parsed ${fixtures.length} fixtures from CSV mirror.`);
              return { data: fixtures };
            } catch (fallbackErr: any) {
              console.error("[FPL API] Fixtures CSV mirror fallback failed:", fallbackErr.message);
            }
          }

          if (url.includes('bootstrap-static') && this.cache?.data) {
            console.warn("[FPL API] Serving stale cache due to API block.");
            return { data: this.cache.data };
          }
          throw err;
        }
      }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
  }

  static async getBaseData() {
    // Return cached data if fresh
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL) {
      return this.cache.data;
    }

    try {
      const [staticRes, fixturesRes] = await Promise.all([
        this.fetchWithRetry(`${FPL_BASE_URL}/bootstrap-static/`),
        this.fetchWithRetry(`${FPL_BASE_URL}/fixtures/`)
      ]);

      const players: FPLPlayer[] = [];
      staticRes.data.elements.forEach((p: any) => {
        const result = FPLPlayerSchema.safeParse(p);
        if (result.success) players.push(result.data);
      });

      const teams: FPLTeam[] = [];
      staticRes.data.teams.forEach((t: any) => {
        const result = FPLTeamSchema.safeParse(t);
        if (result.success) teams.push(result.data);
      });

      const fixtures = z.array(FPLFixtureSchema).parse(fixturesRes.data);
      const currentEvent = staticRes.data.events.find((e: any) => e.is_current) || 
                           staticRes.data.events.find((e: any) => e.is_previous) || 
                           { id: 1 };
      const nextEvent = staticRes.data.events.find((e: any) => e.is_next) ||
                        staticRes.data.events.find((e: any) => new Date(e.deadline_time) > new Date()) || 
                        { id: (currentEvent?.id || 2) + 1 };
      
      const result = { players, teams, fixtures, nextEventId: nextEvent.id, currentEventId: currentEvent.id };
      this.cache = { data: result, timestamp: Date.now() };
      return result;
    } catch (err: any) {
      console.error('[FPLService] Failed to fetch live FPL data:', err.message);
      
      // If we have cached data, return it even if expired
      if (this.cache) {
        console.warn('[FPLService] Using expired cached data as fallback');
        return this.cache.data;
      }
      
      // If no cache at all, return minimal data structure to allow eye-test mode to work
      console.warn('[FPLService] No cache available, returning minimal data for eye-test mode');
      return {
        players: [],
        teams: [],
        fixtures: [],
        nextEventId: 1,
        currentEventId: 1
      };
    }
  }

  static calculatePlayerScore(baseXp: number, player: FPLPlayer, riskMode: string, fuel: string = 'fplform', fixtures?: FPLFixture[], nextEventId?: number): number {
    let score = baseXp;
    // Eye-test merit + FDR is now computed inside the oracle (ingestion.ts)
    // so baseXp already contains the correct eye-test score with fixture modifiers
    
    if (riskMode !== 'value') {
      if (riskMode === 'aggressive' && player.selected_by_percent && parseFloat(player.selected_by_percent) < 5) {
        score *= 1.25;
      }

      // Premium player protection (captaincy value)
      // Elite assets are worth more than their PPM suggests because you captain them
      const costInMillions = player.now_cost / 10;
      if (costInMillions >= 10.0) score *= 1.15;
      else if (costInMillions >= 8.0) score *= 1.08;
    }

    return score;
  }

  static mapToScoredPlayer(p: FPLPlayer, teams: FPLTeam[], fixtures: FPLFixture[], nextEventId: number, riskMode: string, baseXp: number = 0, fuel: string = 'fplform'): ScoredPlayer {
    const posMap: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
    const position = posMap[p.element_type] || "MID";
    const team = teams.find(t => t.id === p.team);
    
    const next3Fix = (fixtures || [])
      .filter(f => (f.team_h === p.team || f.team_a === p.team) && f.event !== null && f.event >= nextEventId)
      .slice(0, 10)
      .map(f => {
        const isHome = f.team_h === p.team;
        const oppTeam = teams.find(t => t.id === (isHome ? f.team_a : f.team_h));
        return {
          event: f.event,
          opponent: oppTeam ? oppTeam.short_name : "TBD",
          difficulty: isHome ? f.team_h_difficulty : f.team_a_difficulty,
          is_home: isHome
        };
      });

    return {
      ...p,
      position,
      team_name: team?.name || "Unknown",
      team_short_name: team?.short_name || "UNK",
      score: this.calculatePlayerScore(baseXp, p, riskMode, fuel, fixtures, nextEventId),
      xP: baseXp,
      ppm: (p.total_points || 0) / (p.now_cost / 10),
      next_fixtures: next3Fix,
      isCaptain: false,
      isViceCaptain: false
    };
  }

  static computeSwapAnalysis(safeXI: ScoredPlayer[], riskyXI: ScoredPlayer[]) {
    const safeIds = new Set(safeXI.map(p => p.id));
    const riskyIds = new Set(riskyXI.map(p => p.id));

    const replacedOut = safeXI.filter(p => !riskyIds.has(p.id));
    const broughtIn = riskyXI.filter(p => !safeIds.has(p.id));

    const swaps: Array<{
      outPlayer: string;
      inPlayer: string;
      position: string;
      xpSacrifice8GW: number;
      xpSacrificePerGw: number;
      eoReduction: number;
    }> = [];

    const unusedIn = [...broughtIn];
    for (const outP of replacedOut) {
      const inIdx = unusedIn.findIndex(p => p.position === outP.position);
      const inP = inIdx >= 0 ? unusedIn.splice(inIdx, 1)[0] : unusedIn.shift();
      if (!inP) continue;

      const outXp8 = outP.horizonXP || (outP.xP * 8);
      const inXp8 = inP.horizonXP || (inP.xP * 8);
      const xpSacrifice8GW = Math.round((outXp8 - inXp8) * 10) / 10;
      const xpSacrificePerGw = Math.round((xpSacrifice8GW / 8) * 100) / 100;
      const eoReduction = Math.round(((outP.eo || 0) - (inP.eo || 0)) * 10) / 10;

      swaps.push({
        outPlayer: `${outP.web_name} (${outP.team_short_name})`,
        inPlayer: `${inP.web_name} (${inP.team_short_name})`,
        position: outP.position,
        xpSacrifice8GW,
        xpSacrificePerGw,
        eoReduction
      });
    }

    const swapCount = swaps.length;
    const totalXpSacrificed8GW = Math.round(swaps.reduce((sum, s) => sum + s.xpSacrifice8GW, 0) * 10) / 10;
    const avgSwapCostPerGw = swapCount > 0 ? Math.round((totalXpSacrificed8GW / swapCount / 8) * 100) / 100 : 0;
    const avgEoReduction = swapCount > 0 ? Math.round((swaps.reduce((sum, s) => sum + s.eoReduction, 0) / swapCount) * 10) / 10 : 0;

    const withinThresholdCount = swaps.filter(s => s.xpSacrificePerGw <= 0.35).length;
    const withinThresholdPct = swapCount > 0 ? Math.round((withinThresholdCount / swapCount) * 100) : 100;

    let divergenceTier: 'LOW_DIVERGENCE_WARNING' | 'HEALTHY_DIFFERENTIAL' | 'HIGH_DIVERGENCE_WARNING' = 'HEALTHY_DIFFERENTIAL';
    if (swapCount <= 1) divergenceTier = 'LOW_DIVERGENCE_WARNING';
    else if (swapCount > 6) divergenceTier = 'HIGH_DIVERGENCE_WARNING';

    const differentialQuality: 'PASS' | 'WARNING' = withinThresholdPct >= 75 ? 'PASS' : 'WARNING';

    return {
      swapCount,
      divergenceTier,
      totalXpSacrificed8GW,
      avgSwapCostPerGw,
      avgEoReduction,
      withinThresholdCount,
      withinThresholdPct,
      differentialQuality,
      swaps
    };
  }

  static async getRecommendations(
    riskMode: string, 
    budget: number = 1000, 
    tier: string = 'free', 
    fuel: string = 'fplform',
    scenario: 'quant' | 'template' = 'quant',
    lockedPlayerIds: number[] = [],
    excludedPlayerIds: number[] = [],
    targetGw?: number,
    skipComparison: boolean = false
  ): Promise<RecommendationResponse> {
    const hasCustomConstraints = (lockedPlayerIds && lockedPlayerIds.length > 0) || (excludedPlayerIds && excludedPlayerIds.length > 0);
    const cacheKey = `${riskMode}_${fuel}_${scenario}_${budget}_${tier}_${targetGw || 'auto'}_${skipComparison}`;

    if (!hasCustomConstraints) {
      const cached = this.recCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp < this.REC_CACHE_TTL)) {
        return JSON.parse(JSON.stringify(cached.data));
      }
    }

    // For eye-test mode, skip FPL API call and use CSV data only
    let players: any[] = [];
    let teams: any[] = [];
    let fixtures: any[] = [];
    let nextEventId = targetGw || 1;

    try {
      const baseData = await this.getBaseData();
      players = baseData.players;
      teams = baseData.teams;
      fixtures = baseData.fixtures;
      if (!targetGw) {
        nextEventId = baseData.nextEventId;
      }
    } catch (err: any) {
      console.error('[FPLService] Failed to fetch FPL API data:', err.message);
      if (!this.cache) {
        throw new Error('FPL API unavailable. Please try again later.');
      }
    }

    // Dynamically load the fuel source (fplform scraped vs native FPL API)
    let csvFileName = fuel === 'native' ? 'fpl_native.csv' : 'fplform.csv';
    
    // Fallback: if FPLFORM file is corrupted/empty, use NATIVE as backup temporarily
    if (fuel !== 'native' && fuel !== 'eye-test' && fuel !== 'eyetest') {
      const fplformPath = path.resolve(process.cwd(), 'data', 'fplform.csv');
      if (fs.existsSync(fplformPath)) {
        const content = fs.readFileSync(fplformPath, 'utf8');
        if (content.includes('Arsenal, ARS') || content.split('\n').length < 100) {
          console.warn('[FPLService] FPLFORM data appears corrupted, temporarily using NATIVE fallback');
          csvFileName = 'fpl_native.csv';
        }
      }
    }
    
    const fixturesFilePath = undefined;
    const oraclePlayers = players; 
    const oracleTeams = teams; 
    const oracleFixtures = fixtures; 
    const oracle = OracleFactory.create(`data/${csvFileName}`, oraclePlayers, fuel, oracleFixtures, oracleTeams, nextEventId, riskMode, fixturesFilePath);

    let scored: ScoredPlayer[] = [];
    
    const available = players.filter(p => p.status === 'a' || p.chance_of_playing_next_round === 100);
    scored = available.map(p => {
      const baseXp = oracle.getXP(p.id, nextEventId);
      let horizonXP = 0;
      for (let step = 0; step < 8; step++) {
        horizonXP += oracle.getXP(p.id, nextEventId + step);
      }
      const mapped = this.mapToScoredPlayer(p, teams, fixtures, nextEventId, riskMode, baseXp, fuel);
      mapped.horizonXP = horizonXP;
      mapped.eo = oracle.getTop1kEO?.(p.id) ?? 0;
      mapped.ownership = oracle.getTop1kOwnership?.(p.id) ?? parseFloat(p.selected_by_percent || "0") ?? 0;
      return mapped;
    });

    let squad: ScoredPlayer[] = [];
    let isHeuristicFallback = false;
    const sortByScore = (a: ScoredPlayer, b: ScoredPlayer) => (b.xP || 0) - (a.xP || 0);
    const sortByUtility = (a: ScoredPlayer, b: ScoredPlayer) => (b.score || 0) - (a.score || 0);

    const lockedSet = new Set<number>(lockedPlayerIds);
    const excludedSet = new Set<number>(excludedPlayerIds);

    // Pure dynamic template anchor selection (100% dynamic, 0% heuristics)
    // Anchors top EO/ownership consensus asset per line (DEF, MID, FWD)
    // plus any consensus premium asset (cost >= 110, ownership/EO >= 40%) representing asymmetric captaincy risk
    const selectPureDynamicAnchors = (scoredList: ScoredPlayer[]): number[] => {
      const active = scoredList.filter(p => ((p.eo && p.eo >= 30) || (p.ownership && p.ownership >= 30)) && (p.xP || 0) >= 3.0);

      const defs = active.filter(p => p.position === 'DEF').sort((a, b) => (b.eo || b.ownership || 0) - (a.eo || a.ownership || 0));
      const mids = active.filter(p => p.position === 'MID').sort((a, b) => (b.eo || b.ownership || 0) - (a.eo || a.ownership || 0));
      const fwds = active.filter(p => p.position === 'FWD').sort((a, b) => (b.eo || b.ownership || 0) - (a.eo || a.ownership || 0));

      const anchors: ScoredPlayer[] = [];
      if (defs.length > 0) anchors.push(defs[0]);
      if (mids.length > 0) anchors.push(mids[0]);
      if (fwds.length > 0) anchors.push(fwds[0]);

      const premiums = active.filter(p => Number(p.cost || p.now_cost || 0) >= 110 && ((p.eo && p.eo >= 40) || (p.ownership && p.ownership >= 40)));
      for (const prem of premiums) {
        if (!anchors.some(a => a.id === prem.id) && anchors.length < 4) {
          anchors.push(prem);
        }
      }

      return anchors.map(a => a.id);
    };

    const templateAnchorIds = selectPureDynamicAnchors(scored);

    const params = getParamsForRiskMode(riskMode, baseWeights, scenario);
    const effectiveBudget = budget * (params.budgetMultiplier || 1.0);

    const activeLockedSet = new Set<number>(lockedSet);
    if (scenario === 'template') {
      let currentLockedCost = Array.from(activeLockedSet).reduce((sum: number, id: number) => {
        const p = scored.find(x => x.id === id);
        return sum + Number(p?.cost || 0);
      }, 0);

      templateAnchorIds.forEach(id => {
        if (excludedSet.has(id)) return;
        const p = scored.find(x => x.id === id);
        if (!p) return;
        
        const pCost = Number(p.cost || p.now_cost || 0);
        const newCount = activeLockedSet.size + 1;
        const remainingSlots = Math.max(0, 15 - newCount);
        const minRemainingCost = remainingSlots * 42; // Minimum ~4.2m per remaining slot

        if (currentLockedCost + pCost + minRemainingCost <= effectiveBudget) {
          activeLockedSet.add(id);
          currentLockedCost += pCost;
        }
      });
    }

    const availableIds = new Set<number>(scored.map(p => p.id));

    // Helper to build 11-man starting XI from 15-man squad using dynamic utility solver
    const buildStartingXI = (squadList: ScoredPlayer[], targetParams = params) => {
      const squadIds = squadList.map(p => p.id);
      try {
        const xiIds = solveStartingXI(oracle, nextEventId, squadIds, targetParams);
        const xiIdSet = new Set(xiIds);
        const starters = squadList.filter(p => xiIdSet.has(p.id));
        if (starters.length === 11) {
          return starters;
        }
      } catch (err: any) {
        console.warn("[FPLService] solveStartingXI fallback to utility score sort:", err?.message || err);
      }
      // Failsafe: sort by utility score (which incorporates EO and risk weights)
      const g = squadList.filter(p => p.position === "GKP").sort(sortByUtility);
      const d = squadList.filter(p => p.position === "DEF").sort(sortByUtility);
      const m = squadList.filter(p => p.position === "MID").sort(sortByUtility);
      const f = squadList.filter(p => p.position === "FWD").sort(sortByUtility);
      const mand = [g[0], ...d.slice(0, 3), ...m.slice(0, 2), ...f.slice(0, 1)].filter(Boolean) as ScoredPlayer[];
      const remaining = [...d.slice(3), ...m.slice(2), ...f.slice(1)].sort(sortByUtility);
      return [...mand, ...remaining.slice(0, 4)].filter(Boolean) as ScoredPlayer[];
    };

    try {
      const optimalIds = solveOptimalSquad(oracle, nextEventId, budget, 8, params, availableIds, activeLockedSet, excludedSet);
      if (!optimalIds || optimalIds.length === 0) {
        throw new Error("LP Solver returned empty or infeasible solution.");
      }
      squad = scored.filter(p => optimalIds.includes(p.id));
    } catch (err: any) {
      console.warn("[FPLService] LP Solver failed with full template anchors, attempting progressive fallback:", err.message);
      try {
        // Progressive fallback: Retain top 2 anchors (highest EO captaincy anchors like Haaland/Bruno) before discarding all
        const top2Anchors = new Set([...Array.from(activeLockedSet).slice(0, Math.min(activeLockedSet.size, 2)), ...Array.from(lockedSet)]);
        let fallbackIds = solveOptimalSquad(oracle, nextEventId, budget, 8, params, availableIds, top2Anchors, excludedSet);
        if (!fallbackIds || fallbackIds.length === 0) {
          fallbackIds = solveOptimalSquad(oracle, nextEventId, budget, 8, params, availableIds, lockedSet, excludedSet);
        }
        if (!fallbackIds || fallbackIds.length === 0) throw new Error("Fallback LP solver also infeasible");
        squad = scored.filter(p => fallbackIds.includes(p.id));
      } catch (fallbackErr) {
        console.warn("[FPLService] Fallback LP Solver failed, using heuristic selection:", err.message);
        isHeuristicFallback = true;
        const gkps = scored.filter(p => p.position === 'GKP').sort(sortByScore).slice(0, 2);
        const defs = scored.filter(p => p.position === 'DEF').sort(sortByScore).slice(0, 5);
        const mids = scored.filter(p => p.position === 'MID').sort(sortByScore).slice(0, 5);
        const fwds = scored.filter(p => p.position === 'FWD').sort(sortByScore).slice(0, 3);
        squad = [...gkps, ...defs, ...mids, ...fwds];
      }
    }
    
    const startingXI = buildStartingXI(squad, params);
    const startingIds = new Set(startingXI.map(p => p.id));
    const bench = squad.filter(p => !startingIds.has(p.id)).sort((a, b) => {
      if (a.position === 'GKP' && b.position !== 'GKP') return -1;
      if (a.position !== 'GKP' && b.position === 'GKP') return 1;
      return (b.score || b.xP || 0) - (a.score || a.xP || 0);
    });

    // Assign position_in_squad (1-11 for starters, 12-15 for bench) so all downstream UI views stay in sync
    startingXI.forEach((p, idx) => { p.position_in_squad = idx + 1; });
    bench.forEach((p, idx) => { p.position_in_squad = 12 + idx; });
      
    const startingIdsArr = Array.from(startingIds);
    const { captain: captainId, viceCaptain: vcId } = solveCaptain(
      oracle, 
      nextEventId, 
      startingIdsArr, 
      params
    );

    const captain = startingXI.find(p => p.id === captainId) || startingXI[0] || null;
    const viceCaptain = startingXI.find(p => p.id === vcId && p.id !== captainId) || startingXI[1] || null;

    if (captain) {
      const squadPlayer = squad.find(p => p.id === captain.id);
      if (squadPlayer) squadPlayer.isCaptain = true;
    }
    if (viceCaptain) {
      const squadPlayer = squad.find(p => p.id === viceCaptain.id);
      if (squadPlayer) squadPlayer.isViceCaptain = true;
    }

    const averageXiEo = startingXI.length > 0 
      ? startingXI.reduce((sum, p) => sum + (p.eo || 0), 0) / startingXI.length 
      : 0;
    const horizonTotalXp = startingXI.reduce((sum, p) => sum + (p.horizonXP || p.xP * 8 || 0), 0);

    // Pillar 1: Compute Scenario Comparison (Quant Optimum vs Template Shield)
    let scenarioComparison = undefined;
    if (!skipComparison) {
      try {
        const quantParams = getParamsForRiskMode(riskMode, baseWeights, 'quant');
        const templateParams = getParamsForRiskMode(riskMode, baseWeights, 'template');
        const templateEffectiveBudget = budget * (templateParams.budgetMultiplier || 1.0);

        // Solve Quant
        const quantIds = solveOptimalSquad(oracle, nextEventId, budget, 8, quantParams, availableIds, lockedSet, excludedSet);
        const quantSquad = scored.filter(p => quantIds.includes(p.id));
        const quantXI = buildStartingXI(quantSquad, quantParams);
        const { captain: qCapId } = solveCaptain(oracle, nextEventId, quantXI.map(p => p.id), quantParams);
        const quantCap = quantXI.find(p => p.id === qCapId) || quantXI[0];
        const quantXp = Math.round((quantXI.reduce((sum, p) => sum + (p.xP || 0), 0) + (quantCap?.xP || 0)) * 10) / 10;
        const quantEo = quantXI.length > 0 ? Math.round((quantXI.reduce((sum, p) => sum + (p.eo || 0), 0) / quantXI.length) * 10) / 10 : 0;

        // Solve Template Shield
        const templateSet = new Set<number>(lockedSet);
        let currentTemplateCost = Array.from(templateSet).reduce((sum: number, id: number) => {
          const p = scored.find(x => x.id === id);
          return sum + Number(p?.cost || 0);
        }, 0);

        templateAnchorIds.forEach(id => {
          if (excludedSet.has(id)) return;
          const p = scored.find(x => x.id === id);
          if (!p) return;

          const pCost = Number(p.cost || p.now_cost || 0);
          const newCount = templateSet.size + 1;
          const remainingSlots = Math.max(0, 15 - newCount);
          const minRemainingCost = remainingSlots * 42;

          if (currentTemplateCost + pCost + minRemainingCost <= templateEffectiveBudget) {
            templateSet.add(id);
            currentTemplateCost += pCost;
          }
        });
        let templateIds = solveOptimalSquad(oracle, nextEventId, budget, 8, templateParams, availableIds, templateSet, excludedSet);
        if (!templateIds || templateIds.length === 0) {
          templateIds = solveOptimalSquad(oracle, nextEventId, budget, 8, templateParams, availableIds, lockedSet, excludedSet);
        }
        const templateSquad = scored.filter(p => templateIds.includes(p.id));
        const templateXI = buildStartingXI(templateSquad, templateParams);
        const { captain: tCapId } = solveCaptain(oracle, nextEventId, templateXI.map(p => p.id), templateParams);
        const templateCap = templateXI.find(p => p.id === tCapId) || templateXI[0];
        const templateXp = Math.round((templateXI.reduce((sum, p) => sum + (p.xP || 0), 0) + (templateCap?.xP || 0)) * 10) / 10;
        const templateEo = templateXI.length > 0 ? Math.round((templateXI.reduce((sum, p) => sum + (p.eo || 0), 0) / templateXI.length) * 10) / 10 : 0;

        const quantXIIds = new Set(quantXI.map(p => p.id));
        const templateXIIds = new Set(templateXI.map(p => p.id));
        const outFromQuant = quantXI.filter(p => !templateXIIds.has(p.id));
        const inToTemplate = templateXI.filter(p => !quantXIIds.has(p.id));

        const scenarioSwaps: Array<{
          outPlayer: string;
          inPlayer: string;
          position: string;
          xpDiff: number;
          eoDiff: number;
        }> = [];

        for (const outP of outFromQuant) {
          const matchingIn = inToTemplate.find(p => p.position === outP.position) || inToTemplate[0];
          if (matchingIn) {
            scenarioSwaps.push({
              outPlayer: `${outP.web_name} (${outP.team_short_name})`,
              inPlayer: `${matchingIn.web_name} (${matchingIn.team_short_name})`,
              position: outP.position,
              xpDiff: Math.round(((matchingIn.xP || 0) - (outP.xP || 0)) * 10) / 10,
              eoDiff: Math.round(((matchingIn.eo || 0) - (outP.eo || 0)) * 10) / 10
            });
          }
        }

        scenarioComparison = {
          quant: {
            name: 'Quant Optimum',
            totalXp: quantXp,
            averageEo: quantEo,
            captain: {
              name: quantCap.web_name,
              team: quantCap.team_short_name,
              xP: quantCap.xP || 0
            }
          },
          template: {
            name: 'Template Shield',
            totalXp: templateXp,
            averageEo: templateEo,
            captain: {
              name: templateCap.web_name,
              team: templateCap.team_short_name,
              xP: templateCap.xP || 0
            }
          },
          delta: {
            xpDiff: Math.round((templateXp - quantXp) * 10) / 10,
            eoDiff: Math.round((templateEo - quantEo) * 10) / 10,
            swaps: scenarioSwaps
          }
        };
      } catch (e) {
        // ignore scenario solve errors
      }
    }

    // Pillar 3: "Why Omitted?" Analysis for high-profile assets
    const omissionAnalysis: any[] = [];
    try {
      const startingXIIds = new Set(startingXI.map(p => p.id));
      const notableOmissions = scored.filter(p => 
        !startingXIIds.has(p.id) && 
        ((p.eo && p.eo >= 50) || p.now_cost >= 120)
      ).sort((a, b) => (b.eo || 0) - (a.eo || 0)).slice(0, 8);

      for (const omitted of notableOmissions) {
        const costDiff = (omitted.now_cost || 0);
        const startersInSameOrFunded = startingXI
          .filter(p => (p.now_cost || 0) <= costDiff && p.id !== omitted.id)
          .sort((a, b) => ((b.xP || 0) / ((b.now_cost || 10)/10)) - ((a.xP || 0) / ((a.now_cost || 10)/10)))
          .slice(0, 2);

        const replacementXpSum = startersInSameOrFunded.reduce((sum, p) => sum + (p.xP || 0), 0);
        const netGain = Math.round((replacementXpSum - (omitted.xP || 0)) * 10) / 10;
        
        const fundedNames = startersInSameOrFunded.map(p => `${p.web_name} (£${((p.now_cost || 0)/10).toFixed(1)}m, ${p.xP?.toFixed(1)} xP)`).join(' + ');

        omissionAnalysis.push({
          omittedPlayer: {
            id: omitted.id,
            name: omitted.web_name,
            cost: (omitted.now_cost || 0) / 10,
            xP: omitted.xP || 0,
            eo: omitted.eo || 0
          },
          replacementPlayers: startersInSameOrFunded.map(p => ({
            id: p.id,
            name: p.web_name,
            cost: (p.now_cost || 0) / 10,
            xP: p.xP || 0
          })),
          netXpGain: netGain,
          explanation: `The optimizer evaluated ${omitted.web_name} (${omitted.xP?.toFixed(1)} xP @ £${((omitted.now_cost || 0)/10).toFixed(1)}m) vs. reallocating funds into ${fundedNames}. The squad-wide redistribution yields +${netGain} net xP across the XI while respecting Safe Mode EO guardrails.`
        });
      }
    } catch (err) {
      // ignore omission calculation error
    }

    let swapAnalysisResult = undefined;
    if (riskMode !== 'safe') {
      try {
        const safeParams = getParamsForRiskMode('safe', baseWeights);
        const safeOptimalIds = solveOptimalSquad(oracle, nextEventId, budget, 8, safeParams, availableIds);
        if (safeOptimalIds && safeOptimalIds.length > 0) {
          const safeSquad = scored.filter(p => safeOptimalIds.includes(p.id));
          const safeXI = buildStartingXI(safeSquad, safeParams);
          swapAnalysisResult = this.computeSwapAnalysis(safeXI, startingXI);
        }
      } catch (err) {
        // ignore baseline safe solve errors
      }
    }

    const totalXpWithCaptain = Math.round((startingXI.reduce((sum, p) => sum + (p.xP || 0), 0) + (captain?.xP || 0)) * 10) / 10;

    const response: RecommendationResponse = { 
      squad, 
      startingXI, 
      bench,
      captain,
      viceCaptain,
      expectedPoints: totalXpWithCaptain,
      totalCost: squad.reduce((sum, p) => sum + (p.now_cost || 0), 0),
      isHeuristicFallback,
      activeScenario: scenario,
      lockedPlayerIds,
      excludedPlayerIds,
      engineDiagnostics: {
        budgetUsed: squad.reduce((sum, p) => sum + (p.now_cost || 0), 0),
        budgetLimit: budget,
        riskMode: riskMode,
        solverStatus: isHeuristicFallback ? 'heuristic_fallback' : 'optimal',
        activeConstraints: {
          minEoTotal: params.minEoTotal || 0,
          minElitePlayers: params.minElitePlayers || 0,
          lockedCount: lockedPlayerIds.length,
          excludedCount: excludedPlayerIds.length
        },
        metrics: {
          averageXiEo: Math.round(averageXiEo * 10) / 10,
          horizonTotalXp: Math.round(horizonTotalXp * 10) / 10,
          swapAnalysis: swapAnalysisResult,
          scenarioComparison,
          omissionAnalysis
        }
      },
      topPicks: {
        gkp: scored.filter(p => p.position === "GKP").sort(sortByUtility).slice(0, 5),
        def: scored.filter(p => p.position === "DEF").sort(sortByUtility).slice(0, 5),
        mid: scored.filter(p => p.position === "MID").sort(sortByUtility).slice(0, 5),
        fwd: scored.filter(p => p.position === "FWD").sort(sortByUtility).slice(0, 5)
      },
      nextEventId,
      lastUpdated: Date.now()
    };

    if (!hasCustomConstraints) {
      this.recCache.set(cacheKey, { data: response, timestamp: Date.now() });
      if (this.recCache.size > 50) {
        const oldestKey = this.recCache.keys().next().value;
        if (oldestKey) this.recCache.delete(oldestKey);
      }
    }

    return response;
  }

  static calculateStrategicScore(rec: TransferRecommendation): number {
    const localSignal = rec.localTransferSignal || (rec.xPDelta || 0);
    const horizonDelta = rec.horizon8GwDelta || 0;
    const priceDiff = ((rec.out?.now_cost || 0) - (rec.in?.now_cost || 0)) / 10;
    const financialBonus = priceDiff > 0 ? priceDiff * 0.75 : 0;
    
    // Dead capital bonus: if outPlayer has virtually no expected return over 8 weeks (<= 2.0 pts)
    const isDeadWeight = (rec.horizon8GwXpOut || 0) <= 2.0;
    const deadWeightBonus = isDeadWeight ? 1.5 : 0;
    
    return Math.round((localSignal + (0.35 * horizonDelta) + financialBonus + deadWeightBonus) * 10) / 10;
  }

  static generateTransfers(squad: ScoredPlayer[], candidates: ScoredPlayer[], oracle: XPOracle, riskMode: string, gameweek: number, bank: number = 0): TransferRecommendation[] {
    const transfers: TransferRecommendation[] = [];
    const squadIds = new Set(squad.map(p => p.id));
    const params = getParamsForRiskMode(riskMode, baseWeights);
    const enableDiversification = params.enableDefensiveDiversification !== false;
    const maxStandardDef = params.maxStandardDefendersPerTeam ?? 1;
    const maxEliteDef = params.maxEliteDefendersPerTeam ?? 2;
    const elitePercentile = params.eliteDefensePercentile ?? 0.80;
    const eliteTeams = oracle.getEliteDefensiveTeams?.(elitePercentile) ?? new Set<string>();

    // Build team count map for 3-player-per-club constraint
    const squadTeamCounts: Record<number, number> = {};
    squad.forEach(p => { squadTeamCounts[p.team] = (squadTeamCounts[p.team] || 0) + 1; });

    const get8GwXp = (id: number) => {
      let sum = 0;
      for (let step = 0; step < 8; step++) {
        sum += oracle.getXP(id, gameweek + step);
      }
      return Math.round(sum * 10) / 10;
    };

    const squad8GwXpBefore = Math.round(
      squad.reduce((sum, p) => sum + get8GwXp(p.id), 0) * 10
    ) / 10;

    squad.forEach(outPlayer => {
      const betterOptions = candidates.filter(p => {
        // Enforce strict position equality: GKP with GKP, DEF with DEF, etc.
        if (p.position !== outPlayer.position) return false;
        if (squadIds.has(p.id)) return false;
        // Enforce budget affordability with available bank
        if (p.now_cost > outPlayer.now_cost + bank) return false;
        if ((p.score || 0) <= (outPlayer.score || 0) + 0.5) return false;
        // Enforce 3-player-per-club: count how many from inPlayer's team remain after removing outPlayer
        const teamCountAfterRemoval = (squadTeamCounts[p.team] || 0) - (p.team === outPlayer.team ? 1 : 0);
        if (teamCountAfterRemoval >= 3) return false;

        // Enforce dynamic defensive diversification: max 1 per standard club, max 2 per elite defense
        if (enableDiversification && p.position === 'DEF') {
          const inTeamShort = p.team_short_name;
          const currentDefCount = squad.filter(sp => sp.position === 'DEF' && sp.team_short_name === inTeamShort).length;
          const defCountAfterRemoval = currentDefCount - (outPlayer.position === 'DEF' && outPlayer.team_short_name === inTeamShort ? 1 : 0);
          const maxAllowed = eliteTeams.has(inTeamShort) ? maxEliteDef : maxStandardDef;
          if (defCountAfterRemoval >= maxAllowed) return false;
        }

        return true;
      }).sort((a, b) => (b.score || 0) - (a.score || 0));

      if (betterOptions.length > 0) {
        const inPlayer = betterOptions[0];
        const inVar = oracle.getVariance(inPlayer.id, gameweek);
        const outVar = oracle.getVariance(outPlayer.id, gameweek);
        const inEO = oracle.getTop1kEO?.(inPlayer.id) ?? 0;
        const outEO = oracle.getTop1kEO?.(outPlayer.id) ?? 0;
        const transferUtilityDelta = (inPlayer.xP - outPlayer.xP) - params.betaVariance * (inVar - outVar) + params.betaEO * (inEO - outEO);
        const xPDelta = inPlayer.xP - outPlayer.xP;

        const horizon8GwXpIn = get8GwXp(inPlayer.id);
        const horizon8GwXpOut = get8GwXp(outPlayer.id);
        const horizon8GwDelta = Math.round((horizon8GwXpIn - horizon8GwXpOut) * 10) / 10;
        const squad8GwXpAfter = Math.round((squad8GwXpBefore + horizon8GwDelta) * 10) / 10;

        const rec: TransferRecommendation = { 
          out: outPlayer, 
          in: inPlayer, 
          localTransferSignal: transferUtilityDelta, 
          xPDelta,
          horizon8GwXpIn,
          horizon8GwXpOut,
          horizon8GwDelta,
          squad8GwXpBefore,
          squad8GwXpAfter
        };
        rec.strategicScore = FPLService.calculateStrategicScore(rec);
        transfers.push(rec);
      }
    });
    return transfers.sort((a, b) => {
      const deltaDiff = (b.horizon8GwDelta ?? 0) - (a.horizon8GwDelta ?? 0);
      if (Math.abs(deltaDiff) > 0.05) return deltaDiff;
      return (b.strategicScore ?? b.xPDelta ?? 0) - (a.strategicScore ?? a.xPDelta ?? 0);
    }).slice(0, 5);
  }

  static generateChipAdvice(squad: ScoredPlayer[], riskMode: string): ChipAdvice[] {
    const avgScore = squad.reduce((sum, p) => sum + (p.score || 0), 0) / (squad.length || 1);
    const topPlayer = [...squad].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const isRisky = riskMode === 'aggressive';

    return [
      {
        chip: "Wildcard",
        recommendation: (isRisky && avgScore < 5.0) || avgScore < 4.0 ? "STRONG BUY" : "HOLD",
        reason: isRisky && avgScore < 5.0 
          ? "Strategic Overhaul: Your squad is falling behind the differential curve. Wildcard to attack the leaderboard."
          : "Your squad has solid projected points. Save it."
      },
      {
        chip: "Free Hit",
        recommendation: isRisky && avgScore < 4.5 ? "STRONG BUY" : "HOLD",
        reason: isRisky && avgScore < 4.5 
          ? "One-Week Strike: Use your Free Hit to target specific high-upside matchups while keeping your core team intact."
          : "Save your Free Hit for upcoming Blank or Double Gameweeks."
      },
      {
        chip: "Bench Boost",
        recommendation: "AVOID",
        reason: "Wait for a Double Gameweek where your bench players have two fixtures."
      },
      {
        chip: "Triple Captain",
        recommendation: isRisky && topPlayer && topPlayer.score > 12 && topPlayer.selected_by_percent && parseFloat(topPlayer.selected_by_percent) < 10 ? "STRONG BUY" : "HOLD",
        reason: isRisky && topPlayer && topPlayer.score > 12 && topPlayer.selected_by_percent && parseFloat(topPlayer.selected_by_percent) < 10
          ? `High-Risk Gamble: ${topPlayer.web_name} is an elite differential with a massive ceiling this week. Go for the kill.`
          : "Save your Triple Captain for a premium asset with a highly favorable Double Gameweek."
      }
    ];
  }

  static async syncTeam(teamId: string, riskMode: string, tier: string = 'free', fuel: string = 'fplform', targetGw?: number): Promise<TeamSyncResponse> {
    const baseData = await this.getBaseData();
    const currentEvent = targetGw ? targetGw : (baseData.currentEventId || Math.max(1, baseData.nextEventId - 1));
    
    // 1. Initialize the V3 Engine Oracle first based on selected fuel
    const csvFileName = fuel === 'native' ? 'fpl_native.csv' : 'fplform.csv';
    const oracle = OracleFactory.create(`data/${csvFileName}`, baseData.players, fuel, baseData.fixtures, baseData.teams, baseData.nextEventId, riskMode);

    // 2. Fetch live user team & manager metadata (cached in-memory for 2 mins)
    const picksCacheKey = `team_${teamId}_gw_${currentEvent}`;
    let teamRes: any;
    let managerInfo: ManagerInfo | null = null;

    const cachedPicks = this.teamPicksCache.get(picksCacheKey);
    if (cachedPicks && Date.now() - cachedPicks.timestamp < this.TEAM_PICKS_CACHE_TTL) {
      teamRes = cachedPicks.teamRes;
      managerInfo = cachedPicks.managerInfo;
    } else {
      try {
        const [picksRes, entryRes] = await Promise.allSettled([
          this.fetchWithRetry(`${FPL_BASE_URL}/entry/${teamId}/event/${currentEvent}/picks/`),
          this.fetchWithRetry(`${FPL_BASE_URL}/entry/${teamId}/`)
        ]);

        if (picksRes.status === 'fulfilled' && picksRes.value?.data?.picks && Array.isArray(picksRes.value.data.picks)) {
          teamRes = picksRes.value;
        } else {
          const err: any = (picksRes as any).reason || (picksRes as any).value?.data;
          const status = err?.response?.status || err?.status;
          if (status === 404) {
            throw new Error(`FPL API Error: Team ID ${teamId} not found, or squads are currently locked and hidden by FPL until the Gameweek 1 deadline.`);
          }
          if (status === 403) {
            throw new Error(`FPL API Error: The official Fantasy Premier League API is temporarily rate-limiting requests (403 Forbidden). Please wait a moment and try again.`);
          }
          throw new Error(`FPL API Error: Could not retrieve team picks for Team ID ${teamId}. ${err?.message || 'Please try again shortly.'}`);
        }

        if (entryRes.status === 'fulfilled' && entryRes.value?.data) {
          const d = entryRes.value.data;
          managerInfo = {
            id: d.id,
            teamName: d.name || 'FPL Team',
            managerName: `${d.player_first_name || ''} ${d.player_last_name || ''}`.trim(),
            summary_overall_rank: d.summary_overall_rank,
            summary_overall_points: d.summary_overall_points,
            summary_event_points: d.summary_event_points,
            summary_event_rank: d.summary_event_rank,
            last_deadline_total_transfers: d.last_deadline_total_transfers
          };
        }

        this.teamPicksCache.set(picksCacheKey, { teamRes, managerInfo, timestamp: Date.now() });
        if (this.teamPicksCache.size > 100) {
          const oldest = this.teamPicksCache.keys().next().value;
          if (oldest) this.teamPicksCache.delete(oldest);
        }
      } catch (err: any) {
        if (err.message && err.message.includes('FPL API Error')) {
          throw err;
        }
        throw new Error(`FPL Sync Error: ${err.message || 'Could not retrieve team data'}`);
      }
    }

    if (!teamRes?.data?.picks || !Array.isArray(teamRes.data.picks)) {
      throw new Error(`FPL Sync Error: No squad picks available for Team ID ${teamId}. Please verify your Team ID or try syncing again.`);
    }

    const myPicks = teamRes.data.picks.map((p: any) => {
      const player = baseData.players.find((pl: any) => pl.id === p.element);
      if (!player) return null;
      const baseXp = oracle.getXP(player.id, baseData.nextEventId);
      const baseMapped = this.mapToScoredPlayer(player, baseData.teams, baseData.fixtures, baseData.nextEventId, riskMode, baseXp, fuel);
      return {
        ...baseMapped,
        eo: oracle.getTop1kEO?.(player.id) ?? 0,
        ownership: oracle.getTop1kOwnership?.(player.id) ?? parseFloat(player.selected_by_percent || "0") ?? 0,
        isCaptain: p.is_captain,
        isViceCaptain: p.is_vice_captain,
        position_in_squad: p.position,
        multiplier: p.multiplier
      };
    }).filter(Boolean) as ScoredPlayer[];

    const simulator = new Simulator(true); // Vercel mode = true
    
    const bank = teamRes.data.entry_history?.bank || 0;

    const purchasePrices: Record<number, number> = {};
    myPicks.forEach(p => {
      purchasePrices[p.id] = oracle.getCost(p.id) || 50;
    });

    const initialState = {
      squad: myPicks.map(p => p.id),
      bank, // Live bank value
      freeTransfers: 1, // Defaulting to 1 for live pull
      chipState: { 'WC': 1, 'BB': 1, 'TC': 1, 'FH': 1 }, // Assuming chips are available for testing
      gameweek: baseData.nextEventId,
      accumulatedScore: 0,
      purchasePrices
    };

    const params = getParamsForRiskMode(riskMode, baseWeights);

    // 3. Execute the Multi-Horizon Beam Search (Only for Grand Cru / Beta Pilot)
    let optimalFirstMove = 'ROLL';
    let bestFutures: any[] = [];
    
    if (tier === 'grandCru' || tier === 'aiAgent' || tier === 'betaPilot' || tier === 'admin') {
      console.log(`[V3 Engine] Executing Beam Search for Team ${teamId}...`);
      bestFutures = simulator.simulateHorizon(initialState, oracle, params);
      if (bestFutures.length > 0) {
        optimalFirstMove = bestFutures[0].firstAction || 'ROLL';
      }
    }

    const recommendations = await this.getRecommendations(riskMode, 1000, tier, fuel);
    const candidates = [
      ...recommendations.topPicks.gkp,
      ...recommendations.topPicks.def,
      ...recommendations.topPicks.mid,
      ...recommendations.topPicks.fwd
    ];

    let transfers: TransferRecommendation[] = [];
    
    const get8GwXp = (id: number) => {
      let sum = 0;
      for (let step = 0; step < 8; step++) {
        sum += oracle.getXP(id, baseData.nextEventId + step);
      }
      return Math.round(sum * 10) / 10;
    };

    const squad8GwXpBefore = Math.round(
      myPicks.reduce((sum, p) => sum + get8GwXp(p.id), 0) * 10
    ) / 10;

    // Only Strategy/GrandCru get optimal transfers
    if (tier !== 'free') {
      if (optimalFirstMove === 'TRANSFER' && bestFutures.length > 0 && bestFutures[0].firstTransfersIn && bestFutures[0].firstTransfersOut) {
        const ins = bestFutures[0].firstTransfersIn;
        const outs = bestFutures[0].firstTransfersOut;
        const params = getParamsForRiskMode(riskMode, baseWeights);
        // Build team count map for 3-player-per-club constraint in LP transfers
        const lpTeamCounts: Record<number, number> = {};
        myPicks.forEach(p => { lpTeamCounts[p.team] = (lpTeamCounts[p.team] || 0) + 1; });

        // Match transfers In and Out strictly by position so each 1-for-1 swap is a valid FPL move
        const remainingIns = [...ins];
        for (const outId of outs) {
          const outPlayer = myPicks.find(p => p.id === outId);
          if (!outPlayer) continue;

          const outPos = outPlayer.position || (outPlayer.element_type === 1 ? 'GKP' : outPlayer.element_type === 2 ? 'DEF' : outPlayer.element_type === 3 ? 'MID' : 'FWD');
          const inIdx = remainingIns.findIndex(inId => {
            const p = baseData.players.find(x => x.id === inId);
            if (!p) return false;
            const pPos = p.element_type === 1 ? 'GKP' : p.element_type === 2 ? 'DEF' : p.element_type === 3 ? 'MID' : 'FWD';
            return pPos === outPos;
          });

          if (inIdx !== -1) {
            const inId = remainingIns.splice(inIdx, 1)[0];
            const inPlayer = baseData.players.find(p => p.id === inId);
            if (inPlayer) {
              const inPos = inPlayer.element_type === 1 ? 'GKP' : inPlayer.element_type === 2 ? 'DEF' : inPlayer.element_type === 3 ? 'MID' : 'FWD';
              if (inPos !== outPos) continue;

              // Enforce 3-player-per-club: skip if adding inPlayer would exceed 3 from same club
              const teamCountAfterRemoval = (lpTeamCounts[inPlayer.team] || 0) - (inPlayer.team === outPlayer.team ? 1 : 0);
              if (teamCountAfterRemoval >= 3) continue;

              // Enforce individual affordability for 1-for-1 execution
              if (inPlayer.now_cost > outPlayer.now_cost + bank) continue;

              const inXp = oracle.getXP(inPlayer.id, baseData.nextEventId);
              const inScored = FPLService.mapToScoredPlayer(inPlayer, baseData.teams, baseData.fixtures, baseData.nextEventId, riskMode, inXp, fuel);
              
              const inVar = oracle.getVariance(inPlayer.id, baseData.nextEventId);
              const outVar = oracle.getVariance(outPlayer.id, baseData.nextEventId);
              const inEO = oracle.getTop1kEO?.(inPlayer.id) ?? 0;
              const outEO = oracle.getTop1kEO?.(outPlayer.id) ?? 0;

              const transferUtilityDelta = (inScored.xP - outPlayer.xP) - params.betaVariance * (inVar - outVar) + params.betaEO * (inEO - outEO);
              const xPDelta = inScored.xP - outPlayer.xP;

              const horizon8GwXpIn = get8GwXp(inPlayer.id);
              const horizon8GwXpOut = get8GwXp(outPlayer.id);
              const horizon8GwDelta = Math.round((horizon8GwXpIn - horizon8GwXpOut) * 10) / 10;
              const squad8GwXpAfter = Math.round((squad8GwXpBefore + horizon8GwDelta) * 10) / 10;

              const rec: TransferRecommendation = {
                out: outPlayer,
                in: inScored,
                localTransferSignal: transferUtilityDelta,
                xPDelta,
                horizon8GwXpIn,
                horizon8GwXpOut,
                horizon8GwDelta,
                squad8GwXpBefore,
                squad8GwXpAfter
              };
              rec.strategicScore = FPLService.calculateStrategicScore(rec);
              transfers.push(rec);
            }
          }
        }
      }

      if (transfers.length === 0) {
        transfers = this.generateTransfers(myPicks, candidates, oracle, riskMode, baseData.nextEventId, bank);
      } else {
        // Append alternative independent swaps and rank the full pool by holistic strategic score
        const alternativeSwaps = this.generateTransfers(myPicks, candidates, oracle, riskMode, baseData.nextEventId, bank);
        
        const existingSwapSignatures = new Set(transfers.map(t => `${t.out.id}-${t.in.id}`));
        const allCandidates = [...transfers];
        
        const enableDiversification = params.enableDefensiveDiversification !== false;
        const maxStandardDef = params.maxStandardDefendersPerTeam ?? 1;
        const maxEliteDef = params.maxEliteDefendersPerTeam ?? 2;
        const elitePercentile = params.eliteDefensePercentile ?? 0.80;
        const eliteTeams = oracle.getEliteDefensiveTeams?.(elitePercentile) ?? new Set<string>();

        for (const swap of alternativeSwaps) {
          if (swap.in.position !== swap.out.position) continue;
          if (swap.in.now_cost > swap.out.now_cost + bank) continue;
          if (enableDiversification && swap.in.position === 'DEF') {
            const inTeam = swap.in.team_short_name;
            const currentDefs = myPicks.filter(p => p.position === 'DEF' && p.team_short_name === inTeam).length;
            const resultingDefs = currentDefs - (swap.out.position === 'DEF' && swap.out.team_short_name === inTeam ? 1 : 0) + 1;
            const maxAllowed = eliteTeams.has(inTeam) ? maxEliteDef : maxStandardDef;
            if (resultingDefs > maxAllowed) continue;
          }
          const sig = `${swap.out.id}-${swap.in.id}`;
          if (!existingSwapSignatures.has(sig)) {
            allCandidates.push(swap);
            existingSwapSignatures.add(sig);
          }
        }
        transfers = allCandidates
          .filter(t => {
            if (t.in.position !== t.out.position) return false;
            if (t.in.now_cost > t.out.now_cost + bank) return false;
            if (enableDiversification && t.in.position === 'DEF') {
              const inTeam = t.in.team_short_name;
              const currentDefs = myPicks.filter(p => p.position === 'DEF' && p.team_short_name === inTeam).length;
              const resultingDefs = currentDefs - (t.out.position === 'DEF' && t.out.team_short_name === inTeam ? 1 : 0) + 1;
              const maxAllowed = eliteTeams.has(inTeam) ? maxEliteDef : maxStandardDef;
              if (resultingDefs > maxAllowed) return false;
            }
            return true;
          })
          .sort((a, b) => {
            const deltaDiff = (b.horizon8GwDelta ?? 0) - (a.horizon8GwDelta ?? 0);
            if (Math.abs(deltaDiff) > 0.05) return deltaDiff;
            return (b.strategicScore ?? b.xPDelta ?? 0) - (a.strategicScore ?? a.xPDelta ?? 0);
          })
          .slice(0, 5);
      }
    }

    const targetEvent = baseData.nextEventId;
    const isSet1 = targetEvent <= 19;
    const remainingGwsInSet = isSet1 ? Math.max(0, 19 - targetEvent) : Math.max(0, 38 - targetEvent);
    const setHeader = isSet1 ? "Set 1 (GW1–19)" : "Set 2 (GW20–38)";

    const chips: ChipAdvice[] = [
      {
        chip: `Wildcard (${setHeader})`,
        recommendation: optimalFirstMove === 'WC' ? "STRONG BUY" : "HOLD",
        reason: optimalFirstMove === 'WC' 
          ? "V3 Engine recommends activating Wildcard to restructure your squad." 
          : isSet1 
            ? `Set 1 Wildcard expires at the GW19 deadline (${remainingGwsInSet} GWs left). Optimal window: GW6–GW8 during the international break.`
            : "Set 2 Wildcard active. Hold for major spring Double Gameweek preparation."
      },
      {
        chip: `Free Hit (${setHeader})`,
        recommendation: optimalFirstMove === 'FH' ? "STRONG BUY" : "HOLD",
        reason: optimalFirstMove === 'FH' 
          ? "V3 Engine recommends a Free Hit this week." 
          : isSet1 
            ? `Set 1 Free Hit expires at GW19 (${remainingGwsInSet} GWs left). Hold for an autumn fixture clash, European rotation, or postponement.`
            : "Set 2 Free Hit active. Hold for the major spring Blank Gameweek (GW29/30)."
      },
      {
        chip: `Bench Boost (${setHeader})`,
        recommendation: optimalFirstMove === 'BB' ? "STRONG BUY" : "HOLD",
        reason: optimalFirstMove === 'BB' 
          ? "V3 Engine detects extraordinary bench expected points (>= 15.0 xP). Play now!" 
          : isSet1 
            ? `Set 1 Bench Boost expires at GW19 (${remainingGwsInSet} GWs left). Optimal play: deploy immediately after your Wildcard when all 15 squad players are fit and starting.`
            : "Set 2 Bench Boost active. Save for the massive Double Gameweek (GW34/37)."
      },
      {
        chip: `Triple Captain (${setHeader})`,
        recommendation: optimalFirstMove === 'TC' ? "STRONG BUY" : "HOLD",
        reason: optimalFirstMove === 'TC' 
          ? "V3 Engine detects an elite captaincy outlier (>= 9.5 xP). Go for the kill!" 
          : isSet1 
            ? `Set 1 Triple Captain expires at GW19 (${remainingGwsInSet} GWs left; fresh TC arrives in GW20). Optimal window: Haaland vs Sunderland at Home (GW5) where projected xP is 11.2!`
            : "Set 2 Triple Captain active. Save for Haaland in a spring Double Gameweek."
      }
    ];

    const totalCost = myPicks.reduce((sum, p) => sum + (p.now_cost || 0), 0);

    const rawHistory = teamRes.data.entry_history;
    const entryHistory: EntryHistory | null = rawHistory ? {
      points: rawHistory.points ?? 0,
      total_points: rawHistory.total_points ?? 0,
      overall_rank: rawHistory.overall_rank ?? 0,
      rank: rawHistory.rank ?? 0,
      event_transfers: rawHistory.event_transfers ?? 0,
      event_transfers_cost: rawHistory.event_transfers_cost ?? 0,
      value: rawHistory.value ? rawHistory.value / 10 : 0,
      bank: rawHistory.bank ? rawHistory.bank / 10 : 0
    } : null;

    return {
      squad: myPicks,
      transfers,
      chips,
      bank,
      totalCost,
      entryHistory,
      managerInfo,
      gameweek: baseData.nextEventId
    };
  }
}

async function handleAutoSnapshot(req: any, res: any) {
  const db = getFirestore();
  if (!db) {
    return res.status(500).json({ error: "Firestore unavailable. Check GOOGLE_CLOUD_* env variables." });
  }

  try {
    const fplRes = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000
    });
    const data = fplRes.data;
    const nextEvent = data.events?.find((e: any) => e.is_next) ??
                      data.events?.find((e: any) => new Date(e.deadline_time) > new Date());
    
    const gwId = nextEvent?.id || 1;

    // If a specific teamId is provided (manual trigger), only snapshot that one team.
    // Otherwise (automated cron), snapshot all registered teams.
    const targetTeamId = (req.query?.teamId as string) || (req.query?.id as string);
    let teamIdList: string[];

    if (targetTeamId) {
      // Manual trigger: single team only
      teamIdList = [targetTeamId];
    } else {
      // Automated cron: all registered teams
      const defaultTeamIds: string[] = ['532002', '1884833', '3097103', '902458', '904491', '601847', '906422', '1921923', '1924837', '600311', '3274378', '9291073', '903137'];
      teamIdList = [...defaultTeamIds];

      try {
        const snapshotDocs = await db.collection('user_snapshots').get();
        snapshotDocs.forEach(doc => {
          if (doc.id.startsWith('team_')) {
            const tid = doc.id.replace('team_', '').trim();
            if (tid && !teamIdList.includes(tid)) {
              teamIdList.push(tid);
            }
          }
        });
      } catch (err: any) {
        console.warn("[AutoSnapshot] Notice fetching Firestore team documents:", err.message);
      }
    }

    const fuels: ('fplform' | 'native' | 'eye-test')[] = ['fplform', 'native', 'eye-test'];
    const modes: ('safe' | 'aggressive' | 'value')[] = ['safe', 'aggressive', 'value'];
    const scenarios: ('quant' | 'template')[] = ['quant', 'template'];
    const budget = req.query?.budget ? parseInt(req.query.budget as string) : 1000;

    let successCount = 0;
    let errorCount = 0;

    for (const tid of teamIdList) {
      const docKey = `team_${tid}`;
      try {
        const docRef = db.collection('user_snapshots').doc(docKey);
        const docSnap = await docRef.get();
        const existingHistory = docSnap.exists ? (docSnap.data()?.history || {}) : {};
        const newGwHistory = { ...(existingHistory[gwId] || {}) };
        const now = Date.now();

        for (const fuel of fuels) {
          for (const scenario of scenarios) {
            for (const mode of modes) {
              const snapshotKey = `${fuel}_${scenario}_${mode}`;
              try {
                const result = await FPLService.getRecommendations(mode, budget, 'admin', fuel, scenario, [], [], gwId, true);

                const snapshotItem = {
                  key: snapshotKey,
                  fuel,
                  scenario,
                  riskMode: mode,
                  fuelLabel: fuel === 'eye-test' ? 'Eye Test' : fuel === 'native' ? 'Native FPL' : 'FPLForm',
                  scenarioLabel: scenario === 'quant' ? 'Quant Optimal' : 'Risky Template Shield',
                  riskLabel: mode.toUpperCase(),
                  autoGenerated: true,
                  timestamp: now,
                  players: result.startingXI.map((p: any) => ({
                    id: p.id,
                    web_name: p.web_name,
                    score: p.score,
                    position: p.position
                  })),
                  benchPlayers: (result.bench || []).map((p: any) => ({
                    id: p.id,
                    web_name: p.web_name,
                    score: p.score,
                    position: p.position
                  })),
                  xP: result.expectedPoints,
                  captainId: result.captain?.id,
                  viceCaptainId: result.viceCaptain?.id
                };
                newGwHistory[snapshotKey] = snapshotItem;
              } catch (err: any) {
                console.warn(`[AutoSnapshot] Failed ${snapshotKey} for team ${tid}: ${err.message}`);
                errorCount++;
              }
            }
          }
        }

        existingHistory[gwId] = newGwHistory;
        await docRef.set({
          history: existingHistory,
          season: '2026/27',
          lastAutoSnapshotAt: new Date()
        }, { merge: true });

        successCount++;
        console.log(`[AutoSnapshot] Saved GW${gwId} full snapshots for team ${tid}`);
      } catch (err: any) {
        console.error(`[AutoSnapshot] Error saving snapshots for team ${tid}:`, err.message);
        errorCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Auto-snapshot completed for GW${gwId}`,
      snapshottedCount: successCount,
      totalTeams: teamIdList.length,
      errors: errorCount
    });
  } catch (error: any) {
    console.error("[AutoSnapshot Error]:", error);
    return res.status(500).json({ error: error.message });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- ENVIRONMENT VALIDATION FOR HTTP HANDLER ---
  if (!process.env.GOOGLE_CLOUD_PROJECT_ID || !process.env.GROQ_API_KEY) {
    console.error("[Vercel Handler Error] Missing critical environment variables.");
    return res.status(500).json({ error: "FATAL: Missing critical environment variables." });
  }
  // -----------------------------------------------

  const url = req.url || "/";
  
  const origin = req.headers.origin || '';
  const allowedOrigin = origin.includes('localhost') || origin.includes('vercel.app') ? origin : (process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const query = req.query || {};
    const riskMode = (query.riskMode as string) || 'safe';
    const fuel = (query.fuel as string) || 'fplform';
    const userId = (query.userId as string) || 'unknown';
    
    // Default tier if not found in db
    let tier = 'free';

    if (url.includes('/api/user')) {
      const uid = await verifyAuth(req, res);
      if (!uid) return;
      tier = await getUserTier(uid);
      return res.status(200).json({ userId: uid, tier });
    }

    if (url.includes('/api/auth/merge') && req.method === 'POST') {
      const { newUserId, anonymousId } = req.body || {};
      if (!newUserId || !anonymousId) return res.status(400).json({ error: "Missing user IDs" });
      
      const uid = await verifyAuth(req, res);
      if (!uid || uid !== newUserId) return res.status(403).json({ error: "Forbidden: You can only merge into your own account." });

      const success = await mergeUserTiers(anonymousId, newUserId);
      return res.status(200).json({ success });
    }

    if (url.includes('/api/recommendations')) {
      const uid = await verifyAuth(req, res);
      if (!uid) return;

      tier = await getUserTier(uid);
      const budget = query.budget ? parseInt(query.budget as string) : 1000;
      const scenario = (query.scenario === 'template' || req.body?.scenario === 'template' ? 'template' : 'quant') as 'quant' | 'template';
      const lockedStr = (query.locked as string) || (req.body?.locked as string) || '';
      const excludedStr = (query.excluded as string) || (req.body?.excluded as string) || '';
      const lockedIds = Array.isArray(req.body?.lockedIds) 
        ? req.body.lockedIds 
        : (lockedStr ? lockedStr.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n)) : []);
      const excludedIds = Array.isArray(req.body?.excludedIds) 
        ? req.body.excludedIds 
        : (excludedStr ? excludedStr.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n)) : []);
      const skipComparison = query.skipComparison === 'true';

      if (lockedIds.length === 0 && excludedIds.length === 0) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      }

      const result = await FPLService.getRecommendations(riskMode, budget, tier, fuel, scenario, lockedIds, excludedIds, undefined, skipComparison);
      return res.status(200).json(result);
    } 
    
    if (url.includes('/api/sync')) {
      const uid = await verifyAuth(req, res);
      if (!uid) return;

      tier = await getUserTier(uid);
      const teamId = url.split('/').pop()?.split('?')[0];
      if (!teamId) return res.status(400).json({ error: "Missing Team ID" });
      
      const db = getFirestore();
      const profileDoc = await db.collection('user_profiles').doc(uid).get();
      const registeredTeamId = profileDoc.exists ? profileDoc.data()?.fplTeamId : null;
      const isAdmin = await isAdminUser(uid);
      
      if (!isAdmin && tier !== 'admin' && tier !== 'free') {
        if (!registeredTeamId) {
          return res.status(403).json({ error: "Premium Account: Please link your FPL Team ID in your Settings profile before running an analysis." });
        }
        if (teamId !== registeredTeamId) {
          return res.status(403).json({ error: "Premium features are securely locked to your registered FPL Team ID. You cannot analyze other teams." });
        }
      }

      const targetGw = req.query?.gw ? parseInt(req.query.gw as string, 10) : undefined;
      const result = await FPLService.syncTeam(teamId, riskMode, tier, fuel, targetGw);
      return res.status(200).json(result);
    }

    if (url.includes('/api/live')) {
      const eventId = url.split('/').pop()?.split('?')[0];
      if (!eventId) return res.status(400).json({ error: "Missing Event ID" });
      try {
        const [liveRes, fixturesRes] = await Promise.all([
          axios.get(`${FPL_BASE_URL}/event/${eventId}/live/`, { headers: (FPLService as any).getHeaders() }),
          axios.get(`${FPL_BASE_URL}/fixtures/?event=${eventId}`, { headers: (FPLService as any).getHeaders() }).catch(() => ({ data: [] }))
        ]);
        return res.status(200).json({
          elements: liveRes.data.elements,
          fixtures: fixturesRes.data || []
        });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (url.includes('/api/agent/ask') && req.method === 'POST') {
      const { gameweek, squad, bank, freeTransfers = 1, chips = {}, chipAdvice = [], riskMode = 'safe', userPrompt, fuel = 'fplform' } = req.body || {};
      if (!squad) return res.status(400).json({ error: "Missing payload" });
      
      const uid = await verifyAuth(req, res);
      if (!uid) return;

      const userTier = await getUserTier(uid);
      if (userTier !== 'aiAgent' && userTier !== 'betaPilot' && userTier !== 'admin') {
        return res.status(403).json({ error: "Beta Pilot tier required" });
      }

      // --- RATE LIMITING (TRANSACTIONAL) ---
      const db = getFirestore();
      const profileRef = db.collection('user_profiles').doc(uid);
      
      try {
        await db.runTransaction(async (t) => {
          const doc = await t.get(profileRef);
          const data = doc.data() || {};
          
          const now = Date.now();
          const oneHour = 60 * 60 * 1000;
          const lastCall = data.lastLLMCall?.toMillis?.() || 0;
          let callCount = data.llmCallCount || 0;

          const isAdmin = await isAdminUser(uid);
          if (now - lastCall < oneHour) {
            if (callCount >= 20 && userTier !== 'admin' && !isAdmin) {
              throw new Error("RATE_LIMIT_EXCEEDED");
            }
            callCount++;
          } else {
            callCount = 1;
          }

          t.set(profileRef, {
            lastLLMCall: new Date(),
            llmCallCount: callCount
          }, { merge: true });
        });
      } catch (e: any) {
        if (e.message === "RATE_LIMIT_EXCEEDED") {
          return res.status(429).json({ error: "Rate limit exceeded. Maximum 20 AI questions per hour." });
        }
        throw e;
      }
      // -------------------------------------

      // Fetch fixtures & upcoming gameweek context
      const baseData = await FPLService.getBaseData();
      const teamsList = baseData.teams || [];
      const effectiveGw = gameweek || baseData.nextEventId || 3;
      const allFixtures = (baseData.fixtures && baseData.fixtures.length > 0) ? baseData.fixtures : [];
      let rawUpcoming = allFixtures.filter((f: any) => f.event >= effectiveGw && f.event < effectiveGw + 5);
      if (rawUpcoming.length === 0) rawUpcoming = allFixtures.slice(0, 5); // Fallback if no exact match
      
      const upcoming = rawUpcoming.map((f: any) => {
        const homeTeam = teamsList.find((t: any) => t.id === f.team_h)?.name || `Team ${f.team_h}`;
        const awayTeam = teamsList.find((t: any) => t.id === f.team_a)?.name || `Team ${f.team_a}`;
        return {
          gw: f.event || 'TBD',
          team: homeTeam,
          opponent: awayTeam,
          difficulty: `H:${f.team_h_difficulty} A:${f.team_a_difficulty}`
        };
      });

      // Fetch targets
      const recommendations = await FPLService.getRecommendations(riskMode, bank, userTier, fuel);
      const allTargets = [
        ...recommendations.topPicks.gkp,
        ...recommendations.topPicks.def,
        ...recommendations.topPicks.mid,
        ...recommendations.topPicks.fwd
      ];

      // Fetch context
      const fplContext = await getNewsContextFromCache();

      const injuredIds = new Set(fplContext?.injuries.map((i: any) => i.playerId) || []);
      const validTargets = allTargets.filter(p => !injuredIds.has(p.id)).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 20).map(p => ({
        id: p.id,
        name: p.web_name,
        position: p.position,
        team_name: p.team_name,
        team_short_name: p.team_short_name,
        price: p.now_cost,
        xP: p.xP,
        riskAdjustedScore: p.score,
        ownership: p.ownership,
        form: p.form,
        next_fixtures: p.next_fixtures
      }));

      const decision = await getLLMTransferDecision(
        uid, squad, effectiveGw, upcoming, bank, freeTransfers, chips, riskMode, userPrompt, fplContext, validTargets, chipAdvice
      );
      
      return res.status(200).json({ decision });
    }

    if (url.includes('/api/agent/thread') && req.method === 'POST') {
      const { squad, riskMode = 'safe', topPicks = [], totalCost = 0, expectedPoints = 0, omittedStars = [], captain = null, viceCaptain = null } = req.body || {};
      if (!squad) return res.status(400).json({ error: "Missing squad payload" });
      
      const uid = await verifyAuth(req, res);
      if (!uid) return;

      const userTier = await getUserTier(uid);
      if (userTier !== 'aiAgent' && userTier !== 'betaPilot' && userTier !== 'admin') {
        return res.status(403).json({ error: "Beta Pilot tier required" });
      }

      // --- RATE LIMITING (reuse same logic as ask) ---
      const db = getFirestore();
      const profileRef = db.collection('user_profiles').doc(uid);
      
      try {
        await db.runTransaction(async (t) => {
          const doc = await t.get(profileRef);
          const data = doc.data() || {};
          const now = Date.now();
          const oneHour = 60 * 60 * 1000;
          const lastCall = data.lastLLMCall?.toMillis?.() || 0;
          let callCount = data.llmCallCount || 0;

          const isAdmin = await isAdminUser(uid);
          if (now - lastCall < oneHour) {
            if (callCount >= 20 && userTier !== 'admin' && !isAdmin) {
              throw new Error("RATE_LIMIT_EXCEEDED");
            }
            callCount++;
          } else {
            callCount = 1;
          }

          t.set(profileRef, {
            lastLLMCall: new Date(),
            llmCallCount: callCount
          }, { merge: true });
        });
      } catch (e: any) {
        if (e.message === "RATE_LIMIT_EXCEEDED") {
          return res.status(429).json({ error: "Rate limit exceeded. Maximum 20 AI generations per hour." });
        }
        throw e;
      }
      // -------------------------------------

      const tweets = await generateSocialThread(squad, riskMode, topPicks, totalCost, expectedPoints, omittedStars, captain, viceCaptain);
      return res.status(200).json({ tweets });
    }

    if (url.includes('auto-snapshot')) {
      return handleAutoSnapshot(req, res);
    }

    if (url.includes('/api/ping')) {
      return res.status(200).json({ status: "ok", message: "Grand Cru Engine Online" });
    }

    res.status(404).json({ error: "Route not found" });
  } catch (error: any) {
    console.error("[CRITICAL] FPL Engine Failure:", error);
    res.status(500).json({ 
      error: "FPL Engine Failure", 
      message: error.message
    });
  }
}
