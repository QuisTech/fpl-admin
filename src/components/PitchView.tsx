import React, { useState } from 'react';
import { motion } from 'motion/react';
import { PlayerCard } from './PlayerCard';
import { RecommendationResponse, ScoredPlayer } from '../types';
import { Zap, Shield, Lock, Ban, X, ArrowRightLeft, Calendar, Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';

interface PitchViewProps {
  data: RecommendationResponse | null;
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

export const PitchView = ({ 
  data, 
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

  return (
    <motion.div 
      key="pitch-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-grow flex flex-col justify-between py-2 w-full max-w-5xl mx-auto"
    >
      {/* Top Controls: Scenario Switcher & Delta Comparison Bar (Only rendered when onSelectScenario is provided) */}
      {onSelectScenario && (
        <div className="space-y-2 mb-3">
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

      {/* 🌟 Authentic Football Pitch Container (1:1 Proportional Match with Official FPL) */}
      <div className="relative mx-auto w-full max-w-2xl py-1">
        <div className="relative rounded-2xl overflow-hidden shadow-2xl border-2 border-slate-800 bg-[#00a350] p-2 sm:p-4">
          
          {/* 🎛️ Pitch Stadium HUD: Floating Fixture Ticker Toggle */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-30">
            <button
              onClick={() => setShowFixtures(!showFixtures)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider backdrop-blur-md transition-all shadow-lg select-none",
                showFixtures 
                  ? "bg-black/70 border-emerald-400/50 text-[#00ff85] hover:bg-black/90 hover:border-emerald-400" 
                  : "bg-black/40 border-white/20 text-white/70 hover:bg-black/70 hover:text-white"
              )}
              title="Toggle upcoming 3-match FDR fixture ticker under players"
            >
              {showFixtures ? (
                <>
                  <Eye className="w-3 h-3 text-[#00ff85]" />
                  <span>3-Match FDR: On</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-3 h-3 text-white/50" />
                  <span>3-Match FDR: Off</span>
                </>
              )}
            </button>
          </div>

          {/* Realistic Mown Grass Horizontal Lawn Stripes Background */}
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `repeating-linear-gradient(
                to bottom,
                #00a350,
                #00a350 48px,
                #009b4d 48px,
                #009b4d 96px
              )`
            }}
          />

          {/* 🏟️ Authentic Zoomed Official Pitch Diagram SVG (Aligned with Rows) */}
          <svg 
            className="absolute inset-0 w-full h-full pointer-events-none stroke-white/80 fill-none" 
            preserveAspectRatio="none" 
            viewBox="0 0 800 1050"
          >
            {/* 🏟️ Stadium Outer Flanks (#0f172a Dark Surround in Upper Half Outside Slanted Sidelines) */}
            <polygon 
              points="-10,-10 290,-10 290,4 278,30 125,30 0,700 -10,700 -10,-10" 
              className="fill-[#0f172a] stroke-[#0f172a]" 
              strokeWidth="2"
            />
            <polygon 
              points="810,-10 510,-10 510,4 522,30 675,30 800,700 810,700 810,-10" 
              className="fill-[#0f172a] stroke-[#0f172a]" 
              strokeWidth="2"
            />
            <polygon 
              points="285,-10 515,-10 515,4 285,4" 
              className="fill-[#0f172a] stroke-[#0f172a]" 
              strokeWidth="2"
            />

            {/* Top Goal Net (Above Goal Line with Crosshatch Pattern) */}
            <polygon points="290,4 510,4 522,30 278,30" strokeWidth="1.8" className="stroke-white/50 fill-white/10" />
            <line x1="330" y1="4" x2="330" y2="30" strokeWidth="1" className="stroke-white/40" />
            <line x1="370" y1="4" x2="370" y2="30" strokeWidth="1" className="stroke-white/40" />
            <line x1="400" y1="4" x2="400" y2="30" strokeWidth="1" className="stroke-white/40" />
            <line x1="430" y1="4" x2="430" y2="30" strokeWidth="1" className="stroke-white/40" />
            <line x1="470" y1="4" x2="470" y2="30" strokeWidth="1" className="stroke-white/40" />
            <line x1="284" y1="16" x2="516" y2="16" strokeWidth="1" className="stroke-white/40" />

            {/* Top Goal Line */}
            <line x1="125" y1="30" x2="675" y2="30" strokeWidth="3" />

            {/* Slanted Sideline Touchlines (Tapering from Top Inward to Edge-to-Edge at Halfway Line) */}
            <line x1="125" y1="30" x2="0" y2="700" strokeWidth="3.5" />
            <line x1="675" y1="30" x2="800" y2="700" strokeWidth="3.5" />

            {/* Top 6-Yard Goal Area */}
            <polygon points="295,30 505,30 512,85 288,85" strokeWidth="2.2" />

            {/* Top 18-Yard Penalty Area in Perspective */}
            <polygon points="200,30 600,30 618,175 182,175" strokeWidth="2.8" />
            
            {/* Penalty Spot */}
            <circle cx="400" cy="130" r="4.5" className="fill-white" stroke="none" />
            
            {/* Penalty Arc ('D' Curving Downwards from 18-Yard Box) */}
            <path d="M 325,175 A 85,50 0 0,0 475,175" strokeWidth="2.5" />

            {/* Top Corner Arcs (Curving Inwards and Touching Both Goal Line & Slanted Sideline) */}
            <path d="M 119.9,57.5 A 28,28 0 0,0 153,30" strokeWidth="2.5" />
            <path d="M 647,30 A 28,28 0 0,0 680.1,57.5" strokeWidth="2.5" />

            {/* Halfway Line (Cutting horizontally through the center of the Forwards row) */}
            <line x1="0" y1="700" x2="800" y2="700" strokeWidth="4" />
            
            {/* Huge Prominent Center Circle (Encircling the Forwards row) */}
            <ellipse cx="400" cy="700" rx="180" ry="120" strokeWidth="3.2" />
            <circle cx="400" cy="700" r="5" className="fill-white" stroke="none" />
          </svg>

          {/* 🏟️ Starting XI Lines on the Pitch (Exact Row Proportions matching Official FPL) */}
          <div className="relative z-10 flex flex-col justify-between min-h-[580px] sm:min-h-[660px] md:min-h-[720px] py-3 sm:py-5">
            
            {/* Row 1: Goalkeeper (Inside Goalmouth & 18-Yard Box) */}
            <div className="flex justify-center items-center w-full my-1">
              {formation.gkp.map(p => (
                <PlayerCard 
                  key={p.id} 
                  player={p} 
                  showFixtures={showFixtures}
                  isCaptain={!!(data?.captain?.id && p.id === data.captain.id)} 
                  isViceCaptain={!!(data?.viceCaptain?.id && p.id === data.viceCaptain.id)}
                  isLocked={lockedPlayerIds.includes(p.id)}
                  isExcluded={excludedPlayerIds.includes(p.id)}
                  onToggleLock={onToggleLock}
                  onToggleExclude={onToggleExclude}
                />
              ))}
            </div>

            {/* Row 2: Defenders (Upper Pitch between Penalty Box & Midfield) */}
            <div className="flex justify-around items-center w-full max-w-[85%] mx-auto my-2 sm:my-3">
              {formation.def.map(p => (
                <PlayerCard 
                  key={p.id} 
                  player={p} 
                  showFixtures={showFixtures}
                  isCaptain={!!(data?.captain?.id && p.id === data.captain.id)} 
                  isViceCaptain={!!(data?.viceCaptain?.id && p.id === data.viceCaptain.id)}
                  isLocked={lockedPlayerIds.includes(p.id)}
                  isExcluded={excludedPlayerIds.includes(p.id)}
                  onToggleLock={onToggleLock}
                  onToggleExclude={onToggleExclude}
                />
              ))}
            </div>

            {/* Row 3: Midfielders (Wider Middle Pitch above Halfway Line) */}
            <div className="flex justify-around items-center w-full max-w-[96%] mx-auto my-2 sm:my-3">
              {formation.mid.map(p => (
                <PlayerCard 
                  key={p.id} 
                  player={p} 
                  showFixtures={showFixtures}
                  isCaptain={!!(data?.captain?.id && p.id === data.captain.id)} 
                  isViceCaptain={!!(data?.viceCaptain?.id && p.id === data.viceCaptain.id)}
                  isLocked={lockedPlayerIds.includes(p.id)}
                  isExcluded={excludedPlayerIds.includes(p.id)}
                  onToggleLock={onToggleLock}
                  onToggleExclude={onToggleExclude}
                />
              ))}
            </div>

            {/* Row 4: Forwards (Inside the Center Circle & Over Halfway Line) */}
            <div className="flex justify-around items-center w-full max-w-[78%] mx-auto my-2 sm:my-3">
              {formation.fwd.map(p => (
                <PlayerCard 
                  key={p.id} 
                  player={p} 
                  showFixtures={showFixtures}
                  isCaptain={!!(data?.captain?.id && p.id === data.captain.id)} 
                  isViceCaptain={!!(data?.viceCaptain?.id && p.id === data.viceCaptain.id)}
                  isLocked={lockedPlayerIds.includes(p.id)}
                  isExcluded={excludedPlayerIds.includes(p.id)}
                  onToggleLock={onToggleLock}
                  onToggleExclude={onToggleExclude}
                />
              ))}
            </div>
          </div>

          {/* 🪑 Official Substitutes Bench Dugout Shelf (Proportional Frosted Shelf at Pitch Bottom) */}
          <div className="relative z-10 w-full max-w-[90%] mx-auto mt-4 sm:mt-6 rounded-xl border border-emerald-400/40 bg-emerald-950/45 backdrop-blur-md p-3 sm:p-4 shadow-2xl">
            <div className="flex justify-around items-end gap-1 sm:gap-3 px-1 sm:px-2">
              {benchPlayers.map((p, idx) => {
                const isGkp = idx === 0 || p.element_type === 1 || p.position === 'GKP';
                const subLabel = isGkp ? 'GKP' : `${idx}. ${p.position || 'SUB'}`;

                return (
                  <div key={p.id} className="flex flex-col items-center gap-1">
                    {/* Official Position / Auto-Sub Priority Header Label */}
                    <div className="text-[9px] sm:text-[10px] font-mono font-extrabold uppercase tracking-wider text-emerald-100 border-b border-dotted border-white/40 pb-0.5 px-1">
                      {subLabel}
                    </div>

                    {/* Semi-transparent frosted slot card wrapper */}
                    <div className="bg-white/10 rounded-lg p-1 border border-white/15 shadow-inner">
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
          </div>

        </div>
      </div>

    </motion.div>
  );
};
