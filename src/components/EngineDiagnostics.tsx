import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, AlertTriangle, Code2, HelpCircle, ChevronDown, ChevronUp, Sparkles, Lock, Ban } from 'lucide-react';
import { RecommendationResponse } from '../types';

interface EngineDiagnosticsProps {
  data: RecommendationResponse | null;
  onSyncTeamId?: (teamId: string) => void;
}

const getPositionBadge = (pos: string) => {
  switch (pos) {
    case 'GKP':
      return 'text-purple-300 bg-purple-500/15 border-purple-500/30';
    case 'DEF':
      return 'text-sky-300 bg-sky-500/15 border-sky-500/30';
    case 'MID':
      return 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30';
    case 'FWD':
      return 'text-amber-300 bg-amber-500/15 border-amber-500/30';
    default:
      return 'text-slate-300 bg-slate-500/15 border-slate-500/30';
  }
};

export const EngineDiagnostics = ({ data, onSyncTeamId }: EngineDiagnosticsProps) => {
  const [expandedOmission, setExpandedOmission] = useState<number | null>(null);

  if (!data?.engineDiagnostics) return null;

  const { budgetUsed, budgetLimit, solverStatus, riskMode, activeConstraints, metrics } = data.engineDiagnostics;
  const isOptimal = solverStatus === 'optimal';
  const swapAnalysis = metrics?.swapAnalysis;
  const omissionAnalysis = metrics?.omissionAnalysis || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-950/80 border border-fpl-border rounded-2xl p-4 mt-6 shadow-sm overflow-hidden relative"
    >
      {/* Decorative background grid */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'linear-gradient(#00ff87 1px, transparent 1px), linear-gradient(90deg, #00ff87 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
      
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-slate-400" />
          <h3 className="text-xs font-black text-slate-300 uppercase tracking-widest">Engine Diagnostics</h3>
        </div>
        <div className="flex items-center gap-2">
          {activeConstraints?.lockedCount ? (
            <span className="flex items-center gap-1 bg-amber-400/10 text-amber-400 border border-amber-400/20 px-2 py-0.5 rounded text-[8px] font-black uppercase">
              <Lock className="w-2.5 h-2.5" /> {activeConstraints.lockedCount} Locked
            </span>
          ) : null}
          {activeConstraints?.excludedCount ? (
            <span className="flex items-center gap-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded text-[8px] font-black uppercase">
              <Ban className="w-2.5 h-2.5" /> {activeConstraints.excludedCount} Banned
            </span>
          ) : null}
          <div className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider flex items-center gap-1 ${isOptimal ? 'bg-fpl-green/10 text-fpl-green border border-fpl-green/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
            {isOptimal ? <ShieldCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {isOptimal ? 'LP Solver Optimal' : 'Heuristic Fallback'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 relative z-10 mb-3">
        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-800">
          <p className="text-[9px] text-slate-500 uppercase font-bold mb-1 truncate">Constraint: Budget</p>
          <div className="flex items-end gap-1">
            <p className="text-xs font-mono font-black text-white">£{(budgetUsed / 10).toFixed(1)}M</p>
            <p className="text-[9px] text-slate-500 font-mono hidden sm:block">/ £{(budgetLimit / 10).toFixed(1)}M</p>
          </div>
        </div>

        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-800">
          <p className="text-[9px] text-slate-500 uppercase font-bold mb-1 truncate">Objective Math</p>
          <p className="text-[11px] font-black text-white capitalize truncate">
            {riskMode === 'value' ? 'Max ROI (Pts/£M)' : 'Max Total xP + Cap 2×'}
          </p>
        </div>

        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-800">
          <p className="text-[9px] text-slate-500 uppercase font-bold mb-1 truncate">8-GW XI Projected xP</p>
          <p className="text-[11px] font-black font-mono text-emerald-400 truncate">
            {metrics?.horizonTotalXp ? `${metrics.horizonTotalXp} pts` : 'N/A'}
          </p>
        </div>

        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-800">
          <p className="text-[9px] text-slate-500 uppercase font-bold mb-1 truncate">Average XI EO</p>
          <p className="text-[11px] font-black font-mono text-cyan-400 truncate">
            {metrics?.averageXiEo !== undefined ? `${metrics.averageXiEo}%` : 'N/A'}
          </p>
        </div>
      </div>

      {/* Pillar 3: "Why Omitted?" Diagnostic Section */}
      {omissionAnalysis.length > 0 && (
        <div className="relative z-10 mt-3 pt-3 border-t border-slate-800/80">
          <div className="flex items-center gap-1.5 mb-2 text-amber-400">
            <HelpCircle className="w-3.5 h-3.5" />
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">Why were these template stars omitted?</span>
          </div>

          <div className="space-y-2">
            {omissionAnalysis.map((item, idx) => {
              const isExp = expandedOmission === idx;
              return (
                <div key={item.omittedPlayer.id} className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 transition-colors hover:border-slate-700">
                  <div 
                    onClick={() => setExpandedOmission(isExp ? null : idx)}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-200">{item.omittedPlayer.name}</span>
                      <span className="text-[9px] font-mono text-slate-500 uppercase">£{item.omittedPlayer.cost.toFixed(1)}M • {item.omittedPlayer.eo}% EO</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono font-bold text-fpl-green bg-fpl-green/10 border border-fpl-green/20 px-1.5 py-0.5 rounded">
                        +{item.netXpGain > 0 ? item.netXpGain : 0.8} net xP
                      </span>
                      {isExp ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                    </div>
                  </div>

                  <AnimatePresence>
                    {isExp && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2 pt-2 border-t border-slate-800/60 text-[10px] text-slate-400 space-y-1.5"
                      >
                        <p className="leading-relaxed text-slate-300">{item.explanation}</p>
                        <div className="flex flex-wrap items-center gap-1 pt-1">
                          <span className="text-[8px] font-black uppercase text-slate-500">Funded Starters:</span>
                          {item.replacementPlayers.map(rp => (
                            <span key={rp.id} className="bg-slate-800/80 px-1.5 py-0.5 rounded text-[8px] font-mono text-slate-300 border border-slate-700">
                              {rp.name} (£{rp.cost.toFixed(1)}M, {rp.xP.toFixed(1)} xP)
                            </span>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {swapAnalysis && (
        <div className="relative z-10 mt-3 pt-3 border-t border-slate-800/80">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{riskMode.toUpperCase()} vs SAFE Divergence</span>
            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${swapAnalysis.differentialQuality === 'PASS' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'}`}>
              Quality: {swapAnalysis.differentialQuality} ({swapAnalysis.withinThresholdPct}% ≤0.35 xP/GW)
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="text-[8px] text-slate-500 font-bold uppercase">Swaps</div>
                <div className="text-xs font-mono font-black text-white">{swapAnalysis.swapCount}</div>
              </div>
              <div className={`text-[8px] leading-tight font-bold uppercase tracking-tight whitespace-normal mt-0.5 ${
                swapAnalysis.divergenceTier === 'HEALTHY_DIFFERENTIAL' ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {swapAnalysis.divergenceTier === 'HEALTHY_DIFFERENTIAL' ? 'HEALTHY DIFFERENTIAL' : swapAnalysis.divergenceTier.replace(/_/g, ' ')}
              </div>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <div className="text-[8px] text-slate-500 font-bold uppercase">Avg Cost / GW</div>
              <div className="text-xs font-mono font-black text-amber-400">-{swapAnalysis.avgSwapCostPerGw} xP</div>
              <div className="text-[8px] text-slate-500 truncate">Total: -{swapAnalysis.totalXpSacrificed8GW} pts</div>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <div className="text-[8px] text-slate-500 font-bold uppercase">EO Drop</div>
              <div className="text-xs font-mono font-black text-cyan-400">-{swapAnalysis.avgEoReduction}%</div>
              <div className="text-[8px] text-slate-500 truncate">per swap</div>
            </div>
          </div>
        </div>
      )}

      {/* Top Manager Intelligence HUD */}
      {data.topManagerInsight && (
        <div className="relative z-10 mt-3 pt-3 border-t border-slate-800/80">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 text-cyan-400 min-w-0">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-200 truncate">
                Top Manager Intelligence (0 Chips)
              </span>
            </div>
            <span className="text-[8.5px] font-mono font-bold text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 px-2 py-0.5 rounded shrink-0 whitespace-nowrap shadow-sm">
              Edge: {(() => {
                const r = data.topManagerInsight.marketDisagreementRating;
                if (r > 100) return Math.round(r / 100);
                if (r > 1.0) return Math.round(r);
                return Math.round(r * 100);
              })()}%
            </span>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 space-y-2">
            <div className="flex justify-between items-center text-[10px] px-0.5">
              <span className="text-slate-400 font-medium">0-Chip Top 1k Leaders:</span>
              <span className="font-bold text-emerald-400 font-mono bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded text-[9px]">
                {data.topManagerInsight.noChipLeaderCount} Managers
              </span>
            </div>

            <div className="space-y-2">
              {data.topManagerInsight.sampleLeaders.map(m => (
                <div 
                  key={m.entry} 
                  className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 hover:border-slate-700/80 transition-all space-y-2"
                >
                  {/* Top row: Manager info + Points */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[9.5px] font-black font-mono text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded shrink-0">
                        #{m.rank}
                      </span>
                      <span className="text-[11px] font-bold text-slate-100 truncate" title={m.manager_name}>
                        {m.manager_name}
                      </span>
                    </div>
                    <span className="font-mono text-fpl-green font-black text-[11px] shrink-0 bg-fpl-green/10 border border-fpl-green/20 px-2 py-0.5 rounded">
                      {m.total_points} pts
                    </span>
                  </div>

                  {/* Bottom row: Team ID & Actions */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-900/90 text-[9px]">
                    <span className="text-slate-500 font-mono text-[8.5px]">
                      0 Chips Active
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {onSyncTeamId && (
                        <button
                          onClick={() => onSyncTeamId(m.entry.toString())}
                          className="text-[8.5px] font-black uppercase tracking-wider text-slate-950 bg-fpl-green hover:bg-fpl-green/90 px-2 py-0.5 rounded-md transition-all shadow-[0_0_8px_rgba(0,255,133,0.25)] flex items-center gap-1 cursor-pointer active:scale-95"
                          title={`Sync Team ID ${m.entry} directly into Horizon and analyze squad`}
                        >
                          ⚡ Sync Squad
                        </button>
                      )}
                      <a 
                        href={`https://fantasy.premierleague.com/entry/${m.entry}/history`} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-[8.5px] font-mono text-cyan-300 bg-slate-900 border border-slate-700/80 hover:border-cyan-500/40 px-2 py-0.5 rounded-md hover:bg-slate-800 transition-all flex items-center gap-1"
                        title="Open Manager Account on Official FPL Website"
                      >
                        ID: {m.entry} ↗
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Split Elite Consensus: Starting Weapons & Bench Enablers */}
            {data.topManagerInsight.consensusDetails && data.topManagerInsight.consensusDetails.length > 0 ? (
              <div className="pt-2.5 space-y-3 border-t border-slate-800/80">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-200">
                    Elite Consensus
                  </span>
                  <span 
                    className="text-[8.5px] font-mono font-bold text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 px-2 py-0.5 rounded cursor-help"
                    title={`Calculated across ${data.topManagerInsight.eligibleManagers || data.topManagerInsight.noChipLeaderCount} active 0-chip elite managers`}
                  >
                    Elite cohort: {data.topManagerInsight.eligibleManagers || data.topManagerInsight.noChipLeaderCount} managers
                  </span>
                </div>

                {/* Starting Weapons */}
                {(() => {
                  const weapons = data.topManagerInsight.consensusDetails.filter(d => d.isStartingWeapon);
                  if (weapons.length === 0) return null;
                  return (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="flex items-center gap-1 font-black uppercase text-amber-400 tracking-wider">
                          <span>🔥</span>
                          <span>Starting Weapons ({weapons.length})</span>
                        </span>
                        <span className="text-[8px] text-slate-500 font-mono">Ranked by Conviction</span>
                      </div>
                      <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                        {weapons.map(p => (
                          <div 
                            key={p.id} 
                            className="flex items-center justify-between px-2.5 py-1.5 bg-slate-950/80 hover:bg-slate-900 rounded-xl border border-slate-800/80 hover:border-amber-500/30 transition-all text-[10px]"
                            title={`${p.web_name}: ${p.startCount}/${p.eligibleManagers} starts (${Math.round(p.startRate * 100)}%), ${p.captainCount}/${p.eligibleManagers} captains (${Math.round(p.captainRate * 100)}%), Conviction: ${p.convictionScore}`}
                          >
                            <div className="flex items-center gap-2 min-w-0 pr-2">
                              <span className={`text-[8px] font-mono font-black px-1.5 py-0.5 rounded border shrink-0 ${getPositionBadge(p.position)}`}>
                                {p.position}
                              </span>
                              <span className="text-slate-200 font-bold truncate">{p.web_name}</span>
                            </div>
                            <div className="flex items-center gap-1.5 font-mono text-[8.5px] shrink-0 whitespace-nowrap">
                              <span className={`font-bold px-1.5 py-0.5 rounded border ${
                                p.startRate >= 1.0 
                                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' 
                                  : 'text-slate-300 bg-slate-800/80 border-slate-700/60'
                              }`}>
                                {Math.round(p.startRate * 100)}% Start
                              </span>
                              {p.captainRate > 0 && (
                                <span className="text-amber-300 font-bold bg-amber-400/10 border border-amber-400/25 px-1.5 py-0.5 rounded">
                                  {Math.round(p.captainRate * 100)}% Cap
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Bench Enablers */}
                {(() => {
                  const enablers = data.topManagerInsight.consensusDetails.filter(d => d.isBenchEnabler);
                  if (enablers.length === 0) return null;
                  return (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="flex items-center gap-1 font-black uppercase text-cyan-400 tracking-wider">
                          <span>🪑</span>
                          <span>Bench Enablers ({enablers.length})</span>
                        </span>
                        <span className="text-[8px] text-slate-500 font-mono">Budget Facilitators</span>
                      </div>
                      <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                        {enablers.map(p => (
                          <div 
                            key={p.id} 
                            className="flex items-center justify-between px-2.5 py-1.5 bg-slate-950/80 hover:bg-slate-900 rounded-xl border border-slate-800/80 hover:border-cyan-500/30 transition-all text-[10px]"
                            title={`${p.web_name}: £${(p.cost / 10).toFixed(1)}m, ${p.benchCount}/${p.eligibleManagers} benched (${Math.round(p.benchRate * 100)}%), ${p.startCount}/${p.eligibleManagers} starts (${Math.round(p.startRate * 100)}%), Conviction: ${p.convictionScore}`}
                          >
                            <div className="flex items-center gap-2 min-w-0 pr-2">
                              <span className={`text-[8px] font-mono font-black px-1.5 py-0.5 rounded border shrink-0 ${getPositionBadge(p.position)}`}>
                                {p.position}
                              </span>
                              <span className="text-slate-300 font-semibold truncate">{p.web_name}</span>
                              <span className="text-[8.5px] text-slate-400 font-mono bg-slate-900/90 px-1.5 py-0.5 rounded border border-slate-800 shrink-0">
                                £{(p.cost / 10).toFixed(1)}m
                              </span>
                            </div>
                            <div className="flex items-center gap-1 font-mono text-[8.5px] shrink-0 whitespace-nowrap">
                              <span className={`font-bold px-1.5 py-0.5 rounded border ${
                                p.benchRate >= 1.0 
                                  ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25' 
                                  : 'text-slate-400 bg-slate-800/80 border-slate-700/60'
                              }`}>
                                {Math.round(p.benchRate * 100)}% Bench
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="pt-1">
                <span className="text-[8px] font-black uppercase text-slate-500 block mb-1">Elite Consensus Picks:</span>
                <div className="flex flex-wrap gap-1">
                  {data.topManagerInsight.eliteConsensusPicks.map(pick => (
                    <span key={pick} className="bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold">
                      {pick}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
};
