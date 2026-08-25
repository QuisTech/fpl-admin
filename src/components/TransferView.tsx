import { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Users, 
  ArrowRightCircle, 
  UserMinus, 
  UserPlus, 
  Sparkles, 
  ShieldCheck,
  Trophy,
  Zap,
  TrendingUp,
  Globe,
  Coins,
  Layers
} from 'lucide-react';
import { TeamSyncResponse } from '../types';
import { cn } from '../lib/utils';

interface TransferViewProps {
  syncedData: TeamSyncResponse | null;
  tier?: string;
  setTab?: (tab: any) => void;
  userId?: string;
}

export const TransferView = ({ syncedData, tier = 'ai-agent', setTab, userId }: TransferViewProps) => {
  const [activeTab, setActiveTab] = useState<'all' | 'squad' | 'transfers'>('all');
  const [hoveredSwapIndex, setHoveredSwapIndex] = useState<number | null>(null);

  if (!syncedData) {
    return (
      <motion.div
        key="transfer-empty"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex flex-col items-center justify-center h-full py-20 text-center"
      >
        <div className="w-16 h-16 bg-slate-950 rounded-full flex items-center justify-center mb-4 border-2 border-dashed border-slate-800 shadow-inner">
          <Users className="text-slate-700 w-6 h-6" />
        </div>
        <h3 className="text-slate-300 font-bold mb-2">Sync Your Team</h3>
        <p className="text-slate-500 text-xs max-w-xs leading-relaxed">
          Enter your FPL Team ID above to see personalized transfer recommendations and "xP Jump" metrics.
        </p>
      </motion.div>
    );
  }

  const { squad, transfers, entryHistory, managerInfo } = syncedData;

  // Split into Starting XI and Bench using the position_in_squad property
  const startingXI = squad.filter(p => (p.position_in_squad ?? 0) <= 11);
  const bench = squad.filter(p => (p.position_in_squad ?? 0) >= 12);

  // Position ordering for beautiful sorting
  const posOrder: Record<string, number> = { 'GKP': 1, 'DEF': 2, 'MID': 3, 'FWD': 4 };
  const sortedStarting = [...startingXI].sort((a, b) => (posOrder[a.position] || 0) - (posOrder[b.position] || 0));
  const sortedBench = [...bench].sort((a, b) => (posOrder[a.position] || 0) - (posOrder[b.position] || 0));

  // Find all player IDs that are suggested to be transferred out
  const transferOutIds = new Set(transfers.map(t => t.out.id));
  const topTransferOutId = transfers[0]?.out?.id || null;

  // Compute fallback values if entryHistory is not yet available
  const squadValue = entryHistory?.value 
    ? entryHistory.value 
    : syncedData.totalCost 
      ? syncedData.totalCost / 10 
      : 100.0;

  const rawBank = entryHistory?.bank ?? syncedData.bank ?? 0;
  const bankValue = rawBank > 50 ? rawBank / 10 : rawBank;

  const latestPoints = entryHistory?.points ?? managerInfo?.summary_event_points ?? 0;
  const totalPoints = entryHistory?.total_points ?? managerInfo?.summary_overall_points ?? (squad ? squad.reduce((sum, p) => sum + (p.total_points || 0), 0) : 0);
  const overallRank = entryHistory?.overall_rank ?? managerInfo?.summary_overall_rank;

  return (
    <motion.div
      key="transfer-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col h-full space-y-4"
    >
      {/* MANAGER & TEAM PERFORMANCE HUD BANNER (Always rendered when synced) */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 via-slate-950 to-slate-900/90 border border-fpl-border/80 rounded-2xl p-3.5 shadow-lg">
        <div className="absolute top-0 right-0 w-32 h-32 bg-fpl-purple/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-fpl-green/10 rounded-full blur-2xl pointer-events-none" />
        
        {/* Header row: Team & Manager Name */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-fpl-border/40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-fpl-purple/20 border border-fpl-purple/40 flex items-center justify-center text-fpl-purple shadow-inner">
              <Trophy className="w-4 h-4 text-fpl-green" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-black text-white tracking-wide flex items-center gap-1.5">
                {managerInfo?.teamName || 'Synced FPL Squad'}
                {managerInfo?.id && (
                  <span className="text-[9px] font-mono text-slate-400 font-bold bg-slate-950 px-1.5 py-0.5 rounded border border-fpl-border/40">
                    ID: {managerInfo.id}
                  </span>
                )}
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                Manager: <span className="text-slate-300 font-bold">{managerInfo?.managerName || 'Active Manager'}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold text-fpl-green bg-fpl-green/10 border border-fpl-green/30 px-2 py-0.5 rounded-full flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Live FPL Synced
            </span>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Metric 1: Latest GW Points */}
          <div className="bg-slate-950/60 border border-fpl-border/40 rounded-xl p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[9px] font-bold uppercase tracking-wider">Latest GW</span>
              <Zap className="w-3 h-3 text-amber-400" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-black text-white font-mono">
                {latestPoints}
              </span>
              <span className="text-[9px] text-slate-500 font-bold uppercase">pts</span>
            </div>
            {entryHistory?.rank ? (
              <span className="text-[8px] text-slate-500 font-mono truncate mt-0.5">
                GW Rank: #{entryHistory.rank.toLocaleString()}
              </span>
            ) : (
              <span className="text-[8px] text-slate-500 font-mono mt-0.5">Live Round</span>
            )}
          </div>

          {/* Metric 2: Overall Points */}
          <div className="bg-slate-950/60 border border-fpl-border/40 rounded-xl p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[9px] font-bold uppercase tracking-wider">Overall Points</span>
              <TrendingUp className="w-3 h-3 text-fpl-green" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-black text-fpl-green font-mono">
                {totalPoints}
              </span>
              <span className="text-[9px] text-slate-500 font-bold uppercase">pts</span>
            </div>
            <span className="text-[8px] text-slate-500 font-mono mt-0.5">
              Total Season EV
            </span>
          </div>

          {/* Metric 3: Overall Rank */}
          <div className="bg-slate-950/60 border border-fpl-border/40 rounded-xl p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[9px] font-bold uppercase tracking-wider">Overall Rank</span>
              <Globe className="w-3 h-3 text-cyan-400" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-sm sm:text-base font-black text-cyan-300 font-mono truncate">
                {overallRank ? `#${overallRank.toLocaleString()}` : 'Worldwide Table'}
              </span>
            </div>
            <span className="text-[8px] text-slate-500 font-mono mt-0.5">
              Global Standings
            </span>
          </div>

          {/* Metric 4: Squad Value & Bank */}
          <div className="bg-slate-950/60 border border-fpl-border/40 rounded-xl p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[9px] font-bold uppercase tracking-wider">Squad Value</span>
              <Coins className="w-3 h-3 text-purple-400" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-black text-purple-300 font-mono">
                £{squadValue.toFixed(1)}M
              </span>
            </div>
            <span className="text-[8px] text-slate-400 font-mono mt-0.5">
              Bank: <span className="text-fpl-green font-bold">£{bankValue.toFixed(1)}M</span>
            </span>
          </div>
        </div>
      </div>

      {/* Sub-navigation tabs within Transfers tab */}
      <div className="flex justify-between items-center border-b border-fpl-border/50 pb-3">
        <div className="flex space-x-1 bg-slate-950/80 p-0.5 rounded-lg border border-fpl-border/40">
          {(['all', 'transfers', 'squad'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={cn(
                "px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-all",
                activeTab === t 
                  ? "bg-slate-800 text-white shadow-sm" 
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              {t === 'all' ? 'Split View' : t === 'transfers' ? 'Swaps' : 'My Squad'}
            </button>
          ))}
        </div>
        <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-fpl-green animate-pulse" />
          Single Free Transfer Focus
        </div>
      </div>

      <div className="flex-grow overflow-y-auto pr-1 custom-scrollbar max-h-[500px] space-y-6">
        {/* TRANSFER RECOMMENDATIONS PANEL */}
        {(activeTab === 'all' || activeTab === 'transfers') && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">
                Recommended Swaps (Top 5)
              </h4>
              <span className="text-[8px] font-bold text-slate-500 uppercase bg-slate-950 px-2 py-0.5 rounded border border-fpl-border/30">
                1-for-1 Limit
              </span>
            </div>

            {/* 8-GW Squad Horizon Summary Banner */}
            {transfers.length > 0 && transfers[0].squad8GwXpBefore !== undefined && (
              <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-fpl-purple/40 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-md relative overflow-hidden">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-fpl-purple/20 border border-fpl-purple/40 flex items-center justify-center text-fpl-purple shrink-0">
                    <Layers className="w-4 h-4 text-fpl-green animate-pulse" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-white tracking-wider flex items-center gap-1.5">
                      8-Gameweek Squad Horizon Lookahead
                    </span>
                    <span className="text-[9px] text-slate-400 font-medium">
                      Multi-horizon cumulative projected points for your 15-man squad
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800">
                  <div className="text-right">
                    <span className="text-[8px] text-slate-500 font-bold uppercase block">Current Squad (8-GW)</span>
                    <span className="text-xs font-mono font-black text-slate-300">{transfers[0].squad8GwXpBefore} pts</span>
                  </div>
                  <ArrowRightCircle className="w-3.5 h-3.5 text-fpl-purple shrink-0" />
                  <div className="text-right">
                    <span className="text-[8px] text-fpl-green font-bold uppercase block">Optimized Squad (8-GW)</span>
                    <span className="text-xs font-mono font-black text-fpl-green">{transfers[0].squad8GwXpAfter} pts</span>
                  </div>
                  <div className="bg-fpl-green/10 border border-fpl-green/30 px-2 py-1 rounded-lg text-right shrink-0">
                    <span className="text-[8px] text-slate-400 font-bold uppercase block">Net 8-GW Gain</span>
                    <span className="text-xs font-mono font-black text-fpl-green">
                      {((transfers[0].horizon8GwDelta || 0) > 0 ? '+' : '')}{transfers[0].horizon8GwDelta} pts
                    </span>
                  </div>
                </div>
              </div>
            )}

            {transfers.length === 0 ? (
              <div className="text-center py-6 bg-slate-950/20 border border-dashed border-fpl-border rounded-2xl text-slate-500 text-xs">
                No beneficial single transfers found. Your squad is in peak condition!
              </div>
            ) : (
              <div className="space-y-3">
                {transfers.map((rec, i) => {
                  const isStartingXI = (rec.out.position_in_squad ?? 0) <= 11;
                  const priceDiff = (rec.out.now_cost - rec.in.now_cost) / 10;
                  const isHovered = hoveredSwapIndex === i;

                  // Strategic starting check:
                  // If replacing a benched player, check if incoming player out-performs any starting player in the same position
                  const startersInPosition = startingXI.filter(p => p.position === rec.in.position);
                  const lowestStarter = startersInPosition.length > 0 
                    ? [...startersInPosition].sort((a, b) => (a.xP || 0) - (b.xP || 0))[0] 
                    : null;
                  
                  const shouldPromote = !isStartingXI && lowestStarter && (rec.in.xP || 0) > (lowestStarter.xP || 0);

                  let roleText = "Enters Bench";
                  let roleStyle = "bg-slate-800 text-slate-300 border border-slate-700";

                  if (isStartingXI) {
                    roleText = "Enters XI";
                    roleStyle = "bg-fpl-green/10 text-fpl-green border border-fpl-green/20";
                  } else if (shouldPromote && lowestStarter) {
                    roleText = `Starts Over ${lowestStarter.web_name}`;
                    roleStyle = "bg-amber-500/10 text-amber-400 border border-amber-500/20 font-black";
                  }

                  return (
                    <div 
                      key={i} 
                      onMouseEnter={() => setHoveredSwapIndex(i)}
                      onMouseLeave={() => setHoveredSwapIndex(null)}
                      className={cn(
                        "flex flex-col bg-slate-950/40 border rounded-2xl p-4 transition-all duration-300 relative overflow-hidden group",
                        isHovered ? "border-fpl-green/50 bg-slate-950/60 shadow-lg shadow-fpl-green/5" : "border-fpl-border"
                      )}
                    >
                      {/* Premium Top glow / accent line */}
                      <div className={cn(
                        "absolute top-0 left-0 right-0 h-[2px] transition-all",
                        i === 0 ? "bg-gradient-to-r from-fpl-green to-fpl-purple" : "bg-transparent group-hover:bg-slate-800"
                      )} />

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                        {/* Left/Main Side: The Swap */}
                        <div className="flex items-center justify-between flex-grow gap-2">
                          {/* Outgoing Player */}
                          <div className="flex items-center gap-2 max-w-[45%]">
                            <div className="w-7 h-7 rounded-lg bg-rose-950/20 border border-rose-500/30 flex items-center justify-center text-rose-500 shrink-0">
                              <UserMinus className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-[8px] text-rose-500 font-bold uppercase tracking-wider">Out</span>
                              <span className="text-xs font-black text-slate-200 truncate">{rec.out.web_name}</span>
                              <span className="text-[9px] text-slate-500 uppercase truncate">{rec.out.team_short_name} • £{(rec.out.now_cost/10).toFixed(1)}m</span>
                            </div>
                          </div>

                          {/* Arrow Icon */}
                          <div className="flex items-center justify-center shrink-0">
                            <ArrowRightCircle className={cn(
                              "w-4 h-4 transition-all duration-300",
                              isHovered ? "text-fpl-green scale-110" : "text-slate-700"
                            )} />
                          </div>

                          {/* Incoming Player */}
                          <div className="flex items-center justify-end gap-2 max-w-[45%] text-right">
                            <div className="flex flex-col min-w-0">
                              <span className="text-[8px] text-fpl-green font-bold uppercase tracking-wider">In</span>
                              <span className="text-xs font-black text-slate-200 truncate">{rec.in.web_name}</span>
                              <span className="text-[9px] text-slate-500 uppercase truncate">£{(rec.in.now_cost/10).toFixed(1)}m • {rec.in.team_short_name}</span>
                            </div>
                            <div className="w-7 h-7 rounded-lg bg-fpl-green/10 border border-fpl-green/30 flex items-center justify-center text-fpl-green shrink-0">
                              <UserPlus className="w-3.5 h-3.5" />
                            </div>
                          </div>
                        </div>

                        {/* Right/Info Side: Role and xP Gain */}
                        <div className="flex items-center justify-between sm:justify-end gap-4 border-t border-slate-900 pt-2 sm:pt-0 sm:border-0 shrink-0">
                          {/* Role Badge */}
                          <span className={cn(
                            "text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full text-center truncate",
                            roleStyle
                          )}>
                            {roleText}
                          </span>

                          <div className="flex items-center gap-3">
                            <div className="w-px h-8 bg-slate-800/80 hidden sm:block"></div>
                            <div className="flex flex-col items-end sm:items-center justify-center min-w-[60px]">
                              <span className={cn("text-sm sm:text-lg font-black flex items-center gap-0.5", rec.xPDelta > 0 ? "text-fpl-green" : "text-rose-400")}>
                                {rec.xPDelta > 0 ? '+' : ''}{rec.xPDelta.toFixed(1)}
                              </span>
                              <span className="text-[8px] text-slate-500 font-bold uppercase">xP Gain</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Additional swap info: Price saving details & 8-GW Horizon Impact */}
                      <div className="mt-3 pt-2 border-t border-fpl-border/40 flex flex-col gap-1.5 text-[9px] text-slate-400">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">Financial Impact:</span>
                            <span className={cn(
                              "font-bold",
                              priceDiff > 0 ? "text-fpl-green" : priceDiff < 0 ? "text-rose-400" : "text-slate-400"
                            )}>
                              {priceDiff > 0 
                                ? `Saves £${priceDiff.toFixed(1)}m` 
                                : priceDiff < 0 
                                  ? `Costs £${Math.abs(priceDiff).toFixed(1)}m` 
                                  : "Equal Price"}
                            </span>
                          </div>
                          {i === 0 && (
                            <span className="text-fpl-green font-black uppercase tracking-widest text-[8px] flex items-center gap-1">
                              <Sparkles className="w-2.5 h-2.5 animate-spin" /> Top Swap Recommendation
                            </span>
                          )}
                        </div>

                        {/* 8-GW Horizon Lookahead Impact Row */}
                        {rec.horizon8GwDelta !== undefined && (
                          <div className="bg-slate-950/70 border border-fpl-border/30 rounded-lg p-1.5 flex flex-wrap items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1 text-slate-400">
                              <Layers className="w-3 h-3 text-fpl-purple shrink-0" />
                              <span className="font-bold uppercase tracking-wider text-[8px]">8-Gameweek Horizon Impact:</span>
                            </div>
                            <div className="flex items-center gap-2 font-mono">
                              <span className="text-slate-400 text-[8px]">In: <span className="text-slate-200 font-bold">{rec.horizon8GwXpIn} pts</span></span>
                              <span className="text-slate-600 text-[8px]">vs</span>
                              <span className="text-slate-400 text-[8px]">Out: <span className="text-slate-200 font-bold">{rec.horizon8GwXpOut} pts</span></span>
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[8px] font-black uppercase",
                                (rec.horizon8GwDelta || 0) > 0 ? "bg-fpl-green/10 text-fpl-green border border-fpl-green/30" : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                              )}>
                                {(rec.horizon8GwDelta || 0) > 0 ? '+' : ''}{rec.horizon8GwDelta} pts (8-GW Total)
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* SQUAD INTEGRATION VIEW */}
        {(activeTab === 'all' || activeTab === 'squad') && (
          <div className="space-y-4 pt-2">
            <div className="flex justify-between items-center">
              <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">
                My Current FPL Squad Status
              </h4>
              <span className="text-[8px] font-bold text-slate-400 flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded border border-fpl-border/30">
                <ShieldCheck className="w-3 h-3 text-fpl-green" /> Linked via API
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Starting XI List */}
              <div className="bg-slate-950/30 border border-fpl-border/80 rounded-2xl p-4 space-y-3">
                <div className="flex justify-between items-center border-b border-fpl-border/40 pb-2">
                  <span className="text-[10px] font-black text-white uppercase tracking-wider">Starting XI</span>
                  <span className="text-[9px] font-mono text-fpl-green font-bold">11 Players</span>
                </div>
                <div className="space-y-2">
                  {sortedStarting.map((player) => {
                    const isTargetedForSwap = transferOutIds.has(player.id);
                    const isTopTarget = topTransferOutId === player.id;
                    const hoveredSwap = hoveredSwapIndex !== null ? transfers[hoveredSwapIndex] : null;
                    const isCurrentlySwapActive = hoveredSwap?.out.id === player.id;

                    return (
                      <div 
                        key={player.id} 
                        className={cn(
                          "flex justify-between items-center p-2 rounded-xl border transition-all duration-300",
                          isCurrentlySwapActive 
                            ? "bg-rose-950/20 border-rose-500/80 shadow-md shadow-rose-950/30" 
                            : isTopTarget
                              ? "bg-rose-950/10 border-rose-500/40"
                              : isTargetedForSwap 
                                ? "bg-rose-950/5 border-rose-500/20" 
                                : "bg-slate-900/40 border-fpl-border/30 hover:border-slate-800"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-black text-slate-500 w-6 uppercase text-center bg-slate-950 px-1 py-0.5 rounded border border-fpl-border/30">
                            {player.position}
                          </span>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] font-bold text-slate-200">{player.web_name}</span>
                              {player.isCaptain && <span className="text-[8px] font-black bg-fpl-purple px-1 rounded text-white scale-90">C</span>}
                              {player.isViceCaptain && <span className="text-[8px] font-black bg-slate-700 px-1 rounded text-slate-300 scale-90">V</span>}
                            </div>
                            <span className="text-[8px] text-slate-500 uppercase">{player.team_short_name} • £{(player.now_cost/10).toFixed(1)}m</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="text-[10px] font-mono font-black text-slate-400">{(player.xP || 0).toFixed(1)}</span>
                            <span className="text-[7px] text-slate-600 block uppercase font-bold">xP</span>
                          </div>
                          {isTargetedForSwap && (
                            <span className={cn(
                              "text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded",
                              isCurrentlySwapActive || isTopTarget
                                ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                : "bg-rose-500/10 text-rose-500 border border-rose-500/10"
                            )}>
                              Swap Out
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bench List */}
              <div className="bg-slate-950/30 border border-fpl-border/80 rounded-2xl p-4 space-y-3">
                <div className="flex justify-between items-center border-b border-fpl-border/40 pb-2">
                  <span className="text-[10px] font-black text-white uppercase tracking-wider">Substitutes / Bench</span>
                  <span className="text-[9px] font-mono text-slate-400">4 Players</span>
                </div>
                <div className="space-y-2">
                  {sortedBench.map((player) => {
                    const isTargetedForSwap = transferOutIds.has(player.id);
                    const isTopTarget = topTransferOutId === player.id;
                    const hoveredSwap = hoveredSwapIndex !== null ? transfers[hoveredSwapIndex] : null;
                    const isCurrentlySwapActive = hoveredSwap?.out.id === player.id;

                    return (
                      <div 
                        key={player.id} 
                        className={cn(
                          "flex justify-between items-center p-2 rounded-xl border transition-all duration-300",
                          isCurrentlySwapActive 
                            ? "bg-rose-950/20 border-rose-500/80 shadow-md shadow-rose-950/30" 
                            : isTopTarget
                              ? "bg-rose-950/10 border-rose-500/40"
                              : isTargetedForSwap 
                                ? "bg-rose-950/5 border-rose-500/20" 
                                : "bg-slate-900/40 border-fpl-border/30 hover:border-slate-800"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-black text-slate-500 w-6 uppercase text-center bg-slate-950 px-1 py-0.5 rounded border border-fpl-border/30">
                            {player.position}
                          </span>
                          <div className="flex flex-col">
                            <span className="text-[11px] font-bold text-slate-200">{player.web_name}</span>
                            <span className="text-[8px] text-slate-500 uppercase">{player.team_short_name} • £{(player.now_cost/10).toFixed(1)}m</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="text-[10px] font-mono font-black text-slate-400">{(player.xP || 0).toFixed(1)}</span>
                            <span className="text-[7px] text-slate-600 block uppercase font-bold">xP</span>
                          </div>
                          {isTargetedForSwap && (
                            <span className={cn(
                              "text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded",
                              isCurrentlySwapActive || isTopTarget
                                ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                : "bg-rose-500/10 text-rose-500 border border-rose-500/10"
                            )}>
                              Swap Out
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};
