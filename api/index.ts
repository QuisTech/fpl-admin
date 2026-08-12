import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import solver from "javascript-lp-solver";
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { 
  FPLPlayer, FPLTeam, FPLFixture, ScoredPlayer, 
  FPLPlayerSchema, FPLTeamSchema, FPLFixtureSchema,
  RecommendationResponse, TeamSyncResponse, TransferRecommendation, ChipAdvice, PlayerDistribution
} from './_lib/types.js';
import { OracleFactory, XPOracle, CSVOracle } from './_lib/ingestion.js';
import { getParamsForRiskMode } from './_lib/projection.js';
import { loadWeights } from './_lib/weights-loader.js';
const baseWeights = loadWeights('baseline');
import { Simulator } from './_lib/simulator.js';
import { solveOptimalSquad, solveCaptain } from './_lib/lp-solver.js';
import { getUserTier, mergeUserTiers, getFirestore } from '../lib/firestore.js';
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

  private static async fetchWithRetry(url: string, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
      try {
        const config = { headers: this.getHeaders(), timeout: 10000 };
        const res = await axios.get(url, config);
        return res;
      } catch (err: any) {
        console.warn(`[FPL API] Attempt ${i + 1}/${retries} failed for ${url}: ${err.response?.status || err.message}`);
        if (i < retries - 1) {
          // Exponential backoff: 1s, 2s, 4s
          await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000)); 
        } else {
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
      const nextEvent = staticRes.data.events.find((e: any) => new Date(e.deadline_time) > new Date()) || { id: 1 };
      
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
    
    return {
      ...p,
      position,
      team_name: team?.name || "Unknown",
      team_short_name: team?.short_name || "UNK",
      score: this.calculatePlayerScore(baseXp, p, riskMode, fuel, fixtures, nextEventId),
      xP: baseXp,
      ppm: (p.total_points || 0) / (p.now_cost / 10),
      next_fixtures: [],
      isCaptain: false,
      isViceCaptain: false
    };
  }

  static async getRecommendations(riskMode: string, budget: number = 1000, tier: string = 'free', fuel: string = 'fplform'): Promise<RecommendationResponse> {
    // For eye-test mode, skip FPL API call and use CSV data only
    let players: any[] = [];
    let teams: any[] = [];
    let fixtures: any[] = [];
    let nextEventId = 1;

    try {
      const baseData = await this.getBaseData();
      players = baseData.players;
      teams = baseData.teams;
      fixtures = baseData.fixtures;
      nextEventId = baseData.nextEventId;
    } catch (err: any) {
      console.error('[FPLService] Failed to fetch FPL API data:', err.message);
      if (!this.cache) {
        throw new Error('FPL API unavailable. Please try again later.');
      }
    }

    // Dynamically load the fuel source (fplform scraped vs native FPL API)
    // Eye-test merit + FDR is now computed inside the oracle so all fuel sources
    // flow through the same LP Solver pipeline with full utility deformation
    let csvFileName = fuel === 'native' ? 'fpl_native.csv' : 'fplform.csv';
    
    // Fallback: if FPLFORM file is corrupted/empty, use NATIVE as backup temporarily
    if (fuel !== 'native' && fuel !== 'eye-test') {
      const fplformPath = path.resolve(process.cwd(), 'data', 'fplform.csv');
      if (fs.existsSync(fplformPath)) {
        const content = fs.readFileSync(fplformPath, 'utf8');
        // Check if file is corrupted (has team names instead of player data)
        if (content.includes('Arsenal, ARS') || content.split('\n').length < 100) {
          console.warn('[FPLService] FPLFORM data appears corrupted, temporarily using NATIVE fallback');
          csvFileName = 'fpl_native.csv';
        }
      }
    }
    
    // For eye-test mode with future seasons, pass empty arrays for live data
    // CSVOracle will use CSV data and 2026-27 fixtures for projections
    console.log(`[FPLService.getRecommendations] Input fuel: ${fuel}, csvFileName: ${csvFileName}`);
    const fixturesFilePath = undefined; // Live API now has 2026-27 fixtures, no need for JSON override
    const oraclePlayers = players; 
    const oracleTeams = teams; 
    const oracleFixtures = fixtures; 
    console.log(`[FPLService.getRecommendations] Creating Oracle with fuel: ${fuel}, fixturesFilePath: ${fixturesFilePath}`);
    const oracle = OracleFactory.create(`data/${csvFileName}`, oraclePlayers, fuel, oracleFixtures, oracleTeams, nextEventId, riskMode, fixturesFilePath);

    let scored: ScoredPlayer[] = [];
    
    // All modes (including eye-test) now use live FPL API players, 
    // ensuring we get real badges, real team names, and correct risk mode utility scores.
    const available = players.filter(p => p.status === 'a' || p.chance_of_playing_next_round === 100);
    scored = available.map(p => {
      const baseXp = oracle.getXP(p.id, nextEventId);
      const mapped = this.mapToScoredPlayer(p, teams, fixtures, nextEventId, riskMode, baseXp, fuel);
      mapped.eo = oracle.getTop1kEO?.(p.id) ?? 0;
      mapped.ownership = oracle.getTop1kOwnership?.(p.id) ?? parseFloat(p.selected_by_percent || "0") ?? 0;
      return mapped;
    });

    let squad: ScoredPlayer[] = [];
    let isHeuristicFallback = false;
    const sortByScore = (a: ScoredPlayer, b: ScoredPlayer) => (b.xP || 0) - (a.xP || 0);

    if (tier !== 'free') {
      try {
        const availableIds = new Set<number>(scored.map(p => p.id));
        
        const params = getParamsForRiskMode(riskMode, baseWeights);
        const optimalIds = solveOptimalSquad(oracle, nextEventId, budget, 8, params, availableIds);
        if (!optimalIds || optimalIds.length === 0) {
          throw new Error("LP Solver returned empty or infeasible solution.");
        }
        squad = scored.filter(p => optimalIds.includes(p.id));
      } catch (err: any) {
        console.warn("[FPLService] LP Solver failed, falling back to heuristic selection:", err.message);
        isHeuristicFallback = true;
        try {
          const db = getFirestore();
          await db.collection('system_alerts').add({
            type: 'CRITICAL_FALLBACK',
            component: 'LP_SOLVER',
            message: err.message,
            timestamp: new Date()
          });
        } catch (dbErr) {
          // ignore
        }
        // Fallback to free tier selection
        const gkps = scored.filter(p => p.position === 'GKP').sort(sortByScore).slice(0, 2);
        const defs = scored.filter(p => p.position === 'DEF').sort(sortByScore).slice(0, 5);
        const mids = scored.filter(p => p.position === 'MID').sort(sortByScore).slice(0, 5);
        const fwds = scored.filter(p => p.position === 'FWD').sort(sortByScore).slice(0, 3);
        squad = [...gkps, ...defs, ...mids, ...fwds];
      }
    } else {
      // Free tier: fallback to highest projected points enforcing 15-man constraints
      const gkps = scored.filter(p => p.position === 'GKP').sort(sortByScore).slice(0, 2);
      const defs = scored.filter(p => p.position === 'DEF').sort(sortByScore).slice(0, 5);
      const mids = scored.filter(p => p.position === 'MID').sort(sortByScore).slice(0, 5);
      const fwds = scored.filter(p => p.position === 'FWD').sort(sortByScore).slice(0, 3);
      squad = [...gkps, ...defs, ...mids, ...fwds];
    }
    
    const gkps = squad.filter(p => p.position === "GKP").sort(sortByScore);
    const defs = squad.filter(p => p.position === "DEF").sort(sortByScore);
    const mids = squad.filter(p => p.position === "MID").sort(sortByScore);
    const fwds = squad.filter(p => p.position === "FWD").sort(sortByScore);
    
    // FPL Rules: 1 GKP, min 3 DEF, min 2 MID, min 1 FWD
    const mandatory = [gkps[0], ...defs.slice(0, 3), ...mids.slice(0, 2), ...fwds.slice(0, 1)].filter(Boolean) as ScoredPlayer[];
    const availableOutfielders = [...defs.slice(3), ...mids.slice(2), ...fwds.slice(1)].sort(sortByScore);
    
    // Pick the top 4 remaining outfielders to complete the XI
    const extraOutfielders = availableOutfielders.slice(0, 4);
    const startingXI = [...mandatory, ...extraOutfielders].filter(Boolean) as ScoredPlayer[];
    
    const startingIds = new Set(startingXI.map(p => p.id));
    const bench = squad.filter(p => !startingIds.has(p.id)).sort((a, b) => {
      if (a.position === 'GKP' && b.position !== 'GKP') return -1;
      if (a.position !== 'GKP' && b.position === 'GKP') return 1;
      return (b.xP || 0) - (a.xP || 0);
    });
      const sortByUtility = (a: ScoredPlayer, b: ScoredPlayer) => (b.score || 0) - (a.score || 0);
      
      const startingIdsArr = Array.from(startingIds);
      const { captain: captainId, viceCaptain: vcId } = solveCaptain(
        oracle, 
        nextEventId, 
        startingIdsArr, 
        getParamsForRiskMode(riskMode, baseWeights)
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
  
      return { 
      squad, startingXI, 
      bench,
      captain,
      viceCaptain,
      expectedPoints: startingXI.reduce((sum, p) => sum + (p.xP || 0), 0),
      totalCost: squad.reduce((sum, p) => sum + (p.now_cost || 0), 0),
      isHeuristicFallback,
      engineDiagnostics: {
        budgetUsed: squad.reduce((sum, p) => sum + (p.now_cost || 0), 0),
        budgetLimit: budget,
        riskMode: riskMode,
        solverStatus: isHeuristicFallback ? 'heuristic_fallback' : 'optimal',
        activeConstraints: {
          minEoTotal: riskMode === 'safe' ? 150 : 0,
          minElitePlayers: riskMode === 'safe' ? 1 : 0
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
  }

  static generateTransfers(squad: ScoredPlayer[], candidates: ScoredPlayer[], oracle: XPOracle, riskMode: string, gameweek: number): TransferRecommendation[] {
    const transfers: TransferRecommendation[] = [];
    const squadIds = new Set(squad.map(p => p.id));
    const params = getParamsForRiskMode(riskMode, baseWeights);

    squad.forEach(outPlayer => {
      const betterOptions = candidates.filter(p => 
        p.position === outPlayer.position && 
        !squadIds.has(p.id) && 
        p.now_cost <= outPlayer.now_cost &&
        (p.score || 0) > (outPlayer.score || 0) + 0.5
      , baseWeights).sort((a, b) => (b.score || 0) - (a.score || 0));

      if (betterOptions.length > 0) {
        const inPlayer = betterOptions[0];
        const inVar = oracle.getVariance(inPlayer.id, gameweek);
        const outVar = oracle.getVariance(outPlayer.id, gameweek);
        const inEO = oracle.getTop1kEO?.(inPlayer.id) ?? 0;
        const outEO = oracle.getTop1kEO?.(outPlayer.id) ?? 0;
        const transferUtilityDelta = (inPlayer.xP - outPlayer.xP) - params.betaVariance * (inVar - outVar) + params.betaEO * (inEO - outEO);
        const xPDelta = inPlayer.xP - outPlayer.xP;

        transfers.push({ 
          out: outPlayer, 
          in: inPlayer, 
          localTransferSignal: transferUtilityDelta, 
          xPDelta 
        });
      }
    });
    return transfers.sort((a, b) => b.localTransferSignal - a.localTransferSignal).slice(0, 5);
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

  static async syncTeam(teamId: string, riskMode: string, tier: string = 'free', fuel: string = 'fplform'): Promise<TeamSyncResponse> {
    const baseData = await this.getBaseData();
    const currentEvent = baseData.currentEventId || Math.max(1, baseData.nextEventId - 1);
    
    // 1. Initialize the V3 Engine Oracle first based on selected fuel
    const csvFileName = fuel === 'native' ? 'fpl_native.csv' : 'fplform.csv';
    const oracle = OracleFactory.create(`data/${csvFileName}`, baseData.players, fuel, baseData.fixtures, baseData.teams, baseData.nextEventId, riskMode);

    // 2. Fetch live user team
    let teamRes;
    try {
      teamRes = await this.fetchWithRetry(`${FPL_BASE_URL}/entry/${teamId}/event/${currentEvent}/picks/`);
    } catch (err: any) {
      if (err.response?.status === 404) {
        throw new Error(`FPL API Error: Team ID ${teamId} not found, or squads are currently locked and hidden by FPL until the Gameweek 1 deadline.`);
      }
      throw err;
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

    // 3. Execute the Multi-Horizon Beam Search (Only for Grand Cru / Beta Pilot)
    let optimalFirstMove = 'ROLL';
    let bestFutures: any[] = [];
    
    if (tier === 'grandCru' || tier === 'aiAgent' || tier === 'betaPilot' || tier === 'admin') {
      console.log(`[V3 Engine] Executing Beam Search for Team ${teamId}...`);
      const params = getParamsForRiskMode(riskMode, baseWeights);
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
    
    // Only Strategy/GrandCru get optimal transfers
    if (tier !== 'free') {
      if (optimalFirstMove === 'TRANSFER' && bestFutures.length > 0 && bestFutures[0].firstTransfersIn && bestFutures[0].firstTransfersOut) {
        const ins = bestFutures[0].firstTransfersIn;
        const outs = bestFutures[0].firstTransfersOut;
        const params = getParamsForRiskMode(riskMode, baseWeights);
        for (let i = 0; i < ins.length; i++) {
          const inPlayer = baseData.players.find(p => p.id === ins[i]);
          const outPlayer = myPicks.find(p => p.id === outs[i]);
          if (inPlayer && outPlayer) {
            const inXp = oracle.getXP(inPlayer.id, baseData.nextEventId);
            const inScored = FPLService.mapToScoredPlayer(inPlayer, baseData.teams, baseData.fixtures, baseData.nextEventId, riskMode, inXp, fuel);
            
            const inVar = oracle.getVariance(inPlayer.id, baseData.nextEventId);
            const outVar = oracle.getVariance(outPlayer.id, baseData.nextEventId);
            const inEO = oracle.getTop1kEO?.(inPlayer.id) ?? 0;
            const outEO = oracle.getTop1kEO?.(outPlayer.id) ?? 0;

            const transferUtilityDelta = (inScored.xP - outPlayer.xP) - params.betaVariance * (inVar - outVar) + params.betaEO * (inEO - outEO);
            const xPDelta = inScored.xP - outPlayer.xP;

            transfers.push({
              out: outPlayer,
              in: inScored,
              localTransferSignal: transferUtilityDelta,
              xPDelta
            });
          }
        }
      }

      if (transfers.length === 0) {
        transfers = this.generateTransfers(myPicks, candidates, oracle, riskMode, baseData.nextEventId);
      } else {
        // The LP Solver found the 1 true optimal path. 
        // We will append 4 alternative independent swaps for variety in the UI.
        const alternativeSwaps = this.generateTransfers(myPicks, candidates, oracle, riskMode, baseData.nextEventId);
        
        // Keep track of the exact swaps we already have
        const existingSwapSignatures = new Set(transfers.map(t => `${t.out.id}-${t.in.id}`));
        
        for (const swap of alternativeSwaps) {
          if (transfers.length >= 5) break;
          const sig = `${swap.out.id}-${swap.in.id}`;
          if (!existingSwapSignatures.has(sig)) {
            transfers.push(swap);
            existingSwapSignatures.add(sig);
          }
        }
      }
    }

    const chips: ChipAdvice[] = [
      {
        chip: "Wildcard",
        recommendation: optimalFirstMove === 'WC' ? "STRONG BUY" : "HOLD",
        reason: optimalFirstMove === 'WC' ? "V3 Engine highly recommends playing Wildcard to maximize multi-horizon EV." : "V3 Engine suggests holding."
      },
      {
        chip: "Free Hit",
        recommendation: optimalFirstMove === 'FH' ? "STRONG BUY" : "HOLD",
        reason: optimalFirstMove === 'FH' ? "V3 Engine highly recommends a Free Hit this week." : "V3 Engine suggests holding."
      },
      {
        chip: "Bench Boost",
        recommendation: optimalFirstMove === 'BB' ? "STRONG BUY" : "HOLD",
        reason: optimalFirstMove === 'BB' ? "V3 Engine confirms your bench has massive EV this week." : "V3 Engine suggests holding."
      },
      {
        chip: "Triple Captain",
        recommendation: optimalFirstMove === 'TC' ? "STRONG BUY" : "HOLD",
        reason: optimalFirstMove === 'TC' ? "V3 Engine detects a massive outlier fixture. Play it." : "V3 Engine suggests holding."
      }
    ];

    const totalCost = myPicks.reduce((sum, p) => sum + (p.now_cost || 0), 0);

    return {
      squad: myPicks,
      transfers,
      chips,
      bank,
      totalCost
    };
  }
}

// --- ENVIRONMENT VALIDATION ---
if (!process.env.GOOGLE_CLOUD_PROJECT_ID || !process.env.GROQ_API_KEY) {
  throw new Error("FATAL: Missing critical environment variables.");
}
// ------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
      const result = await FPLService.getRecommendations(riskMode, budget, tier, fuel);
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
      
      if (tier !== 'admin' && tier !== 'free') {
        if (!registeredTeamId) {
          return res.status(403).json({ error: "Premium Account: Please link your FPL Team ID in your Settings profile before running an analysis." });
        }
        if (teamId !== registeredTeamId) {
          return res.status(403).json({ error: "Premium features are securely locked to your registered FPL Team ID. You cannot analyze other teams." });
        }
      }

      const result = await FPLService.syncTeam(teamId, riskMode, tier, fuel);
      return res.status(200).json(result);
    }

    if (url.includes('/api/live')) {
      const eventId = url.split('/').pop()?.split('?')[0];
      if (!eventId) return res.status(400).json({ error: "Missing Event ID" });
      const liveRes = await axios.get(`${FPL_BASE_URL}/event/${eventId}/live/`, { headers: (FPLService as any).getHeaders() });
      return res.status(200).json(liveRes.data);
    }

    if (url.includes('/api/agent/ask') && req.method === 'POST') {
      const { gameweek, squad, bank, freeTransfers = 1, chips = {}, riskMode = 'safe', userPrompt, fuel = 'fplform' } = req.body || {};
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

          if (now - lastCall < oneHour) {
            if (callCount >= 20 && userTier !== 'admin') {
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

      // Fetch fixtures
      const baseData = await FPLService.getBaseData();
      const teamsList = baseData.teams || [];
      const fixturesRes = await axios.get(`${FPL_BASE_URL}/fixtures/`, { headers: (FPLService as any).getHeaders() });
      let rawUpcoming = fixturesRes.data.filter((f: any) => f.event >= (gameweek || 1) && f.event < (gameweek || 1) + 5);
      if (rawUpcoming.length === 0) rawUpcoming = fixturesRes.data.slice(0, 5); // Fallback if no exact match
      
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
        price: p.now_cost,
        xP: p.xP,
        riskAdjustedScore: p.score,
        ownership: p.ownership,
        form: p.form
      }));

      const decision = await getLLMTransferDecision(
        uid, squad, gameweek, upcoming, bank, freeTransfers, chips, riskMode, userPrompt, fplContext, validTargets
      );
      
      return res.status(200).json({ decision });
    }

    if (url.includes('/api/agent/thread') && req.method === 'POST') {
      const { squad, riskMode = 'safe', topPicks = [], totalCost = 0, expectedPoints = 0 } = req.body || {};
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

          if (now - lastCall < oneHour) {
            if (callCount >= 20 && userTier !== 'admin') {
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

      const tweets = await generateSocialThread(squad, riskMode, topPicks, totalCost, expectedPoints);
      return res.status(200).json({ tweets });
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
