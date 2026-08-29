import React, { useState } from 'react';
import { cn } from '../lib/utils';
import { ScoredPlayer } from '../types';
import { Lock, Ban } from 'lucide-react';

interface PlayerCardProps {
  player: ScoredPlayer;
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  isLocked?: boolean;
  isExcluded?: boolean;
  onToggleLock?: (id: number) => void;
  onToggleExclude?: (id: number) => void;
  compact?: boolean;
  benchIndex?: number;
  showFixtures?: boolean;
  key?: number | string;
}

const TEAM_SHIRT_CODES: Record<string, number> = {
  ARS: 3,
  AVL: 7,
  BOU: 91,
  BRE: 94,
  BHA: 36,
  CHE: 8,
  CRY: 31,
  EVE: 11,
  FUL: 54,
  IPS: 40,
  LEI: 13,
  LIV: 14,
  MCI: 43,
  MUN: 1,
  NEW: 4,
  NFO: 17,
  SOU: 20,
  TOT: 6,
  WHU: 21,
  WOL: 39,
  LEE: 2,
  SUN: 56,
  SHU: 49,
  BUR: 90,
  LUT: 102
};

const TEAM_COLORS: Record<string, { primary: string; secondary: string }> = {
  ARS: { primary: '#EF0107', secondary: '#FFFFFF' },
  AVL: { primary: '#95BFE5', secondary: '#670E36' },
  BOU: { primary: '#DA291C', secondary: '#000000' },
  BRE: { primary: '#E30613', secondary: '#FFFFFF' },
  BHA: { primary: '#0057B8', secondary: '#FFFFFF' },
  CHE: { primary: '#034694', secondary: '#FFFFFF' },
  CRY: { primary: '#1B458F', secondary: '#C4122E' },
  EVE: { primary: '#003399', secondary: '#FFFFFF' },
  FUL: { primary: '#FFFFFF', secondary: '#000000' },
  IPS: { primary: '#0054A6', secondary: '#FFFFFF' },
  LEI: { primary: '#003090', secondary: '#FDBE11' },
  LIV: { primary: '#C8102E', secondary: '#00B2A9' },
  MCI: { primary: '#6CABDD', secondary: '#FFFFFF' },
  MUN: { primary: '#DA291C', secondary: '#000000' },
  NEW: { primary: '#241F20', secondary: '#FFFFFF' },
  NFO: { primary: '#DD0000', secondary: '#FFFFFF' },
  SOU: { primary: '#D71920', secondary: '#FFFFFF' },
  TOT: { primary: '#FFFFFF', secondary: '#132257' },
  WHU: { primary: '#7A263A', secondary: '#1BB1E7' },
  WOL: { primary: '#FDB913', secondary: '#231F20' },
  LEE: { primary: '#FFCD00', secondary: '#1D428A' },
  SUN: { primary: '#EB172B', secondary: '#FFFFFF' }
};

export const PlayerCard = ({ 
  player, 
  isCaptain, 
  isViceCaptain, 
  isLocked, 
  isExcluded, 
  onToggleLock, 
  onToggleExclude, 
  compact = false,
  showFixtures = true,
  benchIndex
}: PlayerCardProps) => {
  const [imgError, setImgError] = useState(false);

  if (!player) return null;

  const teamShort = player.team_short_name?.toUpperCase() || 'UNK';
  const teamCode = TEAM_SHIRT_CODES[teamShort] || player.team || 1;
  const isGkp = player.element_type === 1 || player.position === 'GKP';
  const shirtBaseName = `shirt_${teamCode}${isGkp ? '_1' : ''}`;
  const shirtUrl = `https://fantasy.premierleague.com/dist/img/shirts/standard/${shirtBaseName}-220.webp`;
  const shirtSrcSet = `https://fantasy.premierleague.com/dist/img/shirts/standard/${shirtBaseName}-66.webp 66w, https://fantasy.premierleague.com/dist/img/shirts/standard/${shirtBaseName}-110.webp 110w, https://fantasy.premierleague.com/dist/img/shirts/standard/${shirtBaseName}-220.webp 220w`;

  const nextFixture = player.next_fixtures?.[0];
  const colors = TEAM_COLORS[teamShort] || { primary: '#37003c', secondary: '#00ff85' };

  return (
    <div className={cn(
      "group relative flex flex-col items-center justify-start transition-all duration-200 hover:scale-105 select-none",
      compact ? "w-[52px] sm:w-[68px] md:w-[76px]" : "w-[56px] sm:w-[72px] md:w-[82px] lg:w-[88px]",
      isExcluded && "opacity-35 grayscale"
    )}>

      {/* Official Captain / Vice-Captain Circular Badge */}
      {isCaptain && (
        <div 
          title="Captain (2x Points)"
          className="absolute -top-1.5 -left-1 sm:-top-2 sm:-left-1.5 z-30 flex items-center justify-center w-4.5 h-4.5 sm:w-6 sm:h-6 rounded-full bg-[#37003c] text-white border-2 border-white/80 font-black text-[9px] sm:text-xs shadow-lg"
        >
          C
        </div>
      )}
      {isViceCaptain && !isCaptain && (
        <div 
          title="Vice Captain"
          className="absolute -top-1.5 -left-1 sm:-top-2 sm:-left-1.5 z-30 flex items-center justify-center w-4.5 h-4.5 sm:w-6 sm:h-6 rounded-full bg-[#37003c] text-[#00ff87] border-2 border-white/80 font-black text-[8px] sm:text-[11px] shadow-lg flex items-center gap-0.5"
        >
          <span>V</span>
        </div>
      )}

      {/* Lock Constraint Badge */}
      {isLocked && (
        <div 
          title="Locked in Solver (Mandatory)"
          className="absolute -top-1.5 -right-1 sm:-top-2 sm:-right-1.5 z-30 flex items-center justify-center w-4.5 h-4.5 sm:w-5 sm:h-5 rounded-full bg-amber-400 text-slate-950 shadow-md font-bold"
        >
          <Lock className="w-2.5 h-2.5 sm:w-3 sm:h-3 stroke-[2.5]" />
        </div>
      )}

      {/* Interactive Solver Constraints Hover Overlay */}
      {(onToggleLock || onToggleExclude) && (
        <div className="absolute -top-2 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 z-40 bg-slate-950/90 p-0.5 rounded-md border border-slate-700 shadow-xl">
          {onToggleLock && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock(player.id);
              }}
              title={isLocked ? "Unlock Player" : "Lock Player (Force Include in Solver)"}
              className={cn(
                "p-1 rounded transition-colors",
                isLocked ? "bg-amber-400 text-slate-950" : "text-slate-400 hover:text-amber-300 hover:bg-slate-800"
              )}
            >
              <Lock className="w-2.5 h-2.5" />
            </button>
          )}
          {onToggleExclude && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExclude(player.id);
              }}
              title={isExcluded ? "Unban Player" : "Exclude Player (Ban from Solver)"}
              className={cn(
                "p-1 rounded transition-colors",
                isExcluded ? "bg-rose-500 text-white" : "text-slate-400 hover:text-rose-400 hover:bg-slate-800"
              )}
            >
              <Ban className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      )}

      {/* 1. Official Club Jersey Container with Frosted Spotlight */}
      <div className="relative flex items-center justify-center w-10 h-10 sm:w-13 sm:h-13 md:w-15 md:h-15 mb-0.5 rounded-xl bg-white/10 border border-white/15 backdrop-blur-xs p-1 shadow-sm drop-shadow-[0_4px_6px_rgba(0,0,0,0.4)]">
        {!imgError ? (
          <picture className="w-full h-full flex items-center justify-center">
            <source 
              type="image/webp" 
              srcSet={shirtSrcSet}
              sizes="(min-width: 768px) 110px, 90px"
            />
            <img 
              src={shirtUrl} 
              srcSet={shirtSrcSet}
              sizes="(min-width: 768px) 110px, 90px"
              alt={player.team_name || teamShort}
              className="w-full h-full object-contain filter hover:brightness-110 transition-all pointer-events-none"
              onError={() => setImgError(true)}
              loading="lazy"
            />
          </picture>
        ) : (
          /* SVG Vector Jersey Fallback */
          <svg viewBox="0 0 100 100" className="w-9 h-9 sm:w-12 sm:h-12 object-contain">
            <path 
              d="M 30 15 L 42 22 C 46 25 54 25 58 22 L 70 15 L 88 35 L 75 48 L 70 42 L 70 85 C 70 88 68 90 65 90 L 35 90 C 32 90 30 88 30 85 L 30 42 L 25 48 L 12 35 Z" 
              fill={colors.primary} 
              stroke={colors.secondary} 
              strokeWidth="2.5" 
            />
            <path d="M 42 22 C 46 25 54 25 58 22" fill="none" stroke={colors.secondary} strokeWidth="3" />
          </svg>
        )}

        {/* Floating Analytical xP Badge on Jersey */}
        <div className="absolute -bottom-1 -right-1 sm:-bottom-1.5 sm:-right-1.5 bg-slate-950/95 border border-fpl-green/70 text-fpl-green font-mono font-black text-[7.5px] sm:text-[9px] px-1 py-0.2 rounded shadow-lg backdrop-blur-xs flex items-center gap-0.5">
          <span>{typeof player.xP === 'number' ? player.xP.toFixed(1) : '—'}</span>
          <span className="text-[5.5px] text-slate-400 font-normal">xP</span>
        </div>
      </div>

      {/* 2. Official 2-Tier Nameplate (Authentic Official White Background Design) */}
      <div className="w-full rounded-md shadow-md overflow-hidden border border-slate-300/80 bg-white">
        
        {/* Tier 1: Player Name Bar (Official Clean White Background with Sharp Dark Text) */}
        <div className="bg-white px-1 py-0.5 text-center flex items-center justify-center gap-1 border-b border-slate-200/90">
          <span className="font-extrabold text-slate-950 text-[8px] sm:text-[10px] md:text-[11px] leading-tight truncate">
            {player.web_name}
          </span>
        </div>

        {/* Tier 2: Next Fixture & Solid FDR Price/EO Pill */}
        <div className="w-full bg-slate-50 px-1 py-0.5 flex items-center justify-between gap-0.5 sm:gap-1 text-[6.5px] sm:text-[8px] font-bold text-slate-800">
          {/* Opponent & Venue Info */}
          <span className="truncate tracking-tighter text-slate-700 font-semibold font-mono">
            {nextFixture ? `${nextFixture.opponent} (${nextFixture.is_home ? 'H' : 'A'})` : '-'}
          </span>

          {/* Solid FDR-Colored Accent Pill (Price or Est. EO) */}
          <span className={cn(
            "text-[6.5px] sm:text-[7.5px] font-black px-1 py-0.2 rounded text-white font-mono shrink-0 shadow-sm",
            nextFixture ? (
              nextFixture.difficulty <= 2 ? "bg-[#00753b]" :
              nextFixture.difficulty === 3 ? "bg-[#374151]" :
              nextFixture.difficulty === 4 ? "bg-[#e11d48]" :
              "bg-[#881337]"
            ) : "bg-slate-700"
          )}>
            {typeof player.eo === 'number' && player.eo > 0 
              ? `${player.eo.toFixed(0)}%` 
              : `£${(player.now_cost / 10).toFixed(1)}M`}
          </span>
        </div>
      </div>

      {/* 3. Next 3 FDR Fixture Difficulty Ticker (Distinctive Solid Backgrounds) */}
      {showFixtures && !compact && player.next_fixtures && player.next_fixtures.length > 0 && (
        <div className="flex items-center justify-center gap-0.5 mt-1 w-full px-0.5">
          {player.next_fixtures.slice(0, 3).map((f, idx) => (
            <span
              key={idx}
              title={`${f.opponent} (${f.is_home ? 'Home' : 'Away'}) - FDR ${f.difficulty}`}
              className={cn(
                "text-[6.5px] sm:text-[8px] font-extrabold px-1 py-0.5 rounded font-mono leading-none tracking-tighter truncate flex items-center justify-center shadow-md",
                f.difficulty <= 2 ? "bg-[#00753b] text-white border border-emerald-400/40" :
                f.difficulty === 3 ? "bg-[#374151] text-white border border-slate-500/40" :
                f.difficulty === 4 ? "bg-[#e11d48] text-white border border-rose-400/40" :
                "bg-[#881337] text-white border border-pink-400/40"
              )}
            >
              {f.opponent}{f.is_home ? '(H)' : '(A)'}
            </span>
          ))}
        </div>
      )}

      {/* 4. Engine Math Hover Tooltip */}
      <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity z-50 bg-slate-950/95 backdrop-blur-md border border-slate-700 text-slate-300 text-[9px] p-2.5 rounded-lg shadow-2xl w-40 bottom-full mb-2 left-1/2 -translate-x-1/2 pointer-events-none">
        <div className="font-bold border-b border-slate-800 pb-1 mb-1.5 text-white flex justify-between items-center">
          <span>{player.web_name}</span>
          <span className="text-[8px] font-mono text-slate-400">{teamShort} • {player.position}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span className="text-slate-400">Model xP:</span>
          <span className="text-fpl-green font-mono font-bold">{player.xP?.toFixed(2)}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span className="text-slate-400">Price:</span>
          <span className="font-mono text-slate-200">£{(player.now_cost/10).toFixed(1)}M</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span className="text-slate-400">Est. EO:</span>
          <span className="font-mono text-cyan-400">{player.eo ? `${player.eo.toFixed(1)}%` : 'Differential'}</span>
        </div>
        <div className="flex justify-between font-bold border-t border-slate-800 pt-1 mt-1">
          <span className="text-slate-400">ROI:</span>
          <span className="text-amber-400 font-mono">{((player.xP || 0) / (player.now_cost / 10)).toFixed(2)} xP/£M</span>
        </div>
      </div>

    </div>
  );
};
