import { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Users, 
  ArrowRightCircle, 
  UserMinus, 
  UserPlus, 
  Sparkles, 
  ShieldCheck
} from 'lucide-react';
import { TeamSyncResponse } from '../types';
import { cn } from '../lib/utils';

import { StripeCheckout } from './StripeCheckout';

interface TransferViewProps {
  syncedData: TeamSyncResponse | null;
  tier: string;
  setTab: (tab: any) => void;
  userId: string;
}

export const TransferView = ({ syncedData, tier, setTab, userId }: TransferViewProps) => {
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

  const { squad, transfers } = syncedData;

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

  return (
    <motion.div
      key="transfer-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col h-full space-y-4"
    >
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

            {tier === 'free' ? (
              <div className="text-center py-10 bg-slate-950/40 border border-fpl-border rounded-2xl flex flex-col items-center justify-center space-y-4">
                <div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-fpl-border">
                  <ShieldCheck className="w-5 h-5 text-fpl-green opacity-50" />
                </div>
                <div>
                  <h3 className="text-slate-200 font-bold mb-1">Strategist Tier Required</h3>
                  <p className="text-slate-500 text-xs max-w-xs leading-relaxed">
                    Unlock the LP Solver to instantly calculate the mathematically optimal transfer for your exact squad and budget.
                  </p>
                </div>
                <StripeCheckout 
            userId={userId} 
            tier="strategist" 
            buttonText="Upgrade to Strategist"
            className="bg-fpl-green text-slate-950 hover:bg-fpl-green/90 text-[10px] font-black px-4 py-2 rounded-lg transition-colors uppercase tracking-widest mt-2"
          />
              </div>
            ) : transfers.length === 0 ? (
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
                              <span className="text-sm sm:text-lg font-black text-fpl-green flex items-center gap-0.5">
                                +{rec.xPDelta.toFixed(1)}
                              </span>
                              <span className="text-[8px] text-slate-500 font-bold uppercase">xP Gain</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Additional swap info: Price saving details */}
                      <div className="mt-3 pt-2 border-t border-fpl-border/40 flex justify-between items-center text-[9px] text-slate-400">
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
