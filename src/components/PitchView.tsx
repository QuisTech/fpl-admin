import React, { useState } from 'react';
import { motion } from 'motion/react';
import { PlayerCard } from './PlayerCard';
import { RecommendationResponse, ScoredPlayer, TeamSyncResponse } from '../types';
import { Zap, Shield, Lock, Ban, X, ArrowRightLeft, Calendar, Eye, EyeOff, Activity, Trophy, Coins, Users, Layout, List } from 'lucide-react';
import { cn } from '../lib/utils';

interface PitchViewProps {
  data: RecommendationResponse | null;
  syncedData?: TeamSyncResponse | null;
  formation: {
    gkp: ScoredPlayer[];
    def: ScoredPlayer[];
    mid: ScoredPlayer[];
    fwd: ScoredPlayer[];
  };
  activeScenario?: 'quant' | 'template';
  onSelectScenario?: (s: 'quant' | 'template') => void;
  lockedPlayerIds?: number[];
  excludedPlayerIds?: number[];
  onToggleLock?: (id: number) => void;
  onToggleExclude?: (id: number) => void;
  onClearConstraints?: () => void;
}

const getFdrBadgeColor = (difficulty?: number) => {
  switch (difficulty) {
    case 1:
    case 2:
      return "bg-[#00ff85] text-slate-950 font-black";
    case 3:
      return "bg-slate-700 text-slate-200 font-bold";
    case 4:
      return "bg-[#ff005a] text-white font-black";
    case 5:
      return "bg-[#80072d] text-white font-black";
    default:
      return "bg-slate-800 text-slate-400";
  }
};

const getPosBadgeColor = (pos?: string) => {
  switch (pos) {
    case 'GKP':
      return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    case 'DEF':
      return "bg-sky-500/20 text-sky-300 border-sky-500/40";
    case 'MID':
      return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    case 'FWD':
      return "bg-rose-500/20 text-rose-300 border-rose-500/40";
    default:
      return "bg-slate-800 text-slate-400 border-slate-700";
  }
};

export const PitchView = ({ 
  data, 
  syncedData,
  formation,
  activeScenario = 'quant',
  onSelectScenario,
  lockedPlayerIds = [],
  excludedPlayerIds = [],
  onToggleLock,
  onToggleExclude,
  onClearConstraints
}: PitchViewProps) => {
  const [showFixtures, setShowFixtures] = useState(true);
  const [viewMode, setViewMode] = useState<'pitch' | 'list'>('pitch');

  const scenarioComp = (data as any)?.engineDiagnostics?.metrics?.scenarioComparison;
  const delta = scenarioComp?.delta;

  const allPlayersMap = new Map<number, ScoredPlayer>();
  data?.squad?.forEach(p => allPlayersMap.set(p.id, p));
  data?.topPicks?.gkp?.forEach(p => allPlayersMap.set(p.id, p));
  data?.topPicks?.def?.forEach(p => allPlayersMap.set(p.id, p));
  data?.topPicks?.mid?.forEach(p => allPlayersMap.set(p.id, p));
  data?.topPicks?.fwd?.forEach(p => allPlayersMap.set(p.id, p));

  const hasConstraints = lockedPlayerIds.length > 0 || excludedPlayerIds.length > 0;
  const benchPlayers = data?.bench?.filter(Boolean) || [];

  // Matchday & Squad Diagnostics Calculations
  const nextGw = data?.nextEventId || syncedData?.gameweek || 3;
  const expectedPoints = data?.expectedPoints || data?.startingXI?.reduce((s, p) => s + (p.xP || 0), 0) || 0;
  const avgEo = data?.engineDiagnostics?.metrics?.averageXiEo ?? (
    data?.startingXI && data.startingXI.length > 0 
      ? Math.round(data.startingXI.reduce((s, p) => s + (p.eo || 0), 0) / data.startingXI.length) 
      : 0
  );
  const totalCost = data?.totalCost ? (data.totalCost / 10).toFixed(1) : '100.0';
  const bank = syncedData?.bank !== undefined ? (syncedData.bank / 10).toFixed(1) : '0.0';
  const captain = data?.captain?.web_name || data?.startingXI?.find(p => p.isCaptain)?.web_name || 'TBD';
  const entryHistory = syncedData?.entryHistory;
  const managerInfo = syncedData?.managerInfo;

  return (
    <motion.div 
      key="pitch-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-grow flex flex-col justify-between py-1 sm:py-2 w-full max-w-5xl mx-auto"
    >
      {/* Top Controls: Scenario Switcher & Delta Comparison Bar (Only rendered when onSelectScenario is provided) */}
      {onSelectScenario && (
        <div className="space-y-2 mb-2">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 bg-slate-950/90 p-2 rounded-xl border border-fpl-border/80 backdrop-blur-md shadow-lg">
            
            {/* Left: Scenario Switcher */}
            <div className="flex items-center gap-1.5 bg-slate-900/90 p-1 rounded-lg border border-slate-800 w-full sm:w-auto">
              <button
                onClick={() => onSelectScenario?.('quant')}
                className={cn(
                  "flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all",
                  activeScenario === 'quant'
                    ? "bg-fpl-green text-slate-950 shadow-[0_0_12px_rgba(0,255,133,0.35)]"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                <Zap className="w-3 h-3" />
                <span>Quant Optimal</span>
              </button>
              <button
                onClick={() => onSelectScenario?.('template')}
                className={cn(
                  "flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all",
                  activeScenario === 'template'
                    ? "bg-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.35)]"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                <Shield className="w-3 h-3 text-purple-300" />
                <span>Template Shield</span>
              </button>
            </div>

            {/* Right: Delta Metric Badge Bar */}
            {delta && (
              <div className="flex items-center gap-2 text-[10px] font-mono w-full sm:w-auto justify-between sm:justify-end">
                <div className="flex items-center gap-1 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
                  <span className="text-slate-500 font-bold uppercase text-[8px]">Delta xP</span>
                  <span className={cn(
                    "font-black font-mono",
                    delta.xpDiff >= 0 ? "text-emerald-400" : "text-amber-400"
                  )}>
                    {delta.xpDiff > 0 ? `+${delta.xpDiff}` : delta.xpDiff} pts
                  </span>
                </div>

                <div className="flex items-center gap-1 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
                  <span className="text-slate-500 font-bold uppercase text-[8px]">Delta EO</span>
                  <span className={cn(
                    "font-black font-mono",
                    delta.eoDiff >= 0 ? "text-cyan-400" : "text-slate-300"
                  )}>
                    {delta.eoDiff > 0 ? `+${delta.eoDiff}` : delta.eoDiff}%
                  </span>
                </div>

                {delta.swaps?.length > 0 && (
                  <div className="flex items-center gap-1 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800 hidden md:flex">
                    <ArrowRightLeft className="w-3 h-3 text-slate-400" />
                    <span className="text-slate-300 font-bold">{delta.swaps.length} Swaps</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 📊 Premier League Matchday & Squad Diagnostics Stats Ribbon */}
      <div className="bg-slate-950/85 border border-fpl-border/70 rounded-xl p-2 sm:p-2.5 mb-2 backdrop-blur-md shadow-md">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-1.5 border-b border-slate-800/80 pb-1.5 mb-2">
          
          {/* Gameweek Badge & Team Identifier */}
          <div className="flex items-center gap-2">
            <span className="bg-fpl-green/10 border border-fpl-green/30 text-fpl-green font-mono font-black text-[9.5px] sm:text-xs px-2.5 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-fpl-green animate-pulse" />
              Gameweek {nextGw}
            </span>
            <span className="text-[10px] sm:text-xs font-bold text-white truncate">
              {managerInfo?.teamName ? managerInfo.teamName : (activeScenario === 'template' ? 'Risky Template Shield' : 'Quant Optimal Lineup')}
            </span>
          </div>

          {/* Captain & Status Banner */}
          <div className="flex items-center justify-between sm:justify-end gap-1.5 text-[9px] font-mono">
            {managerInfo?.managerName && (
              <span className="bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-slate-300 hidden md:inline-block">
                {managerInfo.managerName}
              </span>
            )}
            <span className="bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded text-emerald-400 font-bold flex items-center gap-1">
              <span className="w-3.5 h-3.5 rounded-full bg-[#37003c] text-white flex items-center justify-center text-[7.5px] font-black border border-white/60">C</span>
              {captain}
            </span>
          </div>
        </div>

        {/* 6-Metric Matchday Grid (1:1 Relatable to Official FPL Pitch Header) */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center">
          {/* 1. Expected Points (xP) */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-1.5 flex flex-col justify-center shadow-inner">
            <span className="text-xs sm:text-sm font-black font-mono text-fpl-green leading-none">
              {expectedPoints.toFixed(1)}
            </span>
            <span className="text-[8px] font-mono uppercase text-slate-400 mt-1 tracking-tight">
              Expected xP
            </span>
          </div>

          {/* 2. Avg Squad EO */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-1.5 flex flex-col justify-center shadow-inner">
            <span className="text-xs sm:text-sm font-black font-mono text-cyan-400 leading-none">
              {avgEo}%
            </span>
            <span className="text-[8px] font-mono uppercase text-slate-400 mt-1 tracking-tight">
              Avg XI EO
            </span>
          </div>

          {/* 3. Squad Value */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-1.5 flex flex-col justify-center shadow-inner">
            <span className="text-xs sm:text-sm font-black font-mono text-slate-200 leading-none">
              £{totalCost}M
            </span>
            <span className="text-[8px] font-mono uppercase text-slate-400 mt-1 tracking-tight">
              Squad Value
            </span>
          </div>

          {/* 4. Latest Points (or Bank) */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-1.5 flex flex-col justify-center shadow-inner">
            <span className="text-xs sm:text-sm font-black font-mono text-amber-400 leading-none">
              {entryHistory ? `${entryHistory.points} pts` : `£${bank}M`}
            </span>
            <span className="text-[8px] font-mono uppercase text-slate-400 mt-1 tracking-tight">
              {entryHistory ? 'Latest Points' : 'In The Bank'}
            </span>
          </div>

          {/* 5. Overall Rank (or Starters) */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-1.5 flex flex-col justify-center shadow-inner">
            <span className="text-xs sm:text-sm font-black font-mono text-purple-300 leading-none truncate px-0.5">
              {entryHistory ? `#${entryHistory.overall_rank.toLocaleString()}` : `${data?.startingXI?.length || 11} Starters`}
            </span>
            <span className="text-[8px] font-mono uppercase text-slate-400 mt-1 tracking-tight">
              {entryHistory ? 'Overall Rank' : 'Active XI'}
            </span>
          </div>

          {/* 6. Total Season Points (or Subs) */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-1.5 flex flex-col justify-center shadow-inner">
            <span className="text-xs sm:text-sm font-black font-mono text-emerald-400 leading-none">
              {entryHistory ? `${entryHistory.total_points}` : `${data?.bench?.length || 4} Subs`}
            </span>
            <span className="text-[8px] font-mono uppercase text-slate-400 mt-1 tracking-tight">
              {entryHistory ? 'Total Points' : 'Bench Dugout'}
            </span>
          </div>
        </div>
      </div>

      {/* Active Constraints (Locks & Excludes) Pill Bar */}
      {hasConstraints && (
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 mb-2 bg-slate-950/70 border border-slate-800/90 rounded-lg backdrop-blur-sm">
          <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider mr-1">Active Rules:</span>
          {lockedPlayerIds.map(id => {
            const p = allPlayersMap.get(id);
            return (
              <span key={`lock-${id}`} className="inline-flex items-center gap-1 bg-amber-400/15 border border-amber-400/40 text-amber-300 px-2 py-0.5 rounded text-[9px] font-bold">
                <Lock className="w-2.5 h-2.5 text-amber-400" />
                <span>{p?.web_name || `ID ${id}`}</span>
                {onToggleLock && (
                  <button onClick={() => onToggleLock(id)} className="hover:text-white ml-0.5">
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </span>
            );
          })}
          {excludedPlayerIds.map(id => {
            const p = allPlayersMap.get(id);
            return (
              <span key={`ex-${id}`} className="inline-flex items-center gap-1 bg-rose-500/15 border border-rose-500/40 text-rose-300 px-2 py-0.5 rounded text-[9px] font-bold">
                <Ban className="w-2.5 h-2.5 text-rose-400" />
                <span>{p?.web_name || `ID ${id}`}</span>
                {onToggleExclude && (
                  <button onClick={() => onToggleExclude(id)} className="hover:text-white ml-0.5">
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </span>
            );
          })}
          {onClearConstraints && (
            <button 
              onClick={onClearConstraints}
              className="text-[9px] text-slate-400 hover:text-white underline ml-auto font-bold uppercase tracking-wider"
            >
              Reset All
            </button>
          )}
        </div>
      )}

      {/* 🎛️ Pitch / List View Mode & Formation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1 max-w-2xl sm:max-w-4xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <span className="bg-slate-900 border border-slate-800 text-slate-300 font-mono font-bold text-[10px] sm:text-xs px-2.5 py-1 rounded-lg uppercase tracking-wider">
            {formation.def.length}-{formation.mid.length}-{formation.fwd.length} Formation
          </span>
          <span className="text-slate-600 hidden sm:inline">•</span>
          <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
            11 Starters, {benchPlayers.length} Subs
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Official FPL Pitch / List Switcher (Segmented Radio Button Group) */}
          <div className="flex items-center gap-1 bg-slate-900/95 p-1 rounded-lg border border-slate-800 shadow-inner" role="radiogroup" aria-label="Lineup view format">
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === 'pitch'}
              data-selected={viewMode === 'pitch'}
              tabIndex={0}
              data-react-aria-pressable="true"
              onClick={() => setViewMode('pitch')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all",
                viewMode === 'pitch'
                  ? "bg-fpl-green text-slate-950 shadow-[0_0_10px_rgba(0,255,133,0.35)] font-black"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              <Layout className="w-3 h-3" />
              <span>Pitch</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === 'list'}
              data-selected={viewMode === 'list'}
              tabIndex={0}
              data-react-aria-pressable="true"
              onClick={() => setViewMode('list')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all",
                viewMode === 'list'
                  ? "bg-fpl-green text-slate-950 shadow-[0_0_10px_rgba(0,255,133,0.35)] font-black"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              <List className="w-3 h-3" />
              <span>List</span>
            </button>
          </div>
        </div>
      </div>

      {/* 🏟️ View Mode Content: Authentic Pitch or Official FPL List View */}
      {viewMode === 'pitch' ? (
        /* 🌟 Authentic Football Pitch Container (1:1 Proportional Match with Official FPL) */
        <div className="relative mx-auto w-full max-w-2xl py-0.5 sm:py-1">
          <div className="relative rounded-2xl shadow-2xl border-2 border-slate-800 bg-[#00a350] p-1.5 sm:p-3">
            
            {/* 🌿 Clipped Stadium Turf & Diagram Underlay (Keeps Rounded Corners without Clipping Tooltips) */}
            <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
              {/* Realistic Mown Grass Horizontal Lawn Stripes Background */}
              <div 
                className="absolute inset-0"
                style={{
                  background: `repeating-linear-gradient(
                    to bottom,
                    #00a350,
                    #00a350 40px,
                    #009b4d 40px,
                    #009b4d 80px
                  )`
                }}
              />

              {/* 🏟️ Authentic Zoomed Official Pitch Diagram SVG (Aligned with Rows) */}
              <svg 
                className="absolute inset-0 w-full h-full stroke-white/80 fill-none" 
                preserveAspectRatio="none" 
                viewBox="0 0 800 680"
              >
                {/* 🏟️ Stadium Outer Flanks (#0f172a Dark Surround Outside Pitch & Billboard Headers) */}
                <polygon 
                  points="-10,-10 105,-10 105,4 0,135 -10,135 -10,-10" 
                  className="fill-[#0f172a] stroke-[#0f172a]" 
                  strokeWidth="2" 
                />
                <polygon 
                  points="810,-10 695,-10 695,4 800,135 810,135 810,-10" 
                  className="fill-[#0f172a] stroke-[#0f172a]" 
                  strokeWidth="2" 
                />
                <polygon 
                  points="105,-10 695,-10 695,4 105,4" 
                  className="fill-[#0f172a] stroke-[#0f172a]" 
                  strokeWidth="2" 
                />

                {/* 🏟️ Straight Continuous Parallel Outer Pitch Boundary (From Top Corners at y=4 to Outer Edges at Defender Head y=135) */}
                <line x1="105" y1="4" x2="0" y2="135" strokeWidth="2" className="stroke-white/70" />
                <line x1="695" y1="4" x2="800" y2="135" strokeWidth="2" className="stroke-white/70" />
                <line x1="105" y1="4" x2="695" y2="4" strokeWidth="2" className="stroke-white/70" />

                {/* 🌟 Left Billboard: Vibrant Cyan "Fantasy" with Premier League Crown Lion */}
                <rect x="125" y="4" width="215" height="20" rx="4" className="fill-[#00e5ff] stroke-none" />
                <g transform="translate(170, 6)">
                  {/* Crowned Lion Head Vector */}
                  <path d="M12 2L14.5 5.5L18 4L16.5 8L20 9.5L17.5 12.5L18.5 16L15 14.5L13 18L11 14.5L7.5 16L8.5 12.5L6 9.5L9.5 8L8 4L11.5 5.5Z" fill="#37003c" />
                  <text x="24" y="13" fill="#37003c" fontSize="13" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="0.4">Fantasy</text>
                </g>

                {/* 🌟 Center Goal Net (Neat & Straight Rectangular Frame with Crisp Grid) */}
                <rect x="340" y="4" width="120" height="20" className="fill-[#00b4d8]/25 stroke-white" strokeWidth="2" />
                <line x1="364" y1="4" x2="364" y2="24" strokeWidth="1" className="stroke-white/50" />
                <line x1="388" y1="4" x2="388" y2="24" strokeWidth="1" className="stroke-white/50" />
                <line x1="412" y1="4" x2="412" y2="24" strokeWidth="1" className="stroke-white/50" />
                <line x1="436" y1="4" x2="436" y2="24" strokeWidth="1" className="stroke-white/50" />
                <line x1="340" y1="10" x2="460" y2="10" strokeWidth="1" className="stroke-white/50" />
                <line x1="340" y1="17" x2="460" y2="17" strokeWidth="1" className="stroke-white/50" />

                {/* 🌟 Right Billboard: Vibrant Violet "Fantasy" with Premier League Crown Lion */}
                <rect x="460" y="4" width="215" height="20" rx="4" className="fill-[#6366f1] stroke-none" />
                <g transform="translate(505, 6)">
                  {/* Crowned Lion Head Vector */}
                  <path d="M12 2L14.5 5.5L18 4L16.5 8L20 9.5L17.5 12.5L18.5 16L15 14.5L13 18L11 14.5L7.5 16L8.5 12.5L6 9.5L9.5 8L8 4L11.5 5.5Z" fill="#1e1b4b" />
                  <text x="24" y="13" fill="#1e1b4b" fontSize="13" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="0.4">Fantasy</text>
                </g>

                {/* Top Goal Line */}
                <line x1="125" y1="24" x2="675" y2="24" strokeWidth="2.5" />

                {/* Slanted Sideline Touchlines Intersecting at Defender Head y=145 */}
                <line x1="125" y1="24" x2="0" y2="145" strokeWidth="3" />
                <line x1="0" y1="145" x2="0" y2="590" strokeWidth="3" />
                <line x1="675" y1="24" x2="800" y2="145" strokeWidth="3" />
                <line x1="800" y1="145" x2="800" y2="590" strokeWidth="3" />

                {/* Top 6-Yard Goal Area */}
                <polygon points="295,24 505,24 512,62 288,62" strokeWidth="2" />

                {/* Top 18-Yard Penalty Area in Perspective */}
                <polygon points="200,24 600,24 618,125 182,125" strokeWidth="2.5" />
                
                {/* Penalty Spot */}
                <circle cx="400" cy="90" r="4" className="fill-white" stroke="none" />
                
                {/* Penalty Arc ('D' Curving Downwards from 18-Yard Box) */}
                <path d="M 325,125 A 85,38 0 0,0 475,125" strokeWidth="2.2" />

                {/* Top Corner Arcs */}
                <path d="M 117.0,46.8 A 24,24 0 0,0 149,24" strokeWidth="2.2" />
                <path d="M 651,24 A 24,24 0 0,0 683.0,46.8" strokeWidth="2.2" />

                {/* Halfway Line (Cutting horizontally through the center of the Forwards row) */}
                <line x1="0" y1="450" x2="800" y2="450" strokeWidth="3.5" />
                
                {/* Center Circle (Encircling Forwards, bottom touches at Bench Shelf Intersection) */}
                <ellipse cx="400" cy="450" rx="160" ry="85" strokeWidth="2.8" />
                <circle cx="400" cy="450" r="4.5" className="fill-white" stroke="none" />
              </svg>
            </div>

            {/* 🎛️ Pitch Stadium HUD: Floating Fixture Ticker Toggle */}
            <div className="absolute top-2.5 right-2.5 sm:top-3 sm:right-3 z-30">
              <button
                onClick={() => setShowFixtures(!showFixtures)}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg border text-[8.5px] sm:text-[9.5px] font-extrabold uppercase tracking-wider backdrop-blur-md transition-all shadow-lg select-none",
                  showFixtures 
                    ? "bg-black/70 border-emerald-400/50 text-[#00ff85] hover:bg-black/90 hover:border-emerald-400" 
                    : "bg-black/40 border-white/20 text-white/70 hover:bg-black/70 hover:text-white"
                )}
                title="Toggle upcoming 3-match FDR fixture ticker under players"
              >
                {showFixtures ? (
                  <>
                    <Eye className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#00ff85]" />
                    <span>3-Match FDR: On</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white/50" />
                    <span>3-Match FDR: Off</span>
                  </>
                )}
              </button>
            </div>

            {/* 🏟️ Starting XI Lines on the Pitch (Ultra-Compact Responsive Row Proportions for Mobile) */}
            <div className="relative z-10 flex flex-col justify-between min-h-[360px] sm:min-h-[420px] md:min-h-[490px] pt-4 pb-0.5 sm:pt-6 sm:pb-1.5">
              
              {/* Row 1: Goalkeeper (Inside Goalmouth & 18-Yard Box) */}
              <div className="flex justify-center items-center w-full my-0 sm:my-0.5">
                {formation.gkp.map(p => (
                  <PlayerCard 
                    key={p.id} 
                    player={p} 
                    showFixtures={showFixtures}
                    isCaptain={p.isCaptain}
                    isViceCaptain={p.isViceCaptain}
                    isLocked={lockedPlayerIds.includes(p.id)}
                    isExcluded={excludedPlayerIds.includes(p.id)}
                    onToggleLock={onToggleLock}
                    onToggleExclude={onToggleExclude}
                  />
                ))}
              </div>

              {/* Row 2: Defenders (Upper Pitch between Penalty Box & Midfield) */}
              <div className="flex justify-around items-center w-full max-w-[88%] mx-auto my-0 sm:my-0.5">
                {formation.def.map(p => (
                  <PlayerCard 
                    key={p.id} 
                    player={p} 
                    showFixtures={showFixtures}
                    isCaptain={p.isCaptain}
                    isViceCaptain={p.isViceCaptain}
                    isLocked={lockedPlayerIds.includes(p.id)}
                    isExcluded={excludedPlayerIds.includes(p.id)}
                    onToggleLock={onToggleLock}
                    onToggleExclude={onToggleExclude}
                  />
                ))}
              </div>

              {/* Row 3: Midfielders (Wider Middle Pitch above Halfway Line) */}
              <div className="flex justify-around items-center w-full max-w-[98%] mx-auto my-0 sm:my-0.5">
                {formation.mid.map(p => (
                  <PlayerCard 
                    key={p.id} 
                    player={p} 
                    showFixtures={showFixtures}
                    isCaptain={p.isCaptain}
                    isViceCaptain={p.isViceCaptain}
                    isLocked={lockedPlayerIds.includes(p.id)}
                    isExcluded={excludedPlayerIds.includes(p.id)}
                    onToggleLock={onToggleLock}
                    onToggleExclude={onToggleExclude}
                  />
                ))}
              </div>

              {/* Row 4: Forwards (Inside the Center Circle & Over Halfway Line) */}
              <div className="flex justify-around items-center w-full max-w-[80%] mx-auto my-0 sm:my-0.5">
                {formation.fwd.map(p => (
                  <PlayerCard 
                    key={p.id} 
                    player={p} 
                    showFixtures={showFixtures}
                    isCaptain={p.isCaptain}
                    isViceCaptain={p.isViceCaptain}
                    isLocked={lockedPlayerIds.includes(p.id)}
                    isExcluded={excludedPlayerIds.includes(p.id)}
                    onToggleLock={onToggleLock}
                    onToggleExclude={onToggleExclude}
                  />
                ))}
              </div>
            </div>

            {/* 🌿 Smooth Bottom Grass-to-App Background Fade (#0f172a at Bench Nameplates) */}
            <div className="absolute inset-x-0 bottom-0 h-20 sm:h-28 bg-gradient-to-b from-transparent via-[#0f172a]/70 to-[#0f172a] pointer-events-none z-10" />

            {/* 🪑 Official Substitutes Bench Dugout Shelf (Proportional Frosted Shelf at Pitch Bottom intersecting Center Circle) */}
            <div className="relative z-20 w-full max-w-[94%] mx-auto mt-0.5 sm:mt-1.5 rounded-xl border border-white/15 bg-[#0f172a]/40 backdrop-blur-md p-1.5 sm:p-2.5 shadow-2xl">
              <div className="flex justify-around items-end gap-0.5 sm:gap-1.5 px-0.5 sm:px-1">
                {benchPlayers.map((p, idx) => {
                  const isGkp = idx === 0 || p.element_type === 1 || p.position === 'GKP';
                  const subLabel = isGkp ? 'GKP' : `${idx}. ${p.position || 'SUB'}`;

                  return (
                    <div key={p.id} className="flex flex-col items-center gap-0.5">
                      {/* Official Position / Auto-Sub Priority Header Label */}
                      <div className="text-[8px] sm:text-[9px] font-mono font-extrabold uppercase tracking-wider text-emerald-100 border-b border-dotted border-white/40 pb-0.5 px-0.5">
                        {subLabel}
                      </div>

                      {/* Semi-transparent frosted slot card wrapper */}
                      <div className="bg-white/10 rounded-lg p-0.5 sm:p-1 border border-white/15 shadow-inner">
                        <PlayerCard 
                          player={p} 
                          compact 
                          benchIndex={idx}
                          showFixtures={showFixtures}
                          isLocked={lockedPlayerIds.includes(p.id)}
                          isExcluded={excludedPlayerIds.includes(p.id)}
                          onToggleLock={onToggleLock}
                          onToggleExclude={onToggleExclude}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* 🪑 Official Substitutes Header Label */}
              <p className="text-center text-white font-extrabold text-[10px] sm:text-[11px] tracking-wider mt-1 drop-shadow-md">
                Substitutes
              </p>
            </div>

          </div>
        </div>
      ) : (
        /* 📋 Official FPL List View Container */
        <motion.div
          key="list-view-container"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-4xl mx-auto space-y-3"
        >
          {/* Starting XI Section Table */}
          <div className="bg-slate-950/90 border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-md">
            {/* Starting XI Section Header */}
            <div className="bg-slate-900/90 px-3 sm:px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-fpl-green animate-pulse" />
                <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
                  Starting XI
                </span>
                <span className="text-[10px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-bold border border-slate-700">
                  {formation.gkp.length + formation.def.length + formation.mid.length + formation.fwd.length} Players
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] sm:text-xs font-mono">
                <span className="text-slate-400">
                  Cost: <span className="text-slate-200 font-bold">£{((formation.gkp.concat(formation.def, formation.mid, formation.fwd).reduce((sum, p) => sum + (p.now_cost || p.cost || 0), 0)) / 10).toFixed(1)}M</span>
                </span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400">
                  Expected: <span className="text-fpl-green font-black">{expectedPoints.toFixed(1)} pts</span>
                </span>
              </div>
            </div>

            {/* Starting XI Table Content */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-900/40 text-[9px] sm:text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 px-3">Pos</th>
                    <th className="py-2.5 px-3">Player</th>
                    <th className="py-2.5 px-3">{showFixtures ? "Fixtures (3-Match FDR)" : "Next Fixture"}</th>
                    <th className="py-2.5 px-3 text-right">Cost</th>
                    <th className="py-2.5 px-3 text-right">GW xP</th>
                    <th className="py-2.5 px-3 text-right hidden md:table-cell">8-GW xP</th>
                    <th className="py-2.5 px-3 text-right hidden sm:table-cell">Top-1K EO</th>
                    {(onToggleLock || onToggleExclude) && (
                      <th className="py-2.5 px-3 text-center">Rules</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 text-xs">
                  {[...formation.gkp, ...formation.def, ...formation.mid, ...formation.fwd].map(p => {
                    const isLocked = lockedPlayerIds.includes(p.id);
                    const isExcluded = excludedPlayerIds.includes(p.id);
                    const nextFix = p.next_fixtures?.[0];

                    return (
                      <tr 
                        key={p.id} 
                        className={cn(
                          "hover:bg-slate-900/70 transition-colors",
                          isLocked && "bg-amber-400/5",
                          isExcluded && "bg-rose-500/5 opacity-60"
                        )}
                      >
                        {/* Position Badge */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className={cn("px-2 py-0.5 rounded text-[9.5px] font-mono font-black uppercase tracking-wider border", getPosBadgeColor(p.position))}>
                            {p.position}
                          </span>
                        </td>

                        {/* Player Name & Team */}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-white text-xs sm:text-sm">{p.web_name}</span>
                                {p.isCaptain && (
                                  <span className="w-4 h-4 rounded-full bg-[#37003c] text-white flex items-center justify-center text-[9px] font-black border border-white/70 shadow-sm" title="Captain (2x Points)">
                                    C
                                  </span>
                                )}
                                {p.isViceCaptain && (
                                  <span className="w-4 h-4 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center text-[9px] font-black border border-slate-600" title="Vice Captain">
                                    V
                                  </span>
                                )}
                                {p.chance_of_playing_next_round !== undefined && p.chance_of_playing_next_round !== null && p.chance_of_playing_next_round < 100 && (
                                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[8px] font-mono px-1 rounded font-bold">
                                    {p.chance_of_playing_next_round}%
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 font-medium">
                                {p.team_name || p.team_short_name}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Next Fixture(s) with FDR */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {showFixtures && p.next_fixtures && p.next_fixtures.length > 0 ? (
                            <div className="flex items-center gap-1 sm:gap-1.5">
                              {p.next_fixtures.slice(0, 3).map((f, i) => (
                                <div key={i} className="flex items-center gap-1 bg-slate-900/80 px-1.5 py-0.5 rounded border border-slate-800">
                                  <span className="text-[10px] sm:text-xs font-mono font-bold text-slate-200">
                                    {f.opponent} ({f.is_home ? 'H' : 'A'})
                                  </span>
                                  <span className={cn("text-[8.5px] font-mono px-1 py-0.2 rounded shadow-sm", getFdrBadgeColor(f.difficulty))}>
                                    FDR {f.difficulty}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : nextFix ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-mono font-bold text-slate-200">
                                {nextFix.opponent} ({nextFix.is_home ? 'H' : 'A'})
                              </span>
                              <span className={cn("text-[9px] font-mono px-1.5 py-0.5 rounded shadow-sm", getFdrBadgeColor(nextFix.difficulty))}>
                                FDR {nextFix.difficulty}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500 font-mono">TBD</span>
                          )}
                        </td>

                        {/* Cost */}
                        <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-300 font-bold whitespace-nowrap">
                          £{((p.now_cost || p.cost || 0) / 10).toFixed(1)}m
                        </td>

                        {/* Immediate GW xP */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <span className="font-mono font-black text-xs sm:text-sm text-fpl-green">
                            {p.isCaptain ? ((p.xP || 0) * 2).toFixed(1) : (p.xP || 0).toFixed(1)}
                          </span>
                          {p.isCaptain && <span className="text-[9px] text-fpl-green/80 ml-1 font-mono">(2x)</span>}
                        </td>

                        {/* 8-GW Horizon xP */}
                        <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-300 font-semibold whitespace-nowrap hidden md:table-cell">
                          {(p.horizonXP || (p.xP || 0) * 8).toFixed(1)}
                        </td>

                        {/* Top-1K EO */}
                        <td className="py-2.5 px-3 text-right font-mono text-xs whitespace-nowrap hidden sm:table-cell">
                          <span className={cn(
                            "font-bold",
                            (p.eo ?? 0) >= 30 ? "text-cyan-400" : "text-slate-400"
                          )}>
                            {p.eo !== undefined ? `${p.eo}%` : `${p.ownership || 0}%`}
                          </span>
                        </td>

                        {/* Lock & Exclude Rule Buttons */}
                        {(onToggleLock || onToggleExclude) && (
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              {onToggleLock && (
                                <button
                                  type="button"
                                  onClick={() => onToggleLock(p.id)}
                                  title={isLocked ? "Unlock player" : "Lock player into squad"}
                                  className={cn(
                                    "p-1 rounded transition-colors",
                                    isLocked
                                      ? "bg-amber-400/20 text-amber-300 border border-amber-400/40"
                                      : "text-slate-500 hover:text-slate-300"
                                  )}
                                >
                                  <Lock className="w-3 h-3" />
                                </button>
                              )}
                              {onToggleExclude && (
                                <button
                                  type="button"
                                  onClick={() => onToggleExclude(p.id)}
                                  title={isExcluded ? "Remove exclusion" : "Exclude player from squad"}
                                  className={cn(
                                    "p-1 rounded transition-colors",
                                    isExcluded
                                      ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                                      : "text-slate-500 hover:text-slate-300"
                                  )}
                                >
                                  <Ban className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Substitutes / Bench Dugout Section Table */}
          <div className="bg-slate-950/90 border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-md">
            {/* Bench Header */}
            <div className="bg-slate-900/80 px-3 sm:px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-300">
                  Substitutes / Bench Dugout
                </span>
                <span className="text-[10px] font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700 font-bold">
                  {benchPlayers.length} Subs
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] sm:text-xs font-mono">
                <span className="text-slate-400">
                  Cost: <span className="text-slate-200 font-bold">£{((benchPlayers.reduce((sum, p) => sum + (p.now_cost || p.cost || 0), 0)) / 10).toFixed(1)}M</span>
                </span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400">
                  Bench xP: <span className="text-amber-400 font-black">{benchPlayers.reduce((sum, p) => sum + (p.xP || 0), 0).toFixed(1)} pts</span>
                </span>
              </div>
            </div>

            {/* Bench Table Content */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-900/40 text-[9px] sm:text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 px-3">Sub Priority</th>
                    <th className="py-2.5 px-3">Player</th>
                    <th className="py-2.5 px-3">{showFixtures ? "Fixtures (3-Match FDR)" : "Next Fixture"}</th>
                    <th className="py-2.5 px-3 text-right">Cost</th>
                    <th className="py-2.5 px-3 text-right">GW xP</th>
                    <th className="py-2.5 px-3 text-right hidden md:table-cell">8-GW xP</th>
                    <th className="py-2.5 px-3 text-right hidden sm:table-cell">Top-1K EO</th>
                    {(onToggleLock || onToggleExclude) && (
                      <th className="py-2.5 px-3 text-center">Rules</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 text-xs">
                  {benchPlayers.map((p, idx) => {
                    const isLocked = lockedPlayerIds.includes(p.id);
                    const isExcluded = excludedPlayerIds.includes(p.id);
                    const nextFix = p.next_fixtures?.[0];
                    const isGkp = idx === 0 || p.element_type === 1 || p.position === 'GKP';
                    const subLabel = isGkp ? 'GKP' : `${idx}. Sub`;

                    return (
                      <tr 
                        key={p.id} 
                        className={cn(
                          "bg-slate-950/40 hover:bg-slate-900/70 transition-colors",
                          isLocked && "bg-amber-400/5",
                          isExcluded && "bg-rose-500/5 opacity-60"
                        )}
                      >
                        {/* Sub Priority Label */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                            {subLabel}
                          </span>
                        </td>

                        {/* Player Name & Team */}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-white text-xs sm:text-sm">{p.web_name}</span>
                                {p.chance_of_playing_next_round !== undefined && p.chance_of_playing_next_round !== null && p.chance_of_playing_next_round < 100 && (
                                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[8px] font-mono px-1 rounded font-bold">
                                    {p.chance_of_playing_next_round}%
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 font-medium">
                                {p.team_name || p.team_short_name}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Next Fixture(s) with FDR */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {showFixtures && p.next_fixtures && p.next_fixtures.length > 0 ? (
                            <div className="flex items-center gap-1 sm:gap-1.5">
                              {p.next_fixtures.slice(0, 3).map((f, i) => (
                                <div key={i} className="flex items-center gap-1 bg-slate-900/80 px-1.5 py-0.5 rounded border border-slate-800">
                                  <span className="text-[10px] sm:text-xs font-mono font-bold text-slate-200">
                                    {f.opponent} ({f.is_home ? 'H' : 'A'})
                                  </span>
                                  <span className={cn("text-[8.5px] font-mono px-1 py-0.2 rounded shadow-sm", getFdrBadgeColor(f.difficulty))}>
                                    FDR {f.difficulty}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : nextFix ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-mono font-bold text-slate-200">
                                {nextFix.opponent} ({nextFix.is_home ? 'H' : 'A'})
                              </span>
                              <span className={cn("text-[9px] font-mono px-1.5 py-0.5 rounded shadow-sm", getFdrBadgeColor(nextFix.difficulty))}>
                                FDR {nextFix.difficulty}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500 font-mono">TBD</span>
                          )}
                        </td>

                        {/* Cost */}
                        <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-300 font-bold whitespace-nowrap">
                          £{((p.now_cost || p.cost || 0) / 10).toFixed(1)}m
                        </td>

                        {/* Immediate GW xP */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <span className="font-mono font-bold text-xs sm:text-sm text-slate-300">
                            {(p.xP || 0).toFixed(1)}
                          </span>
                        </td>

                        {/* 8-GW Horizon xP */}
                        <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-400 whitespace-nowrap hidden md:table-cell">
                          {(p.horizonXP || (p.xP || 0) * 8).toFixed(1)}
                        </td>

                        {/* Top-1K EO */}
                        <td className="py-2.5 px-3 text-right font-mono text-xs whitespace-nowrap hidden sm:table-cell">
                          <span className={cn(
                            "font-bold",
                            (p.eo ?? 0) >= 30 ? "text-cyan-400" : "text-slate-500"
                          )}>
                            {p.eo !== undefined ? `${p.eo}%` : `${p.ownership || 0}%`}
                          </span>
                        </td>

                        {/* Lock & Exclude Rule Buttons */}
                        {(onToggleLock || onToggleExclude) && (
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              {onToggleLock && (
                                <button
                                  type="button"
                                  onClick={() => onToggleLock(p.id)}
                                  title={isLocked ? "Unlock player" : "Lock player into squad"}
                                  className={cn(
                                    "p-1 rounded transition-colors",
                                    isLocked
                                      ? "bg-amber-400/20 text-amber-300 border border-amber-400/40"
                                      : "text-slate-500 hover:text-slate-300"
                                  )}
                                >
                                  <Lock className="w-3 h-3" />
                                </button>
                              )}
                              {onToggleExclude && (
                                <button
                                  type="button"
                                  onClick={() => onToggleExclude(p.id)}
                                  title={isExcluded ? "Remove exclusion" : "Exclude player from squad"}
                                  className={cn(
                                    "p-1 rounded transition-colors",
                                    isExcluded
                                      ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                                      : "text-slate-500 hover:text-slate-300"
                                  )}
                                >
                                  <Ban className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

    </motion.div>
  );
};
