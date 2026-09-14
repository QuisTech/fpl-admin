import React from 'react';
import { Zap, RotateCcw, Layers, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface SyncedSquadBannerProps {
  teamName: string;
  managerName?: string;
  teamId: string | number;
  playerCount?: number;
  lineupMode?: 'optimized' | 'official';
  onToggleLineupMode?: () => void;
  onResetToOptimum: () => void;
  latestPoints?: number | null;
  overallRank?: number | null;
  hasConstraints?: boolean;
  onClearConstraints?: () => void;
  transferReplacementsCount?: number;
}

export const SyncedSquadBanner: React.FC<SyncedSquadBannerProps> = ({
  teamName,
  managerName,
  teamId,
  playerCount = 15,
  lineupMode = 'optimized',
  onToggleLineupMode,
  onResetToOptimum,
  latestPoints,
  overallRank,
  hasConstraints,
  onClearConstraints,
  transferReplacementsCount,
}) => {
  return (
    <div className="w-full mb-2.5 p-2.5 sm:p-3 bg-gradient-to-r from-cyan-950/90 via-slate-950/95 to-slate-900/90 border border-cyan-500/30 rounded-2xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 sm:gap-3 shadow-xl backdrop-blur-md transition-all overflow-hidden">
      {/* Left: Squad Identity & Metrics */}
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 mt-0.5 shadow-inner">
          <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-cyan-400/20" />
        </div>

        <div className="min-w-0 flex-1">
          {/* Header Row */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="text-[11px] sm:text-xs font-black text-white uppercase tracking-wider">
              Synced Squad:
            </span>
            <span className="text-[11px] sm:text-xs font-bold text-cyan-300 truncate max-w-[130px] sm:max-w-[200px]">
              {teamName || `Squad #${teamId}`}
            </span>
            <span className="text-[9px] sm:text-[10px] font-mono bg-cyan-500/15 text-cyan-200 px-1.5 py-0.5 rounded border border-cyan-500/30 font-semibold shrink-0">
              #{teamId}
            </span>

            {latestPoints !== undefined && latestPoints !== null && (
              <span className="text-[9px] sm:text-[10px] font-mono bg-amber-400/15 text-amber-300 px-1.5 py-0.5 rounded border border-amber-400/30 font-black shrink-0">
                GW Live: {latestPoints} pts
              </span>
            )}

            {overallRank !== undefined && overallRank !== null && overallRank > 0 && (
              <span className="text-[9px] sm:text-[10px] font-mono bg-purple-500/15 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30 font-bold shrink-0">
                Rank: #{overallRank.toLocaleString()}
              </span>
            )}

            {transferReplacementsCount !== undefined && transferReplacementsCount > 0 ? (
              <span className="text-[9px] sm:text-[10px] font-mono bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/40 font-black shrink-0 flex items-center gap-1 shadow-[0_0_8px_rgba(16,185,129,0.25)]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> 8GW Transfer Active ({transferReplacementsCount} Swapped)
              </span>
            ) : hasConstraints ? (
              <span className="text-[9px] sm:text-[10px] font-mono bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded border border-rose-500/40 font-black animate-pulse shrink-0 flex items-center gap-1 shadow-[0_0_8px_rgba(244,63,94,0.2)]">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Custom Rules Active
              </span>
            ) : null}
          </div>

          {/* Subtitle / Details Row */}
          <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] text-slate-400 font-mono mt-0.5 flex-wrap">
            <span className="truncate max-w-[140px] text-slate-300 font-medium">
              {managerName || `Manager #${teamId}`}
            </span>
            <span>•</span>
            <span>{playerCount} Players</span>
            <span>•</span>
            <span className={cn(
              "font-bold truncate",
              (transferReplacementsCount !== undefined && transferReplacementsCount > 0)
                ? "text-emerald-300"
                : hasConstraints 
                  ? "text-rose-300" 
                  : lineupMode === 'optimized' 
                    ? "text-cyan-300" 
                    : "text-amber-300"
            )}>
              {(transferReplacementsCount !== undefined && transferReplacementsCount > 0)
                ? `Matrix XI (${transferReplacementsCount} 8GW Transfer${transferReplacementsCount > 1 ? 's' : ''} Active)`
                : hasConstraints 
                  ? 'Matrix XI (Custom Constraints)' 
                  : lineupMode === 'optimized' 
                    ? 'Matrix-Optimized XI Active' 
                    : 'Official FPL Submission Active'}
            </span>
          </div>
        </div>
      </div>

      {/* Right: Actions / Quick Toggles (Ultra-responsive on smartphones) */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap sm:flex-nowrap w-full md:w-auto pt-1.5 md:pt-0 border-t border-cyan-500/15 md:border-t-0 justify-end">
        {/* Clear Constraints Button */}
        {hasConstraints && onClearConstraints && (
          <button
            onClick={onClearConstraints}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer active:scale-95 border bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border-rose-500/50 hover:border-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.25)] whitespace-nowrap"
            title="Clear all player locks and exclusions"
          >
            <RotateCcw className="w-3 h-3 text-rose-300 shrink-0" />
            <span>Clear Constraints</span>
          </button>
        )}

        {/* Lineup Mode Toggle */}
        {onToggleLineupMode && (
          <button
            onClick={onToggleLineupMode}
            className={cn(
              "flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer active:scale-95 border whitespace-nowrap shadow-sm",
              lineupMode === 'optimized'
                ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40 hover:bg-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                : 'bg-amber-500/20 text-amber-200 border-amber-500/40 hover:bg-amber-500/30'
            )}
            title="Toggle between Matrix-Optimized XI and Official Live FPL Lineup"
          >
            {lineupMode === 'optimized' ? (
              <>
                <Zap className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="sm:hidden">Matrix XI</span>
                <span className="hidden sm:inline">Matrix XI (Auto)</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="sm:hidden">Official XI</span>
                <span className="hidden sm:inline">Official FPL XI</span>
              </>
            )}
          </button>
        )}

        {/* Reset to Global Optimum Button */}
        <button
          onClick={onResetToOptimum}
          className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer active:scale-95 shadow-sm whitespace-nowrap"
          title="Switch pitch back to global mathematical optimum"
        >
          <Layers className="w-3 h-3 text-slate-400 shrink-0" />
          <span className="sm:hidden">Optimum</span>
          <span className="hidden sm:inline">Global Optimum</span>
        </button>
      </div>
    </div>
  );
};
