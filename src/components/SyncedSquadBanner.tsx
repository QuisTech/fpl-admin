import React from 'react';

interface SyncedSquadBannerProps {
  teamName: string;
  managerName?: string;
  teamId: string | number;
  playerCount?: number;
  lineupMode?: 'optimized' | 'official';
  onToggleLineupMode?: () => void;
  onResetToOptimum: () => void;
}

export const SyncedSquadBanner: React.FC<SyncedSquadBannerProps> = ({
  teamName,
  managerName,
  teamId,
  playerCount = 15,
  lineupMode = 'optimized',
  onToggleLineupMode,
  onResetToOptimum,
}) => {
  return (
    <div className="w-full mb-3 p-3 sm:p-3.5 bg-cyan-950/80 border border-cyan-500/40 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg backdrop-blur-md transition-all">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-cyan-400 text-lg shrink-0">⚡</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black text-white uppercase tracking-wider">
              Synced Manager Squad:
            </span>
            <span className="text-xs font-bold text-cyan-300 truncate">
              {teamName || `Squad #${teamId}`}
            </span>
            <span className="text-[10px] font-mono bg-cyan-500/20 text-cyan-200 px-2 py-0.5 rounded border border-cyan-500/30 shrink-0">
              ID #{teamId}
            </span>
          </div>
          <p className="text-[10px] text-slate-300 font-mono mt-0.5 truncate">
            Manager: {managerName || `Manager #${teamId}`} • {playerCount} Squad Players • {lineupMode === 'optimized' ? 'Matrix-Optimized XI Active' : 'Official FPL Submission Active'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
        {onToggleLineupMode && (
          <button
            onClick={onToggleLineupMode}
            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer active:scale-95 shadow-sm border ${
              lineupMode === 'optimized'
                ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40 hover:bg-cyan-500/30'
                : 'bg-amber-500/20 text-amber-200 border-amber-500/40 hover:bg-amber-500/30'
            }`}
            title="Toggle between Matrix-Optimized XI and Official Live FPL Lineup"
          >
            {lineupMode === 'optimized' ? '⚡ Matrix XI (Auto-Moved)' : '📋 Official FPL XI'}
          </button>
        )}
        <button
          onClick={onResetToOptimum}
          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shrink-0 cursor-pointer active:scale-95 shadow-sm"
          title="Switch pitch back to global mathematical optimum"
        >
          Reset to Global Optimum
        </button>
      </div>
    </div>
  );
};

