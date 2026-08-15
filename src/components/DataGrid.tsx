import { motion } from 'motion/react';
import { RecommendationResponse } from '../types';
import { Lock, Ban } from 'lucide-react';
import { cn } from '../lib/utils';

interface DataGridProps {
  data: RecommendationResponse | null;
  lockedPlayerIds?: number[];
  excludedPlayerIds?: number[];
  onToggleLock?: (id: number) => void;
  onToggleExclude?: (id: number) => void;
}

export const DataGrid = ({ 
  data, 
  lockedPlayerIds = [], 
  excludedPlayerIds = [], 
  onToggleLock, 
  onToggleExclude 
}: DataGridProps) => {
  return (
    <motion.div 
      key="data-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full overflow-y-auto pr-2 custom-scrollbar"
    >
      {(['gkp', 'def', 'mid', 'fwd'] as const).map((pos) => {
        const posLabels = { gkp: 'Goalkeepers', def: 'Defenders', mid: 'Midfielders', fwd: 'Forwards' };
        return (
          <div key={pos} className="bg-slate-950/40 rounded-2xl border border-fpl-border overflow-hidden">
            <div className="px-3 py-2 bg-slate-900/50 border-b border-fpl-border flex justify-between items-center">
              <span className="text-[10px] font-black uppercase text-fpl-green tracking-widest">{posLabels[pos]}</span>
              <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">xP / EO / Actions</span>
            </div>
            <div className="divide-y divide-fpl-border/50">
              {data?.topPicks[pos]?.map(p => {
                const isLocked = lockedPlayerIds.includes(p.id);
                const isExcluded = excludedPlayerIds.includes(p.id);

                return (
                  <div key={p.id} className={cn(
                    "p-2 flex items-center justify-between hover:bg-white/5 transition-colors",
                    isLocked && "bg-amber-500/10 border-l-2 border-amber-400",
                    isExcluded && "opacity-40 line-through bg-rose-500/5"
                  )}>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-200">{p.web_name}</span>
                        {isLocked && <span className="text-[8px] bg-amber-400 text-slate-950 font-black px-1 rounded">LOCKED</span>}
                        {isExcluded && <span className="text-[8px] bg-rose-500 text-white font-black px-1 rounded">BANNED</span>}
                      </div>
                      <span className="text-[9px] text-slate-500 uppercase font-medium">{p.team_short_name} • £{((p?.now_cost || 0)/10).toFixed(1)}m</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-fpl-green">
                        {typeof p.xP === 'number' ? p.xP.toFixed(1) : '—'} <span className="text-[8px] text-slate-500 font-normal">xP</span>
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-900/80 px-1.5 py-0.5 rounded border border-fpl-border/30">
                        {typeof p.eo === 'number' ? `${p.eo.toFixed(0)}%` : '0%'} <span className="text-[8px] text-slate-600 font-normal uppercase">EO</span>
                      </span>
                      
                      {/* Action buttons */}
                      <div className="flex items-center gap-1 ml-1">
                        {onToggleLock && (
                          <button
                            onClick={() => onToggleLock(p.id)}
                            title={isLocked ? "Unlock Player" : "Lock Player"}
                            className={cn(
                              "p-1 rounded transition-colors",
                              isLocked ? "bg-amber-400 text-slate-950" : "bg-slate-900 text-slate-400 hover:text-amber-300 hover:bg-slate-800"
                            )}
                          >
                            <Lock className="w-3 h-3" />
                          </button>
                        )}
                        {onToggleExclude && (
                          <button
                            onClick={() => onToggleExclude(p.id)}
                            title={isExcluded ? "Unban Player" : "Exclude Player"}
                            className={cn(
                              "p-1 rounded transition-colors",
                              isExcluded ? "bg-rose-500 text-white" : "bg-slate-900 text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                            )}
                          >
                            <Ban className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </motion.div>
  );
};
