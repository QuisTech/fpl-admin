import { motion } from 'motion/react';
import { PlayerCard } from './PlayerCard';
import { RecommendationResponse, ScoredPlayer } from '../types';
import { Zap, Shield, Lock, Ban, X, ArrowRightLeft, Sparkles } from 'lucide-react';
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

  return (
    <motion.div 
      key="pitch-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-grow flex flex-col justify-between py-2"
    >
      {/* Top Controls: Scenario Switcher & Delta Comparison Bar */}
      <div className="space-y-2 mb-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 bg-slate-950/80 p-2 rounded-xl border border-fpl-border/70 backdrop-blur-sm">
          {/* Scenario Switcher */}
          <div className="flex items-center gap-1.5 bg-slate-900/90 p-1 rounded-lg border border-slate-800 w-full sm:w-auto">
            <button
              onClick={() => onSelectScenario?.('quant')}
              className={cn(
                "flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all",
                activeScenario === 'quant'
                  ? "bg-fpl-green text-slate-950 shadow-[0_0_10px_rgba(0,255,133,0.3)]"
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
                  ? "bg-purple-600 text-white shadow-[0_0_10px_rgba(168,85,247,0.3)]"
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
              <div className="flex items-center gap-1 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
                <span className="text-slate-500 font-bold uppercase text-[8px]">Delta xP</span>
                <span className={cn(
                  "font-black font-mono",
                  delta.xpDiff >= 0 ? "text-emerald-400" : "text-amber-400"
                )}>
                  {delta.xpDiff > 0 ? `+${delta.xpDiff}` : delta.xpDiff} pts
                </span>
              </div>

              <div className="flex items-center gap-1 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
                <span className="text-slate-500 font-bold uppercase text-[8px]">Delta EO</span>
                <span className={cn(
                  "font-black font-mono",
                  delta.eoDiff >= 0 ? "text-cyan-400" : "text-slate-300"
                )}>
                  {delta.eoDiff > 0 ? `+${delta.eoDiff}` : delta.eoDiff}%
                </span>
              </div>

              {delta.swaps?.length > 0 && (
                <div className="flex items-center gap-1 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800 hidden md:flex">
                  <ArrowRightLeft className="w-3 h-3 text-slate-400" />
                  <span className="text-slate-300 font-bold">{delta.swaps.length} Swaps</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Active Constraints (Locks & Excludes) Pill Bar */}
        {hasConstraints && (
          <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-slate-950/60 border border-slate-800/80 rounded-lg">
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

      {/* Starting XI Lines */}
      <div className="flex justify-around items-center my-1">
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
      <div className="flex justify-around items-center my-1">
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
      <div className="flex justify-around items-center my-1">
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
      <div className="flex justify-around items-center my-1">
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

      {/* Pitch Bench Sub-Component */}
      <div className="mt-4 pt-3 border-t border-fpl-border/50">
        <div className="flex justify-center gap-2">
           {data?.bench?.filter(Boolean).map(p => (
             <PlayerCard 
               key={p.id} 
               player={p} 
               compact 
               isLocked={lockedPlayerIds.includes(p.id)}
               isExcluded={excludedPlayerIds.includes(p.id)}
               onToggleLock={onToggleLock}
               onToggleExclude={onToggleExclude}
             />
           ))}
        </div>
        <p className="text-center text-[9px] font-bold text-slate-600 uppercase tracking-widest mt-2 px-6">Substitution Bench</p>
      </div>
    </motion.div>
  );
};
