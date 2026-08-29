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

  const scenarioComp = data?.engineDiagnostics?.metrics?.scenarioComparison;
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
      {/* Top Controls: Scenario Switcher & Delta Comparison Bar */}
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

        {/* Active Constraints (Locks & Excludes) Pill Bar */}
        {hasConstraints && (
          <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-slate-950/70 border border-slate-800/90 rounded-lg backdrop-blur-sm">
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
      </div>

      {/* 🌟 Authentic Football Pitch Container (Official Premier League 3D Perspective Broadcast Pitch) */}
      <div className="relative mx-auto w-full py-1">
        <div 
          className="relative rounded-2xl overflow-hidden shadow-2xl border-2 border-emerald-500/60 bg-[#00a350] p-2 sm:p-4 md:p-6"
          style={{
            clipPath: 'polygon(6.5% 0%, 93.5% 0%, 100% 100%, 0% 100%)',
          }}
        >
          {/* 🎛️ Pitch Stadium HUD: Floating Fixture Ticker Toggle */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-8 z-30">
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
                #00a350 46px,
                #009b4d 46px,
                #009b4d 92px
              )`
            }}
          />

          {/* 🏟️ Authentic High-Contrast Official Pitch Diagram (Vector SVG) */}
          <svg 
            className="absolute inset-0 w-full h-full pointer-events-none stroke-white/70 fill-none" 
            preserveAspectRatio="none" 
            viewBox="0 0 1000 700"
          >
            {/* Outer Pitch Touchlines & Boundary (Tapered Perspective) */}
            <polygon points="65,10 935,10 990,690 10,690" strokeWidth="3.5" />
            
            {/* Goal Mouth & Net (Behind Goal Line) */}
            <polygon points="410,1 590,1 595,10 405,10" strokeWidth="2" className="stroke-white/40 fill-white/10" />

            {/* Top 6-Yard Goal Box */}
            <polygon points="370,10 630,10 638,78 362,78" strokeWidth="2.5" />

            {/* Top 18-Yard Penalty Area in Perspective */}
            <polygon points="250,10 750,10 770,205 230,205" strokeWidth="3" />
            
            {/* Penalty Spot */}
            <circle cx="500" cy="140" r="4" className="fill-white/80" stroke="none" />
            
            {/* Penalty Arc ('D' Curving Downwards) */}
            <path d="M 400,205 A 110,70 0 0,0 600,205" strokeWidth="2.5" />

            {/* Top Corner Arcs */}
            <path d="M 65,45 A 35,35 0 0,1 100,10" strokeWidth="2.5" />
            <path d="M 900,10 A 35,35 0 0,1 935,45" strokeWidth="2.5" />

            {/* Bottom Halfway Line */}
            <line x1="10" y1="690" x2="990" y2="690" strokeWidth="4" />
            
            {/* Extended Center Circle Semi-Circle Arc & Center Spot */}
            <path d="M 300,690 A 210,135 0 0,1 700,690" strokeWidth="3" />
            <circle cx="500" cy="690" r="5" className="fill-white/80" stroke="none" />
          </svg>

          {/* 🏟️ Starting XI Lines on the Pitch */}
          <div className="relative z-10 flex flex-col justify-around min-h-[480px] sm:min-h-[540px] md:min-h-[600px] py-2 px-3 sm:px-8">
          
          {/* Goalkeeper Line */}
          <div className="flex justify-around items-center w-full my-1">
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

          {/* Defenders Line */}
          <div className="flex justify-around items-center w-full my-1">
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

          {/* Midfielders Line */}
          <div className="flex justify-around items-center w-full my-1">
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

          {/* Forwards Line */}
          <div className="flex justify-around items-center w-full my-1">
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
      </div>
    </div>

      {/* 🪑 Official Substitutes Bench Shelf */}
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/90 backdrop-blur-md p-3 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 mb-3">
          <h4 className="text-xs font-black uppercase tracking-widest text-slate-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#00ff85]"></span>
            <span>Substitutes</span>
          </h4>
          <span className="text-[9px] font-mono text-slate-500 uppercase">Auto-Sub Priority (1 → 3)</span>
        </div>

        <div className="flex justify-around items-end gap-2 px-1">
          {benchPlayers.map((p, idx) => {
            const isGkp = idx === 0 || p.element_type === 1 || p.position === 'GKP';
            const subLabel = isGkp ? 'GKP' : `${idx}. ${p.position || 'SUB'}`;

            return (
              <div key={p.id} className="flex flex-col items-center gap-1">
                {/* Official Position / Auto-Sub Priority Header Badge */}
                <div className={cn(
                  "px-2 py-0.5 rounded text-[8px] sm:text-[9px] font-mono font-black uppercase tracking-wider",
                  isGkp 
                    ? "bg-amber-400/20 text-amber-300 border border-amber-400/40" 
                    : "bg-slate-800 text-slate-300 border border-slate-700"
                )}>
                  {subLabel}
                </div>

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
            );
          })}
        </div>
      </div>

    </motion.div>
  );
};
