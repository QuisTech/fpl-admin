import { cn } from '../lib/utils';
import { ScoredPlayer } from '../types';

interface PlayerCardProps {
  player: ScoredPlayer;
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  compact?: boolean;
  key?: number | string;
}

export const PlayerCard = ({ 
  player, 
  isCaptain, 
  isViceCaptain, 
  compact = false 
}: PlayerCardProps) => {
  if (!player) return null;
  
  return (
    <div className={cn(
      "group relative flex flex-col p-1 sm:p-2 bg-slate-950 border-2 rounded-lg shadow-lg transition-transform hover:scale-105",
      isCaptain ? "border-fpl-green shadow-[0_0_15px_rgba(0,255,133,0.2)]" : isViceCaptain ? "border-fpl-pink" : "border-slate-800",
      compact 
        ? "w-[54px] h-[72px] sm:w-20 sm:h-28" 
        : "w-[68px] h-[88px] sm:w-28 sm:h-36"
    )}>
      {isCaptain && (
        <div className="absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 bg-fpl-green text-slate-950 font-black px-1 sm:px-1.5 py-0.25 sm:py-0.5 rounded text-[7px] sm:text-[8px] z-10">
          C
        </div>
      )}
      {isViceCaptain && (
        <div className="absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 bg-fpl-pink text-white font-black px-1 sm:px-1.5 py-0.25 sm:py-0.5 rounded text-[7px] sm:text-[8px] z-10">
          VC
        </div>
      )}
      
      <div className="flex-1 flex flex-col items-center justify-center space-y-0.5 sm:space-y-1">
        <div className="flex items-center gap-0.5 text-[7px] sm:text-[9px] font-bold text-slate-500 uppercase tracking-tighter">
          <span>{player.team_short_name}</span>
          {player.now_cost >= 80 && (
            <span className="text-amber-400 font-bold" title="Premium Asset">★</span>
          )}
        </div>
        <div className={cn(
          "font-bold text-slate-100 text-center leading-tight truncate w-full px-0.5 sm:px-1 bg-slate-950 rounded",
          compact ? "text-[8px] sm:text-[10px]" : "text-[9px] sm:text-[11px]"
        )}>
          {player.web_name}
        </div>
        <div className="flex flex-col items-center gap-0.5 mt-0.5 sm:mt-1">
          <span className="text-[8px] sm:text-[9px] font-bold text-fpl-green">
            {typeof player.xP === 'number' ? player.xP.toFixed(1) : '—'} <span className="hidden sm:inline text-[7px] text-slate-500 font-normal">xP</span>
          </span>
          <span className="text-[6.5px] sm:text-[8px] text-slate-400 bg-slate-900 px-1 rounded font-mono border border-fpl-border/40">
            {typeof player.eo === 'number' && player.eo > 0 
              ? `EO ${player.eo.toFixed(0)}%` 
              : typeof player.ownership === 'number' && player.ownership > 0 
                ? `Own ${player.ownership.toFixed(0)}%` 
                : 'Diff'}
          </span>
        </div>
      </div>
      
      {/* Mathematical Engine Proof Tooltip */}
      <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity z-50 bg-slate-900/95 backdrop-blur-sm border border-slate-700 text-slate-300 text-[9px] p-2 rounded shadow-2xl w-32 bottom-full mb-2 left-1/2 -translate-x-1/2 pointer-events-none">
        <div className="font-bold border-b border-slate-800 pb-1 mb-1 text-white">Engine Math</div>
        <div className="flex justify-between"><span>Raw xP:</span> <span className="text-fpl-green font-mono">{player.xP?.toFixed(2)}</span></div>
        <div className="flex justify-between"><span>Cost:</span> <span className="font-mono">£{(player.now_cost/10).toFixed(1)}M</span></div>
        <div className="flex justify-between font-bold border-t border-slate-800 pt-1 mt-1"><span>ROI:</span> <span className="text-cyan-400 font-mono">{((player.xP || 0) / (player.now_cost / 10)).toFixed(2)}</span></div>
      </div>
    </div>
  );
};
