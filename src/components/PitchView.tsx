import { motion } from 'motion/react';
import { PlayerCard } from './PlayerCard';
import { RecommendationResponse, ScoredPlayer } from '../types';
import { Zap, Shield, Lock, Ban, X, ArrowRightLeft } from 'lucide-react';
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
          {/* Scenario Switcher */}
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

          {/* Delta Metric Badge Bar */}
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

      {/* 🌟 Authentic Football Pitch Container (Official Premier League #00a350 & #009b4d Turf) */}
      <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-emerald-600/40 bg-[#00a350] p-2 sm:p-4">
        
        {/* Realistic Mown Grass Horizontal Lawn Stripes Background */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `repeating-linear-gradient(
              to bottom,
              #00a350,
              #00a350 42px,
              #009b4d 42px,
              #009b4d 84px
            )`
          }}
        />

        {/* Crisp Field Boundary & Pitch Markings SVG Overlay */}
        <div className="absolute inset-2 sm:inset-4 border-2 border-white/35 rounded-xl pointer-events-none">
          {/* Halfway Line */}
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white/35 -translate-y-1/2" />
          
          {/* Center Circle */}
          <div className="absolute top-1/2 left-1/2 w-28 h-28 sm:w-36 sm:h-36 border-2 border-white/35 rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-white/40 rounded-full -translate-x-1/2 -translate-y-1/2" />

          {/* Top Penalty Box (GKP Area) */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 sm:w-64 h-20 sm:h-24 border-b-2 border-x-2 border-white/35 rounded-b-lg">
            {/* Goal Box */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 sm:w-32 h-8 sm:h-10 border-b-2 border-x-2 border-white/35 rounded-b" />
            {/* Penalty Spot */}
            <div className="absolute top-14 sm:top-16 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-white/40 rounded-full" />
            {/* Penalty Arc */}
            <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-16 h-8 border-b-2 border-white/35 rounded-b-full" />
          </div>

          {/* Bottom Penalty Box */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-48 sm:w-64 h-20 sm:h-24 border-t-2 border-x-2 border-white/35 rounded-t-lg">
            {/* Goal Box */}
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-24 sm:w-32 h-8 sm:h-10 border-t-2 border-x-2 border-white/35 rounded-t" />
            {/* Penalty Spot */}
            <div className="absolute bottom-14 sm:bottom-16 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-white/40 rounded-full" />
            {/* Penalty Arc */}
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-16 h-8 border-t-2 border-white/35 rounded-t-full" />
          </div>

          {/* Corner Arcs */}
          <div className="absolute top-0 left-0 w-4 h-4 border-b-2 border-r-2 border-white/35 rounded-br-full" />
          <div className="absolute top-0 right-0 w-4 h-4 border-b-2 border-l-2 border-white/35 rounded-bl-full" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-t-2 border-r-2 border-white/35 rounded-tr-full" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-t-2 border-l-2 border-white/35 rounded-tl-full" />
        </div>

        {/* 🏟️ Starting XI Lines on the Pitch */}
        <div className="relative z-10 flex flex-col justify-around min-h-[460px] sm:min-h-[520px] md:min-h-[580px] py-2">
          
          {/* Goalkeeper Line */}
          <div className="flex justify-around items-center w-full my-1">
            {formation.gkp.map(p => (
              <PlayerCard 
                key={p.id} 
                player={p} 
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
