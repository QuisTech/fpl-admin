import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, AlertTriangle, Code2, HelpCircle, ChevronDown, ChevronUp, Sparkles, Lock, Ban, Crown } from 'lucide-react';
import { RecommendationResponse } from '../types';
import { PlayerPhoto } from './PlayerPhoto';

interface EngineDiagnosticsProps {
  data: RecommendationResponse | null;
  onSyncTeamId?: (teamId: string) => void;
}

const formatCost = (cost: number) => (cost > 30 ? (cost / 10).toFixed(1) : cost.toFixed(1));

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
  const [cohortTab, setCohortTab] = useState<'all' | 'zero' | 'normalized'>('all');

  if (!data?.engineDiagnostics) return null;

  const { budgetUsed, budgetLimit, solverStatus, riskMode, activeConstraints, metrics } = data.engineDiagnostics;
  const isOptimal = solverStatus === 'optimal';
  const swapAnalysis = metrics?.swapAnalysis;
  const omissionAnalysis = metrics?.omissionAnalysis || [];

  const topInsight = data.topManagerInsight;
  const eligibleManagers = topInsight?.eligibleManagers || topInsight?.noChipLeaderCount || 1;

  const captainSorted = topInsight?.consensusDetails
    ? [...topInsight.consensusDetails]
        .filter(d => (d.captainRate || 0) > 0 || (d.captainCount || 0) > 0)
        .sort((a, b) => b.captainCount - a.captainCount || b.captainRate - a.captainRate)
    : [];

  const consensusCaptain = topInsight?.consensusCaptain || (captainSorted[0] ? {
    id: captainSorted[0].id,
    web_name: captainSorted[0].web_name,
    full_name: captainSorted[0].full_name || captainSorted[0].web_name,
    code: captainSorted[0].code,
    team_code: captainSorted[0].team_code,
    team_name: captainSorted[0].team_name,
    team_short_name: captainSorted[0].team_short_name,
    position: captainSorted[0].position,
    cost: captainSorted[0].cost,
    captainRate: captainSorted[0].captainRate,
    captainPercentage: Math.round(captainSorted[0].captainRate * 100),
    captainCount: captainSorted[0].captainCount,
    eligibleManagers,
  } : undefined);

  const consensusViceCaptain = topInsight?.consensusViceCaptain || (captainSorted[1] ? {
    id: captainSorted[1].id,
    web_name: captainSorted[1].web_name,
    full_name: captainSorted[1].full_name || captainSorted[1].web_name,
    code: captainSorted[1].code,
    team_code: captainSorted[1].team_code,
    team_name: captainSorted[1].team_name,
    team_short_name: captainSorted[1].team_short_name,
    position: captainSorted[1].position,
    cost: captainSorted[1].cost,
    captainRate: captainSorted[1].captainRate,
    captainPercentage: Math.round(captainSorted[1].captainRate * 100),
    captainCount: captainSorted[1].captainCount,
    eligibleManagers,
  } : undefined);

  const captaincyDistribution = topInsight?.captaincyDistribution || captainSorted.slice(0, 5).map(d => ({
    id: d.id,
    web_name: d.web_name,
    full_name: d.full_name || d.web_name,
    code: d.code,
    team_code: d.team_code,
    team_name: d.team_name,
    team_short_name: d.team_short_name,
    position: d.position,
    cost: d.cost,
    captainRate: d.captainRate,
    captainPercentage: Math.round(d.captainRate * 100),
    captainCount: d.captainCount,
  }));

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
                Top Manager Intelligence
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
            {/* Filter Tabs Header */}
            <div className="flex items-center justify-between gap-1 text-[10px] border-b border-slate-800/60 pb-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCohortTab('all')}
                  className={`px-2 py-0.5 rounded text-[8.5px] font-bold uppercase transition-all ${
                    cohortTab === 'all'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 bg-slate-950/60 border border-slate-800'
                  }`}
                >
                  All ({data.topManagerInsight.sampleLeaders.length})
                </button>
                <button
                  onClick={() => setCohortTab('zero')}
                  className={`px-2 py-0.5 rounded text-[8.5px] font-bold uppercase transition-all ${
                    cohortTab === 'zero'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200 bg-slate-950/60 border border-slate-800'
                  }`}
                >
                  Pure 0-Chips ({data.topManagerInsight.sampleLeaders.filter(m => (!m.chips_used || m.chips_used.length === 0) && !m.chip_deduction).length})
                </button>
                <button
                  onClick={() => setCohortTab('normalized')}
                  className={`px-2 py-0.5 rounded text-[8.5px] font-bold uppercase transition-all ${
                    cohortTab === 'normalized'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                      : 'text-slate-400 hover:text-slate-200 bg-slate-950/60 border border-slate-800'
                  }`}
                >
                  Normalized ({data.topManagerInsight.sampleLeaders.filter(m => m.chip_deduction && m.chip_deduction > 0).length})
                </button>
              </div>

              {data.topManagerInsight.sampleLeaders.length > 2 && (
                <span className="text-[8px] text-slate-500 font-mono hidden sm:block">Scroll for more ▾</span>
              )}
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1 text-[11px] border border-slate-800/40 rounded-xl p-1 bg-slate-950/40">
              {data.topManagerInsight.sampleLeaders
                .filter(m => {
                  const isNorm = Boolean(m.chip_deduction && m.chip_deduction > 0);
                  if (cohortTab === 'zero') return !isNorm && (!m.chips_used || m.chips_used.length === 0);
                  if (cohortTab === 'normalized') return isNorm;
                  return true;
                })
                .map(m => {
                  const isNorm = Boolean(m.chip_deduction && m.chip_deduction > 0);
                  const normPts = m.normalized_total_points || (m.total_points - (m.chip_deduction || 0));

                  return (
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
                          <div className="min-w-0">
                            <span className="text-[11px] font-bold text-slate-100 block truncate" title={`${m.manager_name}${m.team_name ? ` (${m.team_name})` : ''}`}>
                              {m.manager_name}
                            </span>
                            {m.team_name && (
                              <span className="text-[9px] text-slate-400 block truncate font-normal">
                                {m.team_name}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10.5px]">
                          {isNorm && (
                            <span className="text-slate-400 line-through text-[9.5px]" title="Raw Points before TC/BB deduction">
                              {m.total_points}
                            </span>
                          )}
                          <span className="text-fpl-green font-black bg-fpl-green/10 border border-fpl-green/20 px-2 py-0.5 rounded">
                            {normPts} pts
                          </span>
                        </div>
                      </div>

                      {/* Bottom row: Chip status & Actions */}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-900/90 text-[9px]">
                        <span className={`font-mono text-[8.5px] px-1.5 py-0.5 rounded border ${
                          isNorm
                            ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        }`}>
                          {isNorm ? `Normalized (-${m.chip_deduction} pts)` : 'Pure 0-Chips'}
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
                  );
                })}
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

                {/* 👑 Consensus Captaincy Intelligence Hub */}
                {consensusCaptain && (
                  <div className="p-3 rounded-2xl bg-gradient-to-r from-amber-500/10 via-purple-500/10 to-slate-900/90 border border-amber-500/30 shadow-lg space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-amber-300">
                        <Crown className="w-4 h-4 text-amber-400" />
                        <span>Elite Consensus Captaincy Hub</span>
                      </div>
                      <span className="text-[8.5px] font-mono font-bold bg-amber-400/15 text-amber-300 border border-amber-400/30 px-2 py-0.5 rounded-full">
                        {consensusCaptain.captainPercentage}% Herd Armband
                      </span>
                    </div>

                    {/* Spotlight Cards: Consensus Captain & Vice-Captain */}
                    <div className="grid grid-cols-1 gap-2 text-xs">
                      {/* #1 Consensus Captain */}
                      <div className="p-2.5 rounded-xl bg-slate-950/80 border border-amber-400/40 shadow-sm space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[10px] font-black text-amber-400 bg-amber-400/10 border border-amber-400/30 px-1.5 py-0.5 rounded uppercase whitespace-nowrap">
                              #1 CAPTAIN
                            </span>
                            <span className={`text-[8px] font-mono font-black px-1.5 py-0.5 rounded ${getPositionBadge(consensusCaptain.position)}`}>
                              {consensusCaptain.position}
                            </span>
                            {(consensusCaptain.team_short_name || consensusCaptain.team_code) && (
                              <span className="text-[8px] font-black text-slate-300 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded uppercase font-mono">
                                {consensusCaptain.team_short_name || consensusCaptain.team_code}
                              </span>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-base font-black font-mono text-amber-300">
                              {consensusCaptain.captainPercentage}%
                            </span>
                            <span className="text-[8px] text-slate-400 font-bold uppercase ml-1">Vote</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 min-w-0">
                          <PlayerPhoto
                            playerId={consensusCaptain.id}
                            playerCode={consensusCaptain.code}
                            teamCode={consensusCaptain.team_code}
                            teamShortName={consensusCaptain.team_short_name}
                            playerName={consensusCaptain.full_name || consensusCaptain.web_name}
                            position={consensusCaptain.position}
                            sizeClassName="w-10 h-10"
                            roundedClassName="rounded-xl"
                            showSpotlight={true}
                            className="border border-amber-400/40 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="font-extrabold text-white text-[13.5px] truncate drop-shadow-sm leading-tight">
                              {consensusCaptain.full_name || consensusCaptain.web_name}
                            </div>
                            <div className="text-[9px] text-slate-400 font-mono mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
                              <span className="text-slate-200 font-bold">
                                £{formatCost(consensusCaptain.cost)}M
                              </span>
                              <span>•</span>
                              <span>{consensusCaptain.captainCount} of {eligibleManagers} managers</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* #2 Consensus Vice-Captain */}
                      {consensusViceCaptain && (
                        <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 shadow-sm space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10px] font-black text-cyan-400 bg-cyan-400/10 border border-cyan-400/30 px-1.5 py-0.5 rounded uppercase whitespace-nowrap">
                                #2 RUNNER-UP
                              </span>
                              <span className={`text-[8px] font-mono font-black px-1.5 py-0.5 rounded ${getPositionBadge(consensusViceCaptain.position)}`}>
                                {consensusViceCaptain.position}
                              </span>
                              {(consensusViceCaptain.team_short_name || consensusViceCaptain.team_code) && (
                                <span className="text-[8px] font-black text-slate-300 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded uppercase font-mono">
                                  {consensusViceCaptain.team_short_name || consensusViceCaptain.team_code}
                                </span>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-base font-black font-mono text-cyan-300">
                                {consensusViceCaptain.captainPercentage}%
                              </span>
                              <span className="text-[8px] text-slate-400 font-bold uppercase ml-1">Vote</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 min-w-0">
                            <PlayerPhoto
                              playerId={consensusViceCaptain.id}
                              playerCode={consensusViceCaptain.code}
                              teamCode={consensusViceCaptain.team_code}
                              teamShortName={consensusViceCaptain.team_short_name}
                              playerName={consensusViceCaptain.full_name || consensusViceCaptain.web_name}
                              position={consensusViceCaptain.position}
                              sizeClassName="w-10 h-10"
                              roundedClassName="rounded-xl"
                              className="border border-slate-700 shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="font-extrabold text-white text-[13.5px] truncate drop-shadow-sm leading-tight">
                                {consensusViceCaptain.full_name || consensusViceCaptain.web_name}
                              </div>
                              <div className="text-[9px] text-slate-400 font-mono mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
                                <span className="text-slate-200 font-bold">
                                  £{formatCost(consensusViceCaptain.cost)}M
                                </span>
                                <span>•</span>
                                <span>{consensusViceCaptain.captainCount} of {eligibleManagers} managers</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Captaincy Vote Share Distribution Bars */}
                    {captaincyDistribution.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                          <span>Top 5 Captaincy Vote Share</span>
                          <span>Sum: {captaincyDistribution.reduce((acc, c) => acc + c.captainPercentage, 0)}%</span>
                        </div>
                        <div className="space-y-1.5">
                          {captaincyDistribution.map(c => (
                            <div key={c.id} className="flex items-center justify-between gap-2 text-[10px] bg-slate-950/40 p-1.5 rounded-lg border border-slate-800">
                              <div className="flex items-center gap-2 min-w-0">
                                <PlayerPhoto
                                  playerId={c.id}
                                  playerCode={c.code}
                                  teamCode={c.team_code}
                                  teamShortName={c.team_short_name}
                                  playerName={c.full_name || c.web_name}
                                  position={c.position}
                                  sizeClassName="w-5 h-5"
                                  roundedClassName="rounded shrink-0"
                                />
                                <span className="font-extrabold text-slate-200 text-[11px] whitespace-nowrap truncate">
                                  {c.full_name || c.web_name}
                                </span>
                                {(c.team_short_name || c.team_code) && (
                                  <span className="text-[8px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-1 py-0.2 rounded uppercase shrink-0">
                                    {c.team_short_name || c.team_code}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="w-16 h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800 shrink-0">
                                  <div
                                    className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full"
                                    style={{ width: `${Math.min(100, c.captainPercentage * 2.5)}%` }}
                                  />
                                </div>
                                <span className="w-8 text-right font-mono font-black text-amber-300 shrink-0 whitespace-nowrap">{c.captainPercentage}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

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
                  const enablers = data.topManagerInsight.consensusDetails
                    .filter(d => d.isBenchEnabler)
                    .sort((a, b) => b.benchRate - a.benchRate || a.cost - b.cost || b.squadCount - a.squadCount);
                  if (enablers.length === 0) return null;
                  return (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="flex items-center gap-1 font-black uppercase text-cyan-400 tracking-wider">
                          <span>🪑</span>
                          <span>Bench Enablers ({enablers.length})</span>
                        </span>
                        <span className="text-[8px] text-slate-400 font-mono">Ranked by Bench % & Value</span>
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
                                p.benchRate >= 0.20
                                  ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
                                  : p.benchRate >= 0.10 
                                  ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25' 
                                  : 'text-slate-300 bg-slate-800/80 border-slate-700/60'
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
