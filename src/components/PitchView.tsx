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
          className="relative rounded-2xl overflow-hidden shadow-2xl border border-emerald-600/50 bg-[#00a350] p-2 sm:p-4 md:p-6"
          style={{
            clipPath: 'polygon(3.5% 0%, 96.5% 0%, 100% 100%, 0% 100%)',
          }}
        >
          {/* 🎛️ Pitch Stadium HUD: Floating Fixture Ticker Toggle */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-6 z-30">
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
                #00a350 44px,
                #009b4d 44px,
                #009b4d 88px
              )`
            }}
          />

          {/* Crisp 3D Broadcast Perspective Pitch Boundary & Field Markings SVG */}
          <svg 
            className="absolute inset-0 w-full h-full pointer-events-none stroke-white/40 fill-none" 
            preserveAspectRatio="none" 
            viewBox="0 0 1000 700"
          >
            {/* Outer Pitch Border (Tapered in Broadcast Perspective) */}
            <polygon points="50,15 950,15 985,685 15,685" strokeWidth="2.5" />
            
            {/* Halfway Line */}
            <line x1="33" y1="350" x2="967" y2="350" strokeWidth="2" />
            
            {/* Center Circle & Spot in Perspective */}
            <ellipse cx="500" cy="350" rx="90" ry="55" strokeWidth="2" />
            <circle cx="500" cy="350" r="3" className="fill-white/50" />

            {/* Top Penalty Box (GKP Area - Perspective) */}
            <polygon points="340,15 660,15 675,145 325,145" strokeWidth="2" />
            {/* Top Goal Box */}
            <polygon points="420,15 580,15 585,60 415,60" strokeWidth="1.8" />
            {/* Top Penalty Spot */}
            <circle cx="500" cy="100" r="2.5" className="fill-white/50" />
            {/* Top Penalty Arc */}
            <path d="M 435,145 A 68,45 0 0,0 565,145" strokeWidth="2" />

            {/* Bottom Penalty Box (Perspective) */}
            <polygon points="315,555 685,555 700,685 300,685" strokeWidth="2" />
            {/* Bottom Goal Box */}
            <polygon points="410,640 590,640 595,685 405,685" strokeWidth="1.8" />
            {/* Bottom Penalty Spot */}
            <circle cx="500" cy="600" r="2.5" className="fill-white/50" />
            {/* Bottom Penalty Arc */}
            <path d="M 430,555 A 72,50 0 0,1 570,555" strokeWidth="2" />

            {/* Corner Arcs */}
            <path d="M 50,40 A 25,25 0 0,1 75,15" strokeWidth="2" />
            <path d="M 925,15 A 25,25 0 0,1 950,40" strokeWidth="2" />
            <path d="M 15,660 A 25,25 0 0,0 40,685" strokeWidth="2" />
            <path d="M 960,685 A 25,25 0 0,0 985,660" strokeWidth="2" />
          </svg>

          {/* 🏟️ Starting XI Lines on the Pitch */}
          <div className="relative z-10 flex flex-col justify-around min-h-[480px] sm:min-h-[540px] md:min-h-[600px] py-2 px-2 sm:px-6">
          
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
