import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trophy, TrendingUp, TrendingDown, Shield, Zap, ChevronLeft, ChevronRight, 
  ArrowRight, RefreshCw, UserCheck, Sparkles, Clock, ArrowUpRight, 
  CheckCircle2, DollarSign, Award, AlertCircle, Bot, Swords
} from 'lucide-react';
import { cn } from '../lib/utils';
import axios from 'axios';

export interface CareerPlayer {
  id: number;
  web_name: string;
  position: 'GKP' | 'DEF' | 'MID' | 'FWD';
  cost: number;
  costDisplay: string;
  team_short_name: string;
  points: number;
  minutes: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  multiplier: number;
  isAutoSubIn?: boolean;
  isAutoSubOut?: boolean;
  xP?: number;
}

export interface CareerGameweek {
  gameweek: number;
  startingXI: CareerPlayer[];
  bench: CareerPlayer[];
  captain: CareerPlayer;
  viceCaptain: CareerPlayer;
  activeCaptain: CareerPlayer;
  transfersIn: { id: number; name: string; position: string; cost: number; costDisplay: string }[];
  transfersOut: { id: number; name: string; position: string; cost: number; sellPrice: number; costDisplay: string }[];
  isRolledTransfer: boolean;
  freeTransfersAvailable: number;
  freeTransfersRemaining: number;
  hitsTaken: number;
  hitCostPoints: number;
  autoSubs: { outPlayer: string; inPlayer: string; points: number }[];
  grossPoints: number;
  netPoints: number;
  expectedPoints?: number;
  cumulativePoints: number;
  bank: number;
  bankDisplay: string;
  squadValue: number;
  teamValue: number;
  teamValueDisplay: string;
  decisionLog: string;
  chipActive?: string;
  averageScore?: number;
  humanComparison?: {
    gameweek: number;
    transfers: number;
    transfersCost: number;
    grossPoints: number;
    netPoints: number;
    cumulativePoints: number;
    overallRank?: number;
    alphaDelta: number;
    cumulativeAlphaDelta: number;
    startingXI?: CareerPlayer[];
    bench?: CareerPlayer[];
    captain?: CareerPlayer;
    viceCaptain?: CareerPlayer;
    transfersIn?: { id?: number; name: string; position?: string; costDisplay?: string }[];
    transfersOut?: { id?: number; name: string; position?: string; costDisplay?: string }[];
  };
}

export interface CareerSeasonPayload {
  mode: 'autonomous' | 'synced' | 'forward';
  teamId?: string;
  managerName?: string;
  teamName?: string;
  fuel: string;
  riskMode: string;
  forwardSource?: 'autonomous' | 'synced' | 'duel';
  syncedSource?: 'frozen' | 'dynamic';
  startGw: number;
  endGw: number;
  totalPoints: number;
  basePoints?: number;
  forwardPoints?: number;
  totalHitsCost: number;
  totalTransfersMade: number;
  totalTransfersRolled: number;
  finalBank: string;
  finalTeamValue: string;
  humanSummary?: {
    totalPoints: number;
    totalHitsCost: number;
    totalTransfersMade: number;
    currentOverallRank: number;
    netAlphaVsHuman: number;
  };
  chipInventory?: {
    currentSet: string;
    deadlineGw: number;
    chips: { name: string; label: string; status: 'AVAILABLE' | 'USED' | 'EXPIRED'; usedInGw?: number }[];
  };
  gameweeks: CareerGameweek[];
}

interface CareerModeViewProps {
  teamId?: string;
  activeFuel?: 'fplform' | 'native' | 'eye-test';
  activeRisk?: 'safe' | 'aggressive' | 'value';
  activeScenario?: 'quant' | 'template';
}

export const CareerModeView = ({ 
  teamId, 
  activeFuel = 'native', 
  activeRisk = 'safe',
  activeScenario = 'template'
}: CareerModeViewProps) => {
  const [mode, setMode] = useState<'autonomous' | 'synced' | 'forward'>('autonomous');
  const [forwardSource, setForwardSource] = useState<'autonomous' | 'synced' | 'duel'>(() => {
    try {
      const saved = localStorage.getItem('fpl_career_forward_source');
      if (saved === 'autonomous' || saved === 'synced' || saved === 'duel') return saved;
    } catch {}
    return teamId ? 'duel' : 'autonomous';
  });

  useEffect(() => {
    try {
      localStorage.setItem('fpl_career_forward_source', forwardSource);
    } catch {}
  }, [forwardSource]);
  const [data, setData] = useState<CareerSeasonPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGwIndex, setSelectedGwIndex] = useState<number>(0);
  const [lineupSource, setLineupSource] = useState<'ai' | 'human' | 'dynamic'>('human');
  const [dynamicData, setDynamicData] = useState<CareerSeasonPayload | null>(null);
  const [loadingDynamic, setLoadingDynamic] = useState<boolean>(false);

  const hydrateLiveScores = async (payload: CareerSeasonPayload): Promise<CareerSeasonPayload> => {
    if (!payload || payload.mode === 'forward' || !Array.isArray(payload.gameweeks) || payload.gameweeks.length === 0) {
      return payload;
    }
    try {
      const cloned: CareerSeasonPayload = JSON.parse(JSON.stringify(payload));
      const latestGw = cloned.gameweeks[cloned.gameweeks.length - 1];
      const liveRes = await axios.get(`/api/live/${latestGw.gameweek}`);
      const elements = Array.isArray(liveRes.data) ? liveRes.data : (liveRes.data?.elements || []);
      if (!Array.isArray(elements) || elements.length === 0) return payload;

      const liveMap: Record<number, { points: number; minutes: number }> = {};
      elements.forEach((el: any) => {
        liveMap[el.id] = {
          points: Number(el.stats?.total_points ?? 0),
          minutes: Number(el.stats?.minutes ?? 0)
        };
      });

      const hasLivePoints = Object.values(liveMap).some(s => s.points !== 0 || s.minutes > 0);
      if (!hasLivePoints) return payload;

      let gross = 0;
      latestGw.startingXI.forEach(p => {
        if (liveMap[p.id]) {
          p.points = liveMap[p.id].points;
          p.minutes = liveMap[p.id].minutes;
        }
        gross += p.points * p.multiplier;
      });
      latestGw.bench.forEach(p => {
        if (liveMap[p.id]) {
          p.points = liveMap[p.id].points;
          p.minutes = liveMap[p.id].minutes;
        }
      });
      if (latestGw.captain && liveMap[latestGw.captain.id]) {
        latestGw.captain.points = liveMap[latestGw.captain.id].points;
        latestGw.captain.minutes = liveMap[latestGw.captain.id].minutes;
      }
      if (latestGw.viceCaptain && liveMap[latestGw.viceCaptain.id]) {
        latestGw.viceCaptain.points = liveMap[latestGw.viceCaptain.id].points;
        latestGw.viceCaptain.minutes = liveMap[latestGw.viceCaptain.id].minutes;
      }
      if (latestGw.activeCaptain && liveMap[latestGw.activeCaptain.id]) {
        latestGw.activeCaptain.points = liveMap[latestGw.activeCaptain.id].points;
        latestGw.activeCaptain.minutes = liveMap[latestGw.activeCaptain.id].minutes;
      }

      latestGw.grossPoints = gross;
      latestGw.netPoints = gross - (latestGw.hitCostPoints || 0);
      if (latestGw.decisionLog && latestGw.activeCaptain) {
        const capPts = latestGw.activeCaptain.points * (latestGw.activeCaptain.multiplier || 2);
        latestGw.decisionLog = latestGw.decisionLog.replace(
          /Captain:\s*([^(\n]+)\(\d+\s*pts\)/,
          `Captain: ${latestGw.activeCaptain.web_name} (${capPts} pts)`
        );
      }

      let runningTotal = 0;
      cloned.gameweeks.forEach(g => {
        runningTotal += g.netPoints;
        g.cumulativePoints = runningTotal;
      });
      cloned.totalPoints = runningTotal;

      if (latestGw.humanComparison && cloned.humanSummary) {
        latestGw.humanComparison.alphaDelta = latestGw.netPoints - latestGw.humanComparison.netPoints;
        let cumAlpha = 0;
        cloned.gameweeks.forEach(g => {
          if (g.humanComparison) {
            cumAlpha += g.humanComparison.alphaDelta;
            g.humanComparison.cumulativeAlphaDelta = cumAlpha;
          }
        });
        cloned.humanSummary.netAlphaVsHuman = cumAlpha;
      }

      return cloned;
    } catch {
      return payload;
    }
  };

  useEffect(() => {
    if (mode === 'forward') {
      fetchCareerData();
    }
  }, [forwardSource]);

  const fetchCareerData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/career', {
        params: {
          mode,
          teamId: teamId || undefined,
          fuel: activeFuel,
          riskMode: activeRisk,
          scenario: activeScenario,
          forwardSource: mode === 'forward' ? forwardSource : undefined
        }
      });
      if (!res.data || typeof res.data !== 'object' || !Array.isArray(res.data.gameweeks)) {
        throw new Error("Server returned an invalid response (HTML fallback received). Please restart your local dev server so the new API route is loaded.");
      }
      const hydrated = await hydrateLiveScores(res.data);
      setData(hydrated);
      if (hydrated.gameweeks.length > 0) {
        const isForward = hydrated.mode === 'forward' || mode === 'forward';
        const defaultIndex = isForward ? 0 : hydrated.gameweeks.length - 1;
        setSelectedGwIndex(prev => (prev >= 0 && prev < hydrated.gameweeks.length) ? prev : defaultIndex);
      }

      if (mode === 'synced' && teamId === '532002') {
        setLoadingDynamic(true);
        axios.get('/api/career', {
          params: {
            mode: 'synced',
            teamId,
            fuel: activeFuel,
            riskMode: activeRisk,
            scenario: activeScenario,
            syncedSource: 'dynamic'
          }
        }).then(async dynRes => {
          if (dynRes.data && Array.isArray(dynRes.data.gameweeks)) {
            const dynHydrated = await hydrateLiveScores(dynRes.data);
            setDynamicData(dynHydrated);
          }
        }).catch(err => {
          console.warn("[CareerModeView] Dynamic resolve fetch failed:", err);
        }).finally(() => {
          setLoadingDynamic(false);
        });
      } else {
        setDynamicData(null);
      }
    } catch (err: any) {
      console.error("Career Mode Fetch Error:", err);
      setError(err.response?.data?.error || err.message || "Failed to load AI Career simulation.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCareerData();
  }, [mode, teamId, activeFuel, activeRisk, activeScenario]);

  // Periodically poll live matchday scores every 60 seconds when viewing historical/active gameweeks
  useEffect(() => {
    if (mode === 'forward') return;
    const interval = setInterval(async () => {
      if (data) {
        const updated = await hydrateLiveScores(data);
        setData(updated);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [mode, data]);

  const activeGwData = data?.gameweeks?.[selectedGwIndex] || data?.gameweeks?.[0] || null;

  return (
    <div className="space-y-6">
      {/* Top Banner & Mode Toggle */}
      <div className="bg-slate-950/80 p-3.5 sm:p-5 rounded-2xl border border-fpl-border shadow-xl space-y-3.5 sm:space-y-4">
        {/* ROW 1: Header (Icon, Title, Badges, and Top-Right Refresh Button) */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-fpl-green/10 border border-fpl-green/30 flex items-center justify-center text-fpl-green shadow-[0_0_15px_rgba(0,255,133,0.2)] shrink-0 mt-0.5 sm:mt-0">
              <Bot className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black uppercase tracking-wider text-white">AI Season Career</h2>
                <span className="px-1.5 sm:px-2 py-0.5 rounded text-[8.5px] sm:text-[9px] font-mono font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 whitespace-nowrap">
                  OFFICIAL 1 FT / GW
                </span>
                {mode === 'autonomous' && (
                  <span className="px-1.5 sm:px-2 py-0.5 rounded text-[8.5px] sm:text-[9px] font-mono font-bold bg-fpl-green/15 text-fpl-green border border-fpl-green/30 whitespace-nowrap">
                    AUTONOMOUS AI SQUAD
                  </span>
                )}
                {mode === 'synced' && (
                  <span className="px-1.5 sm:px-2 py-0.5 rounded text-[8.5px] sm:text-[9px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                    YOU VS AI DUEL
                  </span>
                )}
                {mode === 'forward' && (
                  <span className="px-1.5 sm:px-2 py-0.5 rounded text-[8.5px] sm:text-[9px] font-mono font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 whitespace-nowrap">
                    FORWARD ROADMAP
                  </span>
                )}
                <span className="hidden md:inline-block px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 uppercase whitespace-nowrap">
                  {activeFuel}
                </span>
                <span className="hidden md:inline-block px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 uppercase whitespace-nowrap">
                  {activeRisk}
                </span>
                <span className="hidden lg:inline-block px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20 uppercase whitespace-nowrap">
                  {activeScenario === 'template' ? 'Template Shield' : 'Quant Optimal'}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-1 line-clamp-2 sm:line-clamp-none">
                {mode === 'synced' && teamId 
                  ? `Counterfactual Replay: Human vs AI starting from ${data?.managerName || 'Your'} GW1 Squad`
                  : mode === 'forward'
                  ? forwardSource === 'duel'
                    ? `Forward Roadmap: Projected 1-FT Moves for AI Co-Pilot (${data?.teamName || 'Duel Branch'}, GW1–${(data?.startGw || 12) - 1} Base: ${data?.basePoints ?? 0} pts) from GW${data?.startGw || 12} → GW${data?.endGw || 17}`
                    : forwardSource === 'synced'
                    ? `Forward Roadmap: Projected 1-FT Moves for Your Real Team (${data?.managerName || 'Current FPL Squad'}, GW1–${(data?.startGw || 12) - 1} Base: ${data?.basePoints ?? 0} pts) from GW${data?.startGw || 12} → GW${data?.endGw || 17}`
                    : `Forward Roadmap: Projected 1-FT Moves for Autonomous AI (£100.0m Draft, GW1–${(data?.startGw || 12) - 1} Base: ${data?.basePoints ?? 0} pts) from GW${data?.startGw || 12} → GW${data?.endGw || 17}`
                  : "Autonomous AI Manager navigating the season from £100.0m with squad continuity"}
              </p>
            </div>
          </div>

          {/* Dedicated Refresh Button - Pinned Top Right */}
          <button 
            onClick={fetchCareerData}
            disabled={loading}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 bg-slate-900/90 hover:bg-slate-800 active:scale-95 text-slate-300 hover:text-white rounded-xl border border-slate-700/80 shadow-sm transition-all cursor-pointer"
            title="Re-run Simulation / Refresh Data"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 text-fpl-green shrink-0", loading && "animate-spin")} />
            <span className="text-[11px] sm:text-xs font-bold hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* ROW 2: Primary Mode Selector Tabs */}
        <div className="pt-2 sm:pt-3 border-t border-slate-800/80">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
              Select Mode:
            </span>
            <div className="flex items-center gap-2 md:hidden text-[9px] font-mono text-slate-400">
              <span className="uppercase">{activeFuel}</span>
              <span>•</span>
              <span className="uppercase">{activeRisk}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2 bg-slate-900/90 p-1 sm:p-1.5 rounded-xl border border-fpl-border w-full">
            <button
              onClick={() => setMode('autonomous')}
              className={cn(
                "px-2 sm:px-3 py-2 rounded-lg text-[11px] sm:text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer truncate",
                mode === 'autonomous'
                  ? "bg-fpl-green text-slate-950 shadow-[0_0_12px_rgba(0,255,133,0.3)] font-black"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              )}
            >
              <Bot className="w-3.5 h-3.5 shrink-0 hidden xs:inline sm:inline" />
              <span className="truncate">Autonomous AI</span>
            </button>
            
            <button
              onClick={() => setMode('synced')}
              disabled={!teamId}
              title={!teamId ? "Enter a Team ID in the header to unlock Synced Replay" : "Replay with your actual GW1 squad"}
              className={cn(
                "px-2 sm:px-3 py-2 rounded-lg text-[11px] sm:text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer truncate",
                mode === 'synced'
                  ? "bg-fpl-green text-slate-950 shadow-[0_0_12px_rgba(0,255,133,0.3)] font-black"
                  : teamId 
                  ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  : "text-slate-600 opacity-50 cursor-not-allowed"
              )}
            >
              <Swords className="w-3.5 h-3.5 shrink-0 hidden xs:inline sm:inline" />
              <span className="truncate">You vs AI Duel</span>
              {teamId && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>}
            </button>

            <button
              onClick={() => {
                setMode('forward');
                setSelectedGwIndex(0);
              }}
              className={cn(
                "px-2 sm:px-3 py-2 rounded-lg text-[11px] sm:text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer truncate",
                mode === 'forward'
                  ? "bg-fpl-green text-slate-950 shadow-[0_0_12px_rgba(0,255,133,0.3)] font-black"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              )}
            >
              <TrendingUp className="w-3.5 h-3.5 shrink-0 hidden xs:inline sm:inline" />
              <span className="truncate">Forward Roadmap</span>
            </button>
          </div>
        </div>

        {/* ROW 3: Dedicated Forecast Source Sub-Bar (Rendered only when Forward Roadmap is active) */}
        {mode === 'forward' && (
          <div className="p-2 sm:p-2.5 bg-sky-950/20 border border-sky-500/25 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-sky-400 font-semibold px-0.5">
              <span className="flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-sky-400 shrink-0" />
                <span>Forecast Starting Squad:</span>
              </span>
              {forwardSource === 'duel' && (
                <button
                  onClick={() => setMode('synced')}
                  className="text-[10px] text-amber-300 hover:underline flex items-center gap-1 cursor-pointer font-sans normal-case"
                  title="Switch to You vs AI Duel Replay"
                >
                  <span>← Back to Past Duel Replay</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              {teamId && (
                <button
                  onClick={() => {
                    setForwardSource('duel');
                    setSelectedGwIndex(0);
                  }}
                  className={cn(
                    "w-full px-2.5 py-1.5 sm:py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border text-center",
                    forwardSource === 'duel'
                      ? "bg-amber-500/25 text-amber-300 border-amber-500/50 shadow-sm font-black"
                      : "bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"
                  )}
                  title="Project forward from the AI Co-Pilot's squad that branched from your GW1 selection"
                >
                  <Swords className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">AI Co-Pilot (Duel)</span>
                </button>
              )}
              {teamId && (
                <button
                  onClick={() => {
                    setForwardSource('synced');
                    setSelectedGwIndex(0);
                  }}
                  className={cn(
                    "w-full px-2.5 py-1.5 sm:py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border text-center",
                    forwardSource === 'synced'
                      ? "bg-fpl-green/25 text-fpl-green border-fpl-green/50 shadow-sm font-black"
                      : "bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"
                  )}
                  title="Project forward from your actual current FPL team on fantasy.premierleague.com"
                >
                  <UserCheck className="w-3.5 h-3.5 text-fpl-green shrink-0" />
                  <span className="truncate">My Real Squad</span>
                </button>
              )}
              <button
                onClick={() => {
                  setForwardSource('autonomous');
                  setSelectedGwIndex(0);
                }}
                className={cn(
                  "w-full px-2.5 py-1.5 sm:py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border text-center",
                  forwardSource === 'autonomous'
                    ? "bg-purple-500/25 text-purple-300 border-purple-500/50 shadow-sm font-black"
                    : "bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"
                )}
                title="Project forward from the Autonomous AI £100.0m draft"
              >
                <Bot className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span className="truncate">Autonomous AI</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/40 rounded-2xl text-red-400 text-xs font-mono flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3">
          <RefreshCw className="w-7 h-7 text-fpl-green animate-spin" />
          <p className="text-xs font-mono text-slate-400 uppercase tracking-widest">
            Simulating Human Gameweek Sequences...
          </p>
        </div>
      ) : data && Array.isArray(data.gameweeks) && data.gameweeks.length > 0 ? (
        <>
          {/* Season Metric KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* KPI 1: Total Points */}
            <div className="bg-slate-950 border border-fpl-border rounded-2xl p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[10px] font-mono uppercase tracking-wider font-bold">
                  {mode === 'forward' ? `Projected Season Total (GW${data.endGw})` : "Total Season Points"}
                </span>
                <Trophy className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-black text-white font-mono">{data.totalPoints} pts</div>
                <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                  {mode === 'forward' ? (
                    <span>
                      GW1-{(data.startGw || 12) - 1} Base: <strong className="text-white">{data.basePoints ?? 0} pts</strong> • Projected: <strong className="text-emerald-400">+{data.forwardPoints ?? (data.totalPoints - (data.basePoints ?? 0))} xP</strong>
                    </span>
                  ) : (
                    <span>Avg: {(data.totalPoints / (data.gameweeks?.length || 1)).toFixed(1)} pts/GW</span>
                  )}
                </div>
              </div>
            </div>

            {/* KPI 2: Forward Horizon Yield, Human Comparison Delta, or Transfers Made */}
            {mode === 'forward' ? (
              <div className="bg-slate-950 border border-fpl-border rounded-2xl p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Forward Horizon Yield</span>
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <div className="text-2xl font-black text-emerald-400 font-mono">
                    +{data.forwardPoints ?? (data.totalPoints - (data.basePoints ?? 0))} <span className="text-xs font-normal text-slate-400">xP</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    Avg: {((data.forwardPoints ?? (data.totalPoints - (data.basePoints ?? 0))) / (data.gameweeks?.length || 1)).toFixed(1)} xP/GW (GW{data.startGw} → GW{data.endGw})
                  </div>
                </div>
              </div>
            ) : mode === 'synced' && data.humanSummary ? (
              <div className="bg-slate-950 border border-fpl-border rounded-2xl p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Alpha vs Human Score</span>
                  {data.humanSummary.netAlphaVsHuman >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-rose-400" />
                  )}
                </div>
                <div>
                  <div className={cn(
                    "text-2xl font-black font-mono",
                    data.humanSummary.netAlphaVsHuman >= 0 ? "text-emerald-400" : "text-rose-400"
                  )}>
                    {data.humanSummary.netAlphaVsHuman >= 0 ? `+${data.humanSummary.netAlphaVsHuman}` : data.humanSummary.netAlphaVsHuman} pts
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    {teamId === '532002' && dynamicData ? (
                      <span>You: <strong className="text-white">{data.humanSummary.totalPoints}</strong> • Frozen: <strong className="text-emerald-400">{data.totalPoints}</strong> • Dynamic: <strong className="text-purple-400">{dynamicData.totalPoints}</strong> pts</span>
                    ) : (
                      <span>You: {data.humanSummary.totalPoints} pts • AI: {data.totalPoints} pts</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-950 border border-fpl-border rounded-2xl p-4 flex flex-col justify-between shadow-sm">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Transfers Discipline</span>
                  <Zap className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <div className="text-2xl font-black text-white font-mono">
                    {data.totalTransfersMade} <span className="text-xs font-normal text-slate-500">used</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    {data.totalTransfersRolled} rolled • 0 point hits taken
                  </div>
                </div>
              </div>
            )}

            {/* KPI 3: Financial Health */}
            <div className="bg-slate-950 border border-fpl-border rounded-2xl p-4 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Team Value & Bank</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="text-2xl font-black text-fpl-green font-mono">{data.finalTeamValue}</div>
                <div className="text-[10px] text-slate-400 mt-1">
                  Bank: <span className="text-white font-bold">{data.finalBank}</span> in reserve
                </div>
              </div>
            </div>

            {/* KPI 4: Hit Savings or Discipline */}
            <div className="bg-slate-950 border border-fpl-border rounded-2xl p-4 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Hits Deduction</span>
                <Shield className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-black text-white font-mono">
                  {data.totalHitsCost > 0 ? `-${data.totalHitsCost} pts` : "0 pts"}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {mode === 'synced' && data.humanSummary?.totalHitsCost 
                    ? `You took -${data.humanSummary.totalHitsCost} pts in hits`
                    : "Zero unnecessary hit penalties"}
                </div>
              </div>
            </div>
          </div>

          {/* 2026/27 Two-Set Chip System HUD */}
          <div className="bg-gradient-to-r from-purple-950/40 via-indigo-950/30 to-slate-950/60 p-3.5 rounded-2xl border border-purple-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                <span className="text-xs font-black text-purple-300 uppercase tracking-widest">
                  2026/27 Chip System: Set 1 Active (GW1–GW19)
                </span>
                <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase tracking-wider">
                  GW19 Expiration Cutoff
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Set 1 chips must be deployed before Gameweek 19 or they expire. All 4 chips held in reserve for high-xP/Double Gameweek execution. Fresh Set 2 unlocks in GW20.
              </p>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: 'WC', label: 'Wildcard' },
                { id: 'TC', label: 'Triple Cap' },
                { id: 'BB', label: 'Bench Boost' },
                { id: 'FH', label: 'Free Hit' }
              ].map(chip => (
                <span 
                  key={chip.id}
                  className="px-2 py-0.5 rounded text-[9.5px] font-mono font-bold bg-slate-900 border border-emerald-500/40 text-emerald-300 flex items-center gap-1"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {chip.label}
                </span>
              ))}
            </div>
          </div>

          {/* Gameweek Step Timeline */}
          <div className="bg-slate-950 border border-fpl-border rounded-2xl p-3">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400">Gameweek Timeline</span>
              <span className="text-[10px] font-mono text-slate-500">Click a Gameweek to inspect matchday</span>
            </div>
            
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {data.gameweeks.map((gw, idx) => {
                const isSelected = idx === selectedGwIndex;
                const alpha = gw.humanComparison?.alphaDelta;
                return (
                  <button
                    type="button"
                    key={gw.gameweek}
                    onClick={() => setSelectedGwIndex(idx)}
                    className={cn(
                      "flex flex-col items-center min-w-[70px] py-2 px-2.5 rounded-xl border text-center transition-all cursor-pointer",
                      isSelected 
                        ? "bg-slate-800 border-fpl-green shadow-[0_0_15px_rgba(0,255,133,0.25)]" 
                        : "bg-slate-900/60 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700"
                    )}
                  >
                    <span className={cn(
                      "text-[10px] font-mono font-black uppercase",
                      isSelected ? "text-fpl-green" : "text-slate-400"
                    )}>
                      GW{gw.gameweek}
                    </span>
                    <span className="text-xs font-black font-mono text-white mt-0.5">
                      {mode === 'forward'
                        ? `${(gw.expectedPoints ?? gw.netPoints).toFixed(1)} xP`
                        : `${gw.netPoints} pts`}
                    </span>
                    {gw.chipActive && (
                      <span className="text-[8px] font-mono font-black px-1.5 py-0.2 rounded bg-purple-500/30 text-purple-300 border border-purple-500/50 uppercase mt-0.5">
                        {gw.chipActive}
                      </span>
                    )}
                    {mode === 'synced' && alpha !== undefined && (
                      <span className={cn(
                        "text-[9px] font-mono font-bold mt-1",
                        alpha > 0 ? "text-emerald-400" : alpha < 0 ? "text-rose-400" : "text-slate-400"
                      )}>
                        {alpha > 0 ? `+${alpha}` : alpha}
                      </span>
                    )}
                    {gw.isRolledTransfer && (
                      <span className="text-[8px] font-mono text-cyan-400 mt-0.5">ROLLED</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Gameweek Detail Card */}
          {activeGwData && (() => {
            const dynamicGwData = dynamicData?.gameweeks?.find(g => g.gameweek === activeGwData.gameweek);
            const isHumanView = mode === 'synced' && lineupSource === 'human' && !!activeGwData.humanComparison?.startingXI;
            const isDynamicView = mode === 'synced' && lineupSource === 'dynamic';

            const displayedStartingXI = isHumanView 
              ? activeGwData.humanComparison!.startingXI! 
              : isDynamicView 
              ? (dynamicGwData?.startingXI || []) 
              : (activeGwData.startingXI || []);
            const displayedBench = isHumanView 
              ? (activeGwData.humanComparison!.bench || []) 
              : isDynamicView 
              ? (dynamicGwData?.bench || []) 
              : (activeGwData.bench || []);
            const displayedCaptain = isHumanView 
              ? (activeGwData.humanComparison!.captain || activeGwData.activeCaptain) 
              : isDynamicView 
              ? (dynamicGwData?.activeCaptain || dynamicGwData?.captain) 
              : activeGwData.activeCaptain;
            const displayedViceCaptain = isHumanView 
              ? (activeGwData.humanComparison!.viceCaptain || activeGwData.viceCaptain) 
              : isDynamicView 
              ? (dynamicGwData?.viceCaptain || dynamicGwData?.viceCaptain) 
              : activeGwData.viceCaptain;
            const displayedTransfersIn = isHumanView 
              ? (activeGwData.humanComparison!.transfersIn || []) 
              : isDynamicView 
              ? (dynamicGwData?.transfersIn || []) 
              : (activeGwData.transfersIn || []);
            const displayedTransfersOut = isHumanView 
              ? (activeGwData.humanComparison!.transfersOut || []) 
              : isDynamicView 
              ? (dynamicGwData?.transfersOut || []) 
              : (activeGwData.transfersOut || []);

            return (
            <div className="grid grid-cols-12 gap-4">
              {/* Left Column: Manager Decision Log & Human Head-to-Head */}
              <div className="col-span-12 lg:col-span-5 space-y-4">
                {/* Decision Breakdown Box */}
                <div className="bg-slate-950 border border-fpl-border rounded-2xl p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b border-fpl-border/60 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-fpl-green" />
                      <h3 className="text-xs font-black uppercase tracking-wider text-white">
                        GW{activeGwData.gameweek}{" "}
                        {isHumanView 
                          ? (teamId === '532002' ? "Your Real Decision" : "Real Manager Decision") 
                          : isDynamicView 
                          ? "Dynamic AI Decision" 
                          : (teamId === '532002' ? "Frozen AI Decision" : "Manager Decision")}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2.5">
                      {mode === 'forward' ? (
                        <span className="text-xs font-mono text-emerald-400 font-bold">
                          {(activeGwData.expectedPoints ?? activeGwData.netPoints).toFixed(1)} Projected xP
                        </span>
                      ) : isHumanView ? (
                        <span className="text-[10px] font-mono text-cyan-400 font-bold">
                          {activeGwData.humanComparison?.netPoints || 43} Net Pts
                        </span>
                      ) : isDynamicView ? (
                        <span className="text-[10px] font-mono text-purple-400 font-bold">
                          {dynamicGwData?.netPoints ?? 0} Net Pts
                        </span>
                      ) : (
                        <>
                          {activeGwData.expectedPoints !== undefined && (
                            <div className="flex items-center gap-1.5 font-mono text-[10px]">
                              <span className="text-slate-400">
                                Exp: <strong className="text-white">{activeGwData.expectedPoints.toFixed(1)} xP</strong>
                              </span>
                              <span className="text-slate-600">•</span>
                              <span className={cn(
                                "px-1.5 py-0.5 rounded font-black border",
                                activeGwData.netPoints >= activeGwData.expectedPoints
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                  : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                              )}>
                                {(activeGwData.netPoints - activeGwData.expectedPoints) >= 0 ? '+' : ''}
                                {(activeGwData.netPoints - activeGwData.expectedPoints).toFixed(1)} vs xP
                              </span>
                            </div>
                          )}
                          <span className="text-[10px] font-mono text-emerald-400 font-bold">
                            {activeGwData.netPoints} Net Pts
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    {isHumanView 
                      ? (activeGwData.humanComparison?.decisionLog || (displayedTransfersIn.length > 0 
                          ? `Real Transfer: ${displayedTransfersIn.map((t, i) => `${displayedTransfersOut[i]?.name || 'Player'} (${displayedTransfersOut[i]?.position || ''}) → ${t.name} (${t.position || ''})`).join(', ')}. Captain: ${displayedCaptain?.web_name || 'Haaland'} (2×).`
                          : "No transfers made in real life (Free Transfer rolled)."))
                      : isDynamicView 
                      ? (dynamicGwData?.decisionLog || (loadingDynamic ? "Solving dynamic point-in-time replay on the fly..." : "Dynamic solve finished."))
                      : activeGwData.decisionLog}
                  </p>

                  {/* Transfer Action Details */}
                  <div className="space-y-2 pt-2 border-t border-fpl-border/40">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase font-bold text-slate-400">
                      <span>
                        {isHumanView 
                          ? (teamId === '532002' ? "Your Real Transfer Execution" : "Real Transfer Execution") 
                          : isDynamicView 
                          ? "Dynamic AI Transfer Execution" 
                          : (teamId === '532002' ? "Frozen AI Transfer Execution" : "Transfer Execution")}
                      </span>
                      {mode === 'synced' && activeGwData.humanComparison?.startingXI && (
                        <button
                          onClick={() => {
                            if (teamId === '532002') {
                              setLineupSource(prev => prev === 'human' ? 'ai' : prev === 'ai' ? 'dynamic' : 'human');
                            } else {
                              setLineupSource(prev => prev === 'ai' ? 'human' : 'ai');
                            }
                          }}
                          className="text-[9px] text-cyan-400 hover:underline normal-case font-sans cursor-pointer"
                        >
                          Switch to {teamId === '532002' 
                            ? (isHumanView ? "Frozen AI" : isDynamicView ? "My Real Squad" : "Dynamic AI")
                            : (isHumanView ? "AI Lineup" : "Real Squad")}
                        </button>
                      )}
                    </div>
                    {displayedTransfersIn.length > 0 ? (
                      <div className="space-y-1.5">
                        {displayedTransfersIn.map((tIn, i) => {
                          const tOut = displayedTransfersOut[i];
                          return (
                            <div key={i} className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 text-xs space-y-1.5">
                              {/* Row 1: Player Out */}
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 font-mono font-bold uppercase border border-rose-500/30 leading-none shrink-0">
                                  OUT
                                </span>
                                {tOut?.position && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono font-bold uppercase border border-slate-700 leading-none shrink-0">
                                    {tOut.position}
                                  </span>
                                )}
                                <span className="text-rose-400 line-through font-medium">
                                  {tOut?.name || 'Player'}
                                </span>
                              </div>

                              {/* Row 2: Player In + Price Docked Right */}
                              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono font-bold uppercase border border-emerald-500/30 leading-none shrink-0">
                                    IN
                                  </span>
                                  {tIn?.position && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 font-mono font-bold uppercase leading-none shrink-0">
                                      {tIn.position}
                                    </span>
                                  )}
                                  <span className="text-emerald-400 font-bold">
                                    {tIn.name}
                                  </span>
                                </div>
                                <span className="text-[11px] font-mono text-slate-200 font-semibold px-2 py-0.5 rounded bg-slate-800 border border-slate-700 shrink-0">
                                  {tIn.costDisplay}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 text-xs text-cyan-300 font-mono flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>
                          {isHumanView 
                            ? "No transfers made in real life (Free Transfer rolled)" 
                            : `Rolled Free Transfer — Banked ${activeGwData.freeTransfersRemaining} FTs for next week`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Auto-Subs Callout (if any triggered, ONLY for AI view) */}
                  {!isHumanView && (activeGwData.autoSubs?.length || 0) > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-fpl-border/40">
                      <div className="text-[10px] font-mono uppercase font-bold text-amber-400 flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        <span>Bench Auto-Substitution Triggered</span>
                      </div>
                      {(activeGwData.autoSubs || []).map((as, idx) => (
                        <div key={idx} className="bg-amber-500/10 border border-amber-500/30 p-2 rounded-xl text-xs text-amber-300 flex items-center justify-between font-mono">
                          <span>{as.inPlayer} subbed in for {as.outPlayer}</span>
                          <span className="font-bold text-emerald-400">+{as.points} pts</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Financial State */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono pt-2 border-t border-fpl-border/40 text-slate-400">
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span>Bank:</span>
                      <strong className="text-white font-bold">
                        {isHumanView 
                          ? (activeGwData.humanComparison?.bankDisplay || "£0.4m") 
                          : isDynamicView 
                          ? (dynamicGwData?.bankDisplay || "£0.0m") 
                          : activeGwData.bankDisplay}
                      </strong>
                    </div>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span>Squad:</span>
                      <strong className="text-white font-bold">
                        {isHumanView 
                          ? (activeGwData.humanComparison?.squadValueDisplay || "£101.8m") 
                          : isDynamicView
                          ? `£${((dynamicGwData?.squadValue || 1000) / 10).toFixed(1)}m`
                          : `£${((activeGwData.squadValue || 914) / 10).toFixed(1)}m`}
                      </strong>{" "}
                      <span className="text-slate-500">
                        ({isHumanView 
                          ? (activeGwData.humanComparison?.teamValueDisplay || "£102.2m") 
                          : isDynamicView 
                          ? (dynamicGwData?.teamValueDisplay || "£100.0m") 
                          : activeGwData.teamValueDisplay})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Head-to-Head Duel Card (Synced Mode) */}
                {mode === 'synced' && activeGwData.humanComparison && (
                  <div className="bg-slate-950 border border-fpl-border rounded-2xl p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between border-b border-fpl-border/60 pb-2">
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-cyan-400" />
                        <div>
                          <h4 className="text-xs font-black uppercase tracking-wider text-white">
                            {teamId === '532002' ? "Tri-Perspective Matchup Duel" : "You vs AI Co-Pilot"}
                          </h4>
                          <span className="text-[9px] text-slate-400 block font-mono">
                            {teamId === '532002' ? "Real Matchday vs Frozen Co-Pilot vs Dynamic AI Resolver" : "Head-to-head matchup duel"}
                          </span>
                        </div>
                      </div>
                      <span className={cn(
                        "text-[10px] font-mono font-bold px-2 py-0.5 rounded",
                        activeGwData.humanComparison.alphaDelta >= 0 
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                      )}>
                        {activeGwData.humanComparison.alphaDelta >= 0 
                          ? `AI +${activeGwData.humanComparison.alphaDelta} pts ahead` 
                          : `You +${Math.abs(activeGwData.humanComparison.alphaDelta)} pts ahead`}
                      </span>
                    </div>

                    {/* Both squads compared side-by-side (Clickable to switch view) */}
                    <div className={cn(
                      "grid gap-2 text-xs",
                      teamId === '532002' ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2"
                    )}>
                      {/* Perspective 1: Real Team */}
                      <button
                        onClick={() => setLineupSource('human')}
                        className={cn(
                          teamId === '532002' ? "p-2.5" : "p-3",
                          "rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between overflow-hidden",
                          isHumanView 
                            ? "bg-cyan-950/30 border-cyan-500/50 ring-1 ring-cyan-500/40 shadow-sm" 
                            : "bg-slate-900/60 border-slate-800 hover:border-cyan-500/30 opacity-75 hover:opacity-100"
                        )}
                        title={teamId === '532002' ? "Click to view My Real XI on the pitch" : "Click to view Real Manager XI on the pitch"}
                      >
                        <div className="min-h-[16px] mb-1">
                          <span className={cn(
                            "text-[10px] uppercase font-mono font-bold block truncate",
                            isHumanView ? "text-cyan-400" : "text-slate-400"
                          )}>
                            {teamId === '532002' ? "My Real Team" : (data?.managerName ? `${data.managerName}'s Team` : "Real Team")}
                          </span>
                        </div>
                        <div className={cn("text-lg font-black font-mono leading-none", isHumanView ? "text-cyan-300" : "text-white")}>
                          {activeGwData.humanComparison.netPoints} pts
                        </div>
                        <div className="min-h-[18px] my-1 flex items-center">
                          {isHumanView && (
                            <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shrink-0 leading-none flex items-center gap-1">
                              <span className="w-1 h-1 rounded-full bg-cyan-400 animate-pulse shrink-0" />
                              Viewing
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono min-h-[16px]">
                          Hits: {activeGwData.humanComparison.transfersCost ? `-${activeGwData.humanComparison.transfersCost} pts` : '0 pts'}
                        </div>
                      </button>

                      {/* Perspective 2: Frozen AI Co-Pilot */}
                      <button
                        onClick={() => setLineupSource('ai')}
                        className={cn(
                          teamId === '532002' ? "p-2.5" : "p-3",
                          "rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between overflow-hidden",
                          lineupSource === 'ai' 
                            ? "bg-emerald-950/30 border-emerald-500/50 ring-1 ring-emerald-500/40 shadow-sm" 
                            : "bg-slate-900/60 border-slate-800 hover:border-emerald-500/30 opacity-75 hover:opacity-100"
                        )}
                        title="Click to view AI Co-Pilot (Frozen) XI on the pitch"
                      >
                        <div className="min-h-[16px] mb-1">
                          <span className={cn(
                            "text-[10px] uppercase font-mono font-bold block truncate",
                            lineupSource === 'ai' ? "text-emerald-400" : "text-slate-400"
                          )}>
                            {teamId === '532002' ? "AI Co-Pilot (Frozen)" : "AI Co-Pilot Team"}
                          </span>
                        </div>
                        <div className={cn("text-lg font-black font-mono leading-none", lineupSource === 'ai' ? "text-emerald-400" : "text-white")}>
                          {activeGwData.netPoints} pts
                        </div>
                        <div className="min-h-[18px] my-1 flex items-center">
                          {lineupSource === 'ai' && (
                            <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40 shrink-0 leading-none flex items-center gap-1">
                              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                              Viewing
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono min-h-[16px]">
                          Hits: {activeGwData.hitCostPoints ? `-${activeGwData.hitCostPoints} pts` : '0 pts'}
                        </div>
                      </button>

                      {/* Perspective 3: Dynamic AI Resolver (when teamId === '532002') */}
                      {teamId === '532002' && (
                        <button
                          onClick={() => setLineupSource('dynamic')}
                          className={cn(
                            "p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between overflow-hidden",
                            isDynamicView 
                              ? "bg-purple-950/30 border-purple-500/50 ring-1 ring-purple-500/40 shadow-sm" 
                              : "bg-slate-900/60 border-slate-800 hover:border-purple-500/30 opacity-75 hover:opacity-100"
                          )}
                          title="Click to view Dynamic AI Resolver XI on the pitch"
                        >
                          <div className="min-h-[16px] mb-1">
                            <span className={cn(
                              "text-[10px] uppercase font-mono font-bold block truncate",
                              isDynamicView ? "text-purple-400" : "text-slate-400"
                            )}>
                              Dynamic AI (Live)
                            </span>
                          </div>
                          <div className={cn("text-lg font-black font-mono leading-none", isDynamicView ? "text-purple-300" : "text-white")}>
                            {loadingDynamic && !dynamicGwData ? (
                              <span className="text-xs text-purple-400 animate-pulse font-sans">Solving...</span>
                            ) : (
                              `${dynamicGwData?.netPoints ?? 0} pts`
                            )}
                          </div>
                          <div className="min-h-[18px] my-1 flex items-center">
                            {isDynamicView && (
                              <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/40 shrink-0 leading-none flex items-center gap-1">
                                <span className="w-1 h-1 rounded-full bg-purple-400 animate-pulse shrink-0" />
                                Viewing
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono min-h-[16px]">
                            Hits: {loadingDynamic && !dynamicGwData ? '...' : (dynamicGwData?.hitCostPoints ? `-${dynamicGwData.hitCostPoints} pts` : '0 pts')}
                          </div>
                        </button>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-400 pt-1 font-sans">
                      {teamId === '532002' && dynamicGwData ? (
                        <span>
                          Cumulative Score after GW{activeGwData.gameweek}: You <strong className="text-cyan-400 font-mono">{activeGwData.humanComparison.cumulativePoints} pts</strong> vs Frozen AI <strong className="text-emerald-400 font-mono">{activeGwData.cumulativePoints} pts</strong> vs Dynamic AI <strong className="text-purple-400 font-mono">{loadingDynamic ? '...' : `${dynamicGwData.cumulativePoints} pts`}</strong>.
                        </span>
                      ) : (
                        <span>
                          Cumulative Score after GW{activeGwData.gameweek}: You <strong className="text-white font-mono">{activeGwData.humanComparison.cumulativePoints} pts</strong> vs AI <strong className="text-emerald-400 font-mono">{activeGwData.cumulativePoints} pts</strong>.
                        </span>
                      )}
                    </div>

                    {(() => {
                      const latestGw = data?.gameweeks?.[data.gameweeks.length - 1]?.gameweek || activeGwData.gameweek || 11;
                      const nextGw = latestGw + 1;
                      const nextHorizonEnd = Math.min(38, latestGw + 6);
                      return (
                        <button
                          onClick={() => {
                            setForwardSource('duel');
                            setMode('forward');
                            setSelectedGwIndex(0);
                          }}
                          className="w-full mt-2 py-2 px-3 bg-gradient-to-r from-amber-500/15 via-emerald-500/15 to-purple-500/15 hover:from-amber-500/25 hover:to-purple-500/25 border border-amber-500/40 rounded-xl text-xs font-bold text-amber-300 flex items-center justify-center gap-2 transition-all cursor-pointer group shadow-sm active:scale-[0.99]"
                          title={`See where the AI Co-Pilot goes next from GW${nextGw} to GW${nextHorizonEnd}`}
                        >
                          <Swords className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
                          <span>Project AI Co-Pilot Forward (GW{nextGw} → GW{nextHorizonEnd})</span>
                          <ArrowRight className="w-3.5 h-3.5 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Right Column: Matchday Lineup Pitch Sheet */}
              <div className="col-span-12 lg:col-span-7 bg-slate-950 border border-fpl-border rounded-2xl p-4 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-fpl-border/60 pb-2.5 mb-3 gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-wider text-white">
                        GW{activeGwData.gameweek}{" "}
                        {isHumanView 
                          ? (teamId === '532002' ? "My Real Lineup" : "Real Lineup") 
                          : isDynamicView 
                          ? "Dynamic AI Lineup" 
                          : (teamId === '532002' ? "Frozen AI Lineup" : "Starting Lineup")}
                      </span>
                      {mode === 'synced' && activeGwData.humanComparison?.startingXI && (
                        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[10px]">
                          {teamId === '532002' ? (
                            <>
                              <button
                                onClick={() => setLineupSource('human')}
                                className={cn(
                                  "px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 cursor-pointer",
                                  isHumanView ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-black" : "text-slate-400 hover:text-white"
                                )}
                              >
                                <UserCheck className="w-3 h-3 text-cyan-400" />
                                <span>My Real XI ({activeGwData.humanComparison.netPoints} pts)</span>
                              </button>
                              <button
                                onClick={() => setLineupSource('ai')}
                                className={cn(
                                  "px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 cursor-pointer",
                                  lineupSource === 'ai' ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-black" : "text-slate-400 hover:text-white"
                                )}
                              >
                                <Bot className="w-3 h-3 text-emerald-400" />
                                <span>Frozen AI ({activeGwData.netPoints} pts)</span>
                              </button>
                              <button
                                onClick={() => setLineupSource('dynamic')}
                                className={cn(
                                  "px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 cursor-pointer",
                                  isDynamicView ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 font-black" : "text-slate-400 hover:text-white"
                                )}
                              >
                                <Sparkles className="w-3 h-3 text-purple-400" />
                                <span>Dynamic AI ({loadingDynamic && !dynamicGwData ? '...' : (dynamicGwData?.netPoints ?? 0)} pts)</span>
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => setLineupSource('ai')}
                                className={cn(
                                  "px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 cursor-pointer",
                                  !isHumanView ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-black" : "text-slate-400 hover:text-white"
                                )}
                              >
                                <Bot className="w-3 h-3 text-emerald-400" />
                                <span>AI XI ({activeGwData.netPoints} pts)</span>
                              </button>
                              <button
                                onClick={() => setLineupSource('human')}
                                className={cn(
                                  "px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 cursor-pointer",
                                  isHumanView ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-black" : "text-slate-400 hover:text-white"
                                )}
                              >
                                <UserCheck className="w-3 h-3 text-cyan-400" />
                                <span>Real XI ({activeGwData.humanComparison.netPoints} pts)</span>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">
                      Captain: <strong className={isHumanView ? "text-cyan-400" : isDynamicView ? "text-purple-400" : "text-emerald-400"}>{displayedCaptain?.web_name || 'Captain'} (2×)</strong>
                    </span>
                  </div>

                  {/* Starting XI List Cards / Loading Spinner */}
                  {isDynamicView && loadingDynamic && (!dynamicGwData || !dynamicGwData.startingXI) ? (
                    <div className="py-24 flex flex-col items-center justify-center space-y-3">
                      <RefreshCw className="w-6 h-6 text-purple-400 animate-spin" />
                      <p className="text-xs font-mono text-purple-300 uppercase tracking-widest">
                        Solving Dynamic Point-in-Time Replay on the fly...
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {displayedStartingXI.map((p) => {
                        const isCap = p.id === displayedCaptain?.id || p.isCaptain;
                        const isVc = (p.id === displayedViceCaptain?.id || p.isViceCaptain) && !isCap;
                        const scoreDisplay = isCap ? p.points * 2 : p.points;

                        return (
                          <div 
                            key={p.id}
                            className={cn(
                              "flex items-center justify-between px-3 py-2 rounded-xl border transition-all text-xs",
                              isCap 
                                ? (isHumanView ? "bg-cyan-500/10 border-cyan-500/40" : isDynamicView ? "bg-purple-500/10 border-purple-500/40" : "bg-emerald-500/10 border-emerald-500/40")
                                : "bg-slate-900 border-slate-800"
                            )}
                          >
                            <div className="flex items-center gap-2.5">
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase",
                                p.position === 'GKP' ? "bg-amber-500/20 text-amber-300" :
                                p.position === 'DEF' ? "bg-blue-500/20 text-blue-300" :
                                p.position === 'MID' ? "bg-emerald-500/20 text-emerald-300" :
                                "bg-purple-500/20 text-purple-300"
                              )}>
                                {p.position}
                              </span>
                              <span className="font-bold text-white">{p.web_name}</span>
                              <span className="text-[10px] text-slate-500">{p.team_short_name}</span>
                              
                              {isCap && (
                                <span className={cn(
                                  "px-1.5 py-0.2 rounded text-[8.5px] font-black",
                                  isHumanView ? "bg-cyan-500 text-slate-950" : isDynamicView ? "bg-purple-500 text-white" : "bg-emerald-500 text-slate-950"
                                )}>
                                  (C) 2×
                                </span>
                              )}
                              {isVc && (
                                <span className="px-1.5 py-0.2 rounded text-[8.5px] font-bold bg-slate-800 text-slate-400">
                                  (VC)
                                </span>
                              )}
                              {p.isAutoSubIn && (
                                <span className="px-1.5 py-0.2 rounded text-[8.5px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  Auto-Sub In
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2.5 sm:gap-3.5 font-mono">
                              {mode === 'forward' ? (
                                <>
                                  <span className="text-[10px] text-slate-500">{p.costDisplay}</span>
                                  <span className="text-xs font-black min-w-[28px] text-right text-emerald-400">
                                    {p.xP !== undefined ? `${(isCap ? p.xP * (activeGwData.chipActive === 'TC' ? 3 : 2) : p.xP).toFixed(1)} xP` : '—'}
                                  </span>
                                </>
                              ) : (
                                <>
                                  {p.xP !== undefined && (
                                    <span className="text-[10px] text-slate-400">
                                      Exp: <span className="text-slate-300 font-bold">{(isCap ? p.xP * (activeGwData.chipActive === 'TC' ? 3 : 2) : p.xP).toFixed(1)} xP</span>
                                    </span>
                                  )}
                                  <span className="text-[10px] text-slate-500">{p.costDisplay}</span>
                                  <span className={cn(
                                    "text-xs font-black min-w-[28px] text-right",
                                    scoreDisplay >= 10 ? "text-amber-400" : scoreDisplay >= 6 ? "text-emerald-400" : "text-white"
                                  )}>
                                    {scoreDisplay} pts
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Bench Section */}
                <div className="mt-4 pt-3 border-t border-fpl-border/60">
                  <div className="text-[10px] font-mono uppercase font-bold text-slate-400 mb-2">
                    {isHumanView 
                      ? (teamId === '532002' ? "Your Real Substitutes Bench" : "Real Substitutes Bench") 
                      : isDynamicView 
                      ? "Dynamic AI Substitutes Bench" 
                      : "Substitutes Bench (Reserve GK + Ordered Priority)"}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(() => {
                    let outfieldCounter = 0;
                    return displayedBench.map((b) => {
                      const isGkp = b.position === 'GKP';
                      if (!isGkp) outfieldCounter += 1;
                      const slotLabel = isGkp ? 'GK Sub' : `Sub ${outfieldCounter}`;
                      return (
                      <div 
                        key={b.id} 
                        className={cn(
                          "p-2 rounded-xl border text-[11px] flex flex-col justify-between transition-all",
                          b.isAutoSubOut 
                            ? "bg-rose-500/10 border-rose-500/40" 
                            : b.isAutoSubIn 
                            ? "bg-amber-500/10 border-amber-500/40" 
                            : "bg-slate-900/60 border-slate-800"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={cn("text-[8.5px] font-mono font-bold tracking-wider uppercase", isGkp ? "text-amber-400" : "text-slate-400")}>{slotLabel}</span>
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] font-mono uppercase text-slate-400">{b.position}</span>
                            {b.isAutoSubOut && (
                              <span className="text-[8px] font-mono text-rose-300 bg-rose-500/25 px-1 py-0.2 rounded font-bold">0 mins</span>
                            )}
                          </div>
                        </div>
                        <div className={cn("font-bold truncate", b.isAutoSubOut ? "text-slate-400 line-through" : "text-slate-200")}>
                          {b.web_name}
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
                          {mode === 'forward' ? (
                            <>
                              <span className="text-slate-500">{b.costDisplay}</span>
                              <span className="font-bold text-slate-300">
                                {b.xP !== undefined ? `${b.xP.toFixed(1)} xP` : '—'}
                              </span>
                            </>
                          ) : (
                            <>
                              {b.xP !== undefined ? (
                                <span className="text-slate-400">Exp: {b.xP.toFixed(1)} xP</span>
                              ) : (
                                <span className="text-slate-500">{b.costDisplay}</span>
                              )}
                              <span className={cn("font-bold", b.isAutoSubOut ? "text-rose-400" : "text-slate-300")}>{b.points} pts</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                    });
                    })()}
                  </div>
                </div>
              </div>
            </div>
            );
          })()}
        </>
      ) : null}
    </div>
  );
};

