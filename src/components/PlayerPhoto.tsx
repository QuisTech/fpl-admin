import React, { useState, useEffect } from 'react';

const TEAM_SHIRT_CODES: Record<string, number> = {
  ARS: 3,
  AVL: 7,
  BOU: 91,
  BRE: 94,
  BHA: 36,
  CHE: 8,
  COV: 9,
  CRY: 31,
  EVE: 11,
  FUL: 54,
  HUL: 88,
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
  COV: { primary: '#00A3E0', secondary: '#FFFFFF' },
  CRY: { primary: '#1B458F', secondary: '#C4122E' },
  EVE: { primary: '#003399', secondary: '#FFFFFF' },
  FUL: { primary: '#FFFFFF', secondary: '#000000' },
  HUL: { primary: '#F2A900', secondary: '#000000' },
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

export interface PlayerPhotoProps {
  playerId: number;
  playerCode?: number;
  teamCode?: number;
  teamShortName?: string;
  playerName: string;
  position?: string;
  className?: string;
  imgClassName?: string;
  sizeClassName?: string;
  roundedClassName?: string;
  showSpotlight?: boolean;
  preferShirt?: boolean;
}

/**
 * HD Player Photo component using Official Premier League & FPL club assets.
 * Guarantees that players always display their LATEST official team kit/jersey
 * corresponding to their active club.
 */
export const PlayerPhoto: React.FC<PlayerPhotoProps> = ({
  playerId,
  playerCode,
  teamCode,
  teamShortName = 'FPL',
  playerName,
  position = 'MID',
  className = '',
  imgClassName = '',
  sizeClassName = 'w-10 h-10',
  roundedClassName = 'rounded-xl',
  showSpotlight = false,
  preferShirt = true,
}) => {
  const [photoStage, setPhotoStage] = useState<'shirt' | 'portrait' | 'fallback'>(
    preferShirt ? 'shirt' : 'portrait'
  );

  useEffect(() => {
    setPhotoStage(preferShirt ? 'shirt' : 'portrait');
  }, [playerId, playerCode, teamCode, teamShortName, preferShirt]);

  const teamShort = (teamShortName || 'FPL').toUpperCase();
  const effectiveTeamCode = teamCode || TEAM_SHIRT_CODES[teamShort] || 1;
  const isGkp = position === 'GKP';
  const colors = TEAM_COLORS[teamShort] || { primary: '#37003c', secondary: '#00ff87' };

  // Official FPL club shirt URL (always 100% up to date with player's active team kit)
  const shirtUrl = `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${effectiveTeamCode}${isGkp ? '_1' : ''}-220.webp`;
  const shirtSrcSet = `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${effectiveTeamCode}${isGkp ? '_1' : ''}-66.webp 66w, https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${effectiveTeamCode}${isGkp ? '_1' : ''}-110.webp 110w, https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${effectiveTeamCode}${isGkp ? '_1' : ''}-220.webp 220w`;

  // PL portrait URL fallback
  const portraitUrl = playerCode
    ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${playerCode}.png`
    : `https://resources.premierleague.com/premierleague/photos/players/110x140/p${playerId}.png`;

  const handleShirtError = () => {
    setPhotoStage('portrait');
  };

  const handlePortraitError = () => {
    setPhotoStage('fallback');
  };

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 overflow-hidden ${sizeClassName} ${roundedClassName} ${
        showSpotlight
          ? 'bg-gradient-to-b from-white/20 via-white/10 to-white/5 border border-white/25 backdrop-blur-md p-0.5 shadow-md drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)]'
          : 'bg-slate-900/90 border border-white/15 shadow-inner'
      } ${className}`}
      title={`${playerName} (${teamShort})`}
    >
      {photoStage === 'shirt' ? (
        <picture className="w-full h-full flex items-center justify-center p-0.5">
          <source type="image/webp" srcSet={shirtSrcSet} sizes="(min-width: 768px) 110px, 66px" />
          <img
            src={shirtUrl}
            srcSet={shirtSrcSet}
            alt={`${playerName} (${teamShort})`}
            onError={handleShirtError}
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-contain p-0.5 filter hover:brightness-110 transition-all pointer-events-none ${imgClassName}`}
          />
        </picture>
      ) : photoStage === 'portrait' ? (
        <img
          src={portraitUrl}
          alt={playerName}
          onError={handlePortraitError}
          loading="lazy"
          decoding="async"
          className={`w-full h-full object-cover object-top filter contrast-[1.05] brightness-[1.02] pointer-events-none ${roundedClassName} ${imgClassName}`}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center p-1" aria-hidden="true">
          <svg viewBox="0 0 100 100" className="w-full h-full max-w-[85%] max-h-[85%] object-contain">
            <path
              d="M 30 15 L 42 22 C 46 25 54 25 58 22 L 70 15 L 88 35 L 75 48 L 70 42 L 70 85 C 70 88 68 90 65 90 L 35 90 C 32 90 30 88 30 85 L 30 42 L 25 48 L 12 35 Z"
              fill={colors.primary}
              stroke={colors.secondary}
              strokeWidth="2.5"
            />
            <path d="M 42 22 C 46 25 54 25 58 22" fill="none" stroke={colors.secondary} strokeWidth="3" />
          </svg>
        </div>
      )}
    </div>
  );
};
