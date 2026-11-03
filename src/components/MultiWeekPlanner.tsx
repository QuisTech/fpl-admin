import React, { useState, useMemo, useEffect } from 'react';
import { 
  Network, 
  ArrowRightLeft, 
  ShieldCheck, 
  Zap, 
  Crown, 
  TrendingUp, 
  ChevronDown, 
  ChevronUp, 
  Sparkles, 
  Coins, 
  Users, 
  Calendar,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Dice5
} from 'lucide-react';
import { RecommendationResponse, TeamSyncResponse, ScoredPlayer, PlannerStepDetail } from '../types';
import { generateClientMultiWeekPlan, runFPLMonteCarloSimulation } from '../utils/fplQuantEngine';
import { PlayerPhoto } from './PlayerPhoto';

interface MultiWeekPlannerProps {
  data: RecommendationResponse | null;
  syncedData: TeamSyncResponse | null;
  riskMode: 'safe' | 'aggressive' | 'value';
  onSyncTeamId?: (teamId: string, gameweek?: number) => void;
  onApplySquad?: (playerIds: number[]) => void;
  onViewAudit?: () => void;
}

export const MultiWeekPlanner: React.FC<MultiWeekPlannerProps> = ({
  data,
  syncedData,
  riskMode,
  onSyncTeamId,
  onApplySquad,
  onViewAudit
}) => {
  const [horizon, setHorizon] = useState<number>(5);
  const [showConfidence, setShowConfidence] = useState<boolean>(true);
  const [expandedGw, setExpandedGw] = useState<number | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [appliedStep, setAppliedStep] = useState<number | null>(null);

  const startGw = data?.nextEventId || syncedData?.gameweek || 6;

  // Flatten all available players from top picks for search/reference
  const allCandidates = useMemo(() => {
    if (!data?.topPicks) return [];
    return [
      ...data.topPicks.gkp,
      ...data.topPicks.def,
      ...data.topPicks.mid,
      ...data.topPicks.fwd
    ];
  }, [data]);

  // Determine starting squad: preferably synced user squad, otherwise exact Pitch View LP optimum squad
  const baseSquad = useMemo(() => {
    if (syncedData?.squad && syncedData.squad.length === 15) {
      return syncedData.squad;
    }
    if (data?.squad && data.squad.length === 15) {
      return data.squad;
    }
    if (data?.startingXI && data?.bench && (data.startingXI.length + data.bench.length === 15)) {
      return [...data.startingXI, ...data.bench];
    }
    if (data?.topPicks) {
      return [
        ...data.topPicks.gkp.slice(0, 2),
        ...data.topPicks.def.slice(0, 5),
        ...data.topPicks.mid.slice(0, 5),
        ...data.topPicks.fwd.slice(0, 3)
      ];
    }
    return [];
  }, [syncedData, data]);

  // Resolve plan: Use backend multiWeekPlan if available, otherwise fallback to high-fidelity client engine
  const [planSteps, setPlanSteps] = useState<PlannerStepDetail[]>([]);

  useEffect(() => {
    setIsSimulating(true);
    const timer = setTimeout(() => {
      if (syncedData?.multiWeekPlan && syncedData.multiWeekPlan.length > 0) {
        setPlanSteps(syncedData.multiWeekPlan.slice(0, horizon));
      } else if (baseSquad.length > 0) {
        const clientPlan = generateClientMultiWeekPlan(
          baseSquad,
          allCandidates,
          startGw,
          horizon,
          syncedData?.bank ? (syncedData.bank > 30 ? syncedData.bank / 10 : syncedData.bank) : 0.5,
          riskMode
        );
        setPlanSteps(clientPlan);
      }
      setIsSimulating(false);
    }, 150);

    return () => clearTimeout(timer);
  }, [syncedData?.multiWeekPlan, baseSquad, allCandidates, startGw, horizon, syncedData?.bank, riskMode]);

  // Aggregate stats over the horizon
  const totalProjectedXP = useMemo(() => {
    return Math.round(planSteps.reduce((acc, step) => acc + step.weeklyScore - step.hitCost, 0) * 10) / 10;
  }, [planSteps]);

  const totalHits = useMemo(() => {
    return planSteps.reduce((acc, step) => acc + step.hitCost, 0);
  }, [planSteps]);

  const transferCount = useMemo(() => {
    return planSteps.filter(s => s.actionType === 'TRANSFER').length;
  }, [planSteps]);

  const chipsPlanned = useMemo(() => {
    return planSteps.filter(s => s.actionType === 'CHIP' || s.chipName).map(s => s.chipName || 'CHIP');
  }, [planSteps]);

  // Comprehensive lookup map for player metadata across all potential player pools
  const playerMap = useMemo(() => {
    const map = new Map<number, ScoredPlayer>();
    allCandidates.forEach(p => map.set(p.id, p));
    baseSquad.forEach(p => map.set(p.id, p));
    if (syncedData?.squad) syncedData.squad.forEach(p => map.set(p.id, p));
    if (data?.squad) data.squad.forEach(p => map.set(p.id, p));
    if (data?.startingXI) data.startingXI.forEach(p => map.set(p.id, p));
    if (data?.bench) data.bench.forEach(p => map.set(p.id, p));
    return map;
  }, [allCandidates, baseSquad, syncedData, data]);

  const getPlayerById = (id: number): ScoredPlayer | undefined => {
    return playerMap.get(id) || baseSquad.find(p => p.id === id) || allCandidates.find(p => p.id === id);
  };

  const handleApply = (step: PlannerStepDetail) => {
    setAppliedStep(step.stepIndex);
    if (onApplySquad) {
      onApplySquad([...step.starters, ...step.bench]);
    }
    setTimeout(() => setAppliedStep(null), 3000);
  };

  return (
    <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-4 sm:p-6 mb-6 text-slate-200">
      
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Network className="w-5 h-5 text-emerald-400" />
            </div>
            <h2 className="text-xl font-black text-white tracking-wide">
              Multi-Horizon Beam Search & Monte Carlo Planner
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Markov Decision Process lookahead optimizing rolling free transfers (up to 5 FTs), time-decayed chip residual values, and 1,000 Monte Carlo match simulations per Gameweek.
          </p>
          <div className="flex items-center gap-2 mt-2.5">
            <span className="text-[11px] font-bold text-slate-400">Baseline Squad:</span>
            {syncedData?.squad && syncedData.squad.length === 15 ? (
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                Synced Team ({syncedData.managerInfo?.teamName || 'Custom Squad'})
              </span>
            ) : (
              <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1 ${
                data?.activeScenario === 'template' 
                  ? 'bg-purple-600/20 border border-purple-500/40 text-purple-300' 
                  : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
              }`}>
                {data?.activeScenario === 'template' ? '🛡️ Template Shield' : '⚡ Quant Optimal'}
              </span>
            )}
            <span className="text-[10px] font-mono text-slate-500">
              ({riskMode.toUpperCase()} Mode)
            </span>
          </div>
        </div>

        {/* Controls: Horizon & Confidence Toggle */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800">
            <span className="text-[11px] font-bold text-slate-400 px-2 uppercase tracking-wider">Horizon:</span>
            {[3, 5, 8].map(h => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${
                  horizon === h 
                    ? 'bg-emerald-500 text-slate-950 shadow-[0_0_12px_rgba(0,255,133,0.3)]' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {h} GWs
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowConfidence(prev => !prev)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
              showConfidence 
                ? 'bg-purple-500/15 border-purple-500/40 text-purple-300' 
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Monte Carlo P10-P90</span>
          </button>

          {onViewAudit && (
            <button
              onClick={onViewAudit}
              className="px-3 py-1.5 rounded-xl text-xs font-bold border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Audit past Gameweek predictions against live FPL points"
            >
              <Dice5 className="w-3.5 h-3.5" />
              <span>Historical MC Audit</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Squad Captaincy Notice */}
      {baseSquad.length > 0 && !baseSquad.some(p => p.web_name === 'Haaland') && (
        <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 font-bold">💡 Notice:</span>
            <span>
              <strong>Haaland (£15.5m)</strong> is not in your current 15-player squad. Captains can only be selected from your owned assets. Weekly captaincy rotates dynamically among your squad (e.g. B.Fernandes, Palmer, Saka) based on upcoming Fixture Difficulty (FDR) and Home advantage.
            </span>
          </div>
        </div>
      )}

      {/* Aggregate Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> Horizon Projected xP
          </span>
          <div className="text-xl font-black text-white mt-1">
            {totalProjectedXP} <span className="text-xs text-emerald-400 font-semibold">pts</span>
          </div>
          <span className="text-[10px] text-slate-500">Across {horizon} Gameweeks</span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1">
            <ArrowRightLeft className="w-3.5 h-3.5 text-sky-400" /> Planned Transfers
          </span>
          <div className="text-xl font-black text-white mt-1">
            {transferCount} <span className="text-xs text-sky-400 font-semibold">swaps</span>
          </div>
          <span className="text-[10px] text-slate-500">
            {totalHits > 0 ? `-${totalHits} pts hit penalty` : 'Zero hit penalties'}
          </span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1">
            <Coins className="w-3.5 h-3.5 text-amber-400" /> Bank Progression
          </span>
          <div className="text-xl font-black text-white mt-1">
            £{planSteps[planSteps.length - 1]?.bank?.toFixed(1) || '0.0'}m
          </div>
          <span className="text-[10px] text-slate-500">
            {planSteps[planSteps.length - 1]?.freeTransfers || 1} FTs available at end
          </span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-purple-400" /> Strategic Chips
          </span>
          <div className="text-xl font-black text-white mt-1">
            {chipsPlanned.length > 0 ? chipsPlanned.join(', ') : 'None Deployed'}
          </div>
          <span className="text-[10px] text-slate-500">Optimized timing window</span>
        </div>
      </div>

      {/* Main Roadmap Timeline */}
      {isSimulating ? (
        <div className="h-64 flex flex-col items-center justify-center border border-slate-800 border-dashed rounded-xl bg-slate-900/50">
          <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-xs font-mono text-slate-400 animate-pulse uppercase tracking-widest">
            Running 1,000 Monte Carlo Simulations per Gameweek...
          </p>
        </div>
      ) : planSteps.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            Tactical Roadmap ({startGw} – {startGw + horizon - 1})
          </h3>

          <div className="space-y-3">
            {planSteps.map((step, idx) => {
              const isCurrentGw = idx === 0;
              const isExpanded = expandedGw === step.gameweek;
              const isChip = step.actionType === 'CHIP' || Boolean(step.chipName);
              const isTransfer = step.actionType === 'TRANSFER';
              const isRoll = step.actionType === 'ROLL' || step.actionDesc.includes('Roll');
              const isPenalty = step.hitCost > 0;

              const captainPlayer = getPlayerById(step.captainId);
              const viceCaptainPlayer = getPlayerById(step.viceCaptainId);

              return (
                <div 
                  key={step.gameweek}
                  className={`rounded-2xl border transition-all ${
                    isChip 
                      ? 'bg-amber-950/15 border-amber-500/40 shadow-lg shadow-amber-500/5' 
                      : isCurrentGw 
                        ? 'bg-slate-900/90 border-emerald-500/40 shadow-lg shadow-emerald-500/5' 
                        : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Step Header Bar */}
                  <div className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                      {/* Gameweek Badge */}
                      <div className={`px-2.5 py-1 rounded-lg font-black text-xs flex items-center gap-1.5 ${
                        isCurrentGw ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-white'
                      }`}>
                        <span>GW {step.gameweek}</span>
                        {isCurrentGw && (
                          <span className="text-[9px] bg-slate-950 text-emerald-400 px-1 py-0.2 rounded font-black">
                            NEXT
                          </span>
                        )}
                      </div>

                      {/* Action Type Badge */}
                      {isChip ? (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider bg-amber-500 text-slate-950 shadow-sm">
                          <Zap className="w-3.5 h-3.5" />
                          <span>{step.chipName ? `${step.chipName} CHIP` : 'STRATEGIC CHIP'}</span>
                        </div>
                      ) : isTransfer ? (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-sky-500/15 border border-sky-500/30 text-sky-300">
                          <ArrowRightLeft className="w-3.5 h-3.5 text-sky-400" />
                          <span>TRANSFER</span>
                          {isPenalty && (
                            <span className="ml-1 px-1 bg-red-500/20 border border-red-500/30 text-red-300 text-[10px] rounded font-black">
                              -{step.hitCost} PTS
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800/80 border border-slate-700 text-slate-300">
                          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                          <span>ROLL TRANSFER</span>
                        </div>
                      )}

                      {/* Captaincy (C) & Vice-Captaincy (V) Tags - always shown for all GWs across all horizons */}
                      {captainPlayer && (() => {
                        const capFix = captainPlayer.next_fixtures?.find(f => f.event === step.gameweek) || captainPlayer.next_fixtures?.[idx];
                        const oppLabel = capFix ? `vs ${capFix.opponent} (${capFix.is_home ? 'H' : 'A'})` : '';
                        const fdrColor = capFix?.difficulty <= 2 ? 'text-emerald-400' : (capFix?.difficulty || 3) >= 4 ? 'text-red-400' : 'text-slate-400';
                        return (
                          <div className="inline-flex items-center gap-1 text-[11px] text-amber-300 font-bold bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-lg shadow-sm">
                            <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>(C) {captainPlayer.web_name}</span>
                            {oppLabel && <span className={`text-[10px] font-mono ${fdrColor}`}>{oppLabel}</span>}
                          </div>
                        );
                      })()}

                      {viceCaptainPlayer && (() => {
                        const vcFix = viceCaptainPlayer.next_fixtures?.find(f => f.event === step.gameweek) || viceCaptainPlayer.next_fixtures?.[idx];
                        const oppLabel = vcFix ? `vs ${vcFix.opponent} (${vcFix.is_home ? 'H' : 'A'})` : '';
                        const fdrColor = vcFix?.difficulty <= 2 ? 'text-emerald-400' : (vcFix?.difficulty || 3) >= 4 ? 'text-red-400' : 'text-slate-400';
                        return (
                          <div className="inline-flex items-center gap-1 text-[11px] text-sky-300 font-bold bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded-lg shadow-sm">
                            <ShieldCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                            <span>(V) {viceCaptainPlayer.web_name}</span>
                            {oppLabel && <span className={`text-[10px] font-mono ${fdrColor}`}>{oppLabel}</span>}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Monte Carlo 80% CI Visual Fan Gauge for Future Gameweek */}
                    {showConfidence && step.confidenceInterval && (() => {
                      const p10 = step.confidenceInterval[0];
                      const p90 = step.confidenceInterval[1];
                      const mean = step.weeklyScore;
                      const minRange = Math.min(20, Math.floor(p10 * 0.7));
                      const maxRange = Math.max(120, Math.ceil(p90 * 1.3));
                      const rangeSpan = Math.max(1, maxRange - minRange);
                      const p10Percent = Math.max(0, Math.min(100, ((p10 - minRange) / rangeSpan) * 100));
                      const p90Percent = Math.max(0, Math.min(100, ((p90 - minRange) / rangeSpan) * 100));
                      const meanPercent = Math.max(0, Math.min(100, ((mean - minRange) / rangeSpan) * 100));

                      return (
                        <div className="hidden md:flex flex-col flex-1 max-w-xs px-2 py-0.5">
                          <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 mb-1 whitespace-nowrap gap-1">
                            <span>P10: <strong className="text-slate-300">{p10}</strong></span>
                            <span className="text-purple-300 font-bold px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800">xP {mean}</span>
                            <span>P90: <strong className="text-slate-300">{p90}</strong></span>
                          </div>
                          <div className="relative h-2.5 bg-slate-950 rounded-full border border-slate-800 overflow-hidden flex items-center">
                            <div 
                              className="absolute top-0 bottom-0 bg-purple-500/25 border-l border-r border-purple-400/80 rounded"
                              style={{
                                left: `${p10Percent}%`,
                                width: `${Math.max(2, p90Percent - p10Percent)}%`
                              }}
                              title={`80% Confidence Interval: ${p10} to ${p90} pts`}
                            />
                            <div 
                              className="absolute top-0 bottom-0 w-[2px] bg-purple-400 z-10 shadow-[0_0_4px_rgba(168,85,247,0.8)]"
                              style={{ left: `${meanPercent}%` }}
                              title={`Mean xP: ${mean} pts`}
                            />
                          </div>
                        </div>
                      );
                    })()}

                    {/* Scores & Confidences */}
                    <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end shrink-0">
                      <div className="text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="text-sm font-black text-white">{step.weeklyScore}</span>
                          <span className="text-[10px] text-emerald-400 font-bold uppercase">xP</span>
                        </div>
                        {showConfidence && step.confidenceInterval && (
                          <div className="text-[10px] text-slate-400 font-mono md:hidden">
                            Floor: <strong className="text-slate-300">{step.confidenceInterval[0]}</strong> • Ceiling: <strong className="text-purple-300">{step.confidenceInterval[1]}</strong>
                          </div>
                        )}
                      </div>

                      {/* Expand / View Details Button */}
                      <button
                        onClick={() => setExpandedGw(isExpanded ? null : step.gameweek)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all border border-slate-700/60 shadow-sm"
                        title={isExpanded ? "Collapse squad" : "Expand squad view"}
                      >
                        <span className="hidden sm:inline">{isExpanded ? 'Close' : 'Inspect'}</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Transfer Action Details Preview */}
                  {isTransfer && (step.transfersInDetails?.length || 0) > 0 && (
                    <div className="px-4 pb-3 flex flex-wrap items-center gap-2 border-t border-slate-800/60 pt-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {step.transfersOutDetails?.map(outP => (
                          <div key={outP.id} className="inline-flex items-center gap-1.5 bg-red-500/15 border border-red-500/30 text-red-200 text-xs font-bold px-2.5 py-1 rounded-lg">
                            <span className="text-[9px] uppercase font-black tracking-wider bg-red-500 text-slate-950 px-1 py-0.2 rounded">OUT</span>
                            <span>{outP.name}</span>
                            <span className="text-slate-400 text-[10px]">£{(outP.cost > 30 ? outP.cost / 10 : outP.cost).toFixed(1)}m</span>
                          </div>
                        ))}
                        <span className="text-slate-500 font-bold">➔</span>
                        {step.transfersInDetails?.map(inP => (
                          <div key={inP.id} className="inline-flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs font-bold px-2.5 py-1 rounded-lg">
                            <span className="text-[9px] uppercase font-black tracking-wider bg-emerald-500 text-slate-950 px-1 py-0.2 rounded">IN</span>
                            <span>{inP.name}</span>
                            <span className="text-slate-400 text-[10px]">£{(inP.cost > 30 ? inP.cost / 10 : inP.cost).toFixed(1)}m</span>
                          </div>
                        ))}
                      </div>

                      <div className="ml-auto text-[11px] text-slate-400 font-mono">
                        Bank: £{step.bank?.toFixed(1) || '0.0'}m • {step.freeTransfers} FTs
                      </div>
                    </div>
                  )}

                  {/* Expandable Squad Details */}
                  {isExpanded && (
                    <div className="p-4 bg-slate-950/70 border-t border-slate-800/80 rounded-b-2xl">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-emerald-400" />
                          Projected Lineup for GW {step.gameweek}
                        </span>

                        <button
                          onClick={() => handleApply(step)}
                          className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                        >
                          {appliedStep === step.stepIndex ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Applied!</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Apply Squad</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Starting XI Grid */}
                      <div className="mb-4">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">
                          Starting XI (11 Players)
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                          {step.starters.map(id => {
                            const player = getPlayerById(id);
                            if (!player) return null;
                            const isCap = player.id === step.captainId;
                            const isVice = player.id === step.viceCaptainId;

                            return (
                              <div 
                                key={id} 
                                className={`bg-slate-900 border rounded-xl p-2 relative transition-all ${
                                  isCap 
                                    ? 'border-amber-500/60 shadow-md shadow-amber-500/10 ring-1 ring-amber-500/30' 
                                    : isVice 
                                      ? 'border-sky-500/60 shadow-md shadow-sky-500/10 ring-1 ring-sky-500/30' 
                                      : 'border-slate-800'
                                }`}
                              >
                                {isCap && (
                                  <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-slate-950 text-[9px] font-black px-1.5 py-0.2 rounded-full shadow-md flex items-center gap-0.5">
                                    <Crown className="w-2.5 h-2.5" />
                                    C
                                  </span>
                                )}
                                {isVice && (
                                  <span className="absolute -top-1.5 -left-1.5 bg-sky-500 text-slate-950 text-[9px] font-black px-1.5 py-0.2 rounded-full shadow-md flex items-center gap-0.5">
                                    <ShieldCheck className="w-2.5 h-2.5" />
                                    V
                                  </span>
                                )}
                                <div className="text-xs font-bold text-white truncate">{player.web_name}</div>
                                <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
                                  <span>{player.position} • {player.team_short_name}</span>
                                  <span className="text-emerald-400 font-bold font-mono">{player.xP?.toFixed(1) || '0.0'}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Bench Grid */}
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">
                          Bench (4 Players)
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {step.bench.map(id => {
                            const player = getPlayerById(id);
                            if (!player) return null;
                            const isCap = player.id === step.captainId;
                            const isVice = player.id === step.viceCaptainId;
                            return (
                              <div 
                                key={id} 
                                className={`bg-slate-900/50 border rounded-xl p-2 relative ${
                                  isCap 
                                    ? 'border-amber-500/60 ring-1 ring-amber-500/30' 
                                    : isVice 
                                      ? 'border-sky-500/60 ring-1 ring-sky-500/30' 
                                      : 'border-slate-800/60'
                                }`}
                              >
                                {isCap && (
                                  <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-slate-950 text-[9px] font-black px-1.5 py-0.2 rounded-full shadow-md flex items-center gap-0.5">
                                    <Crown className="w-2.5 h-2.5" />
                                    C
                                  </span>
                                )}
                                {isVice && (
                                  <span className="absolute -top-1.5 -left-1.5 bg-sky-500 text-slate-950 text-[9px] font-black px-1.5 py-0.2 rounded-full shadow-md flex items-center gap-0.5">
                                    <ShieldCheck className="w-2.5 h-2.5" />
                                    V
                                  </span>
                                )}
                                <div className="text-xs font-bold text-slate-400 truncate">{player.web_name}</div>
                                <div className="flex justify-between items-center text-[10px] text-slate-500 mt-1">
                                  <span>{player.position} • {player.team_short_name}</span>
                                  <span className="text-slate-400 font-mono">{player.xP?.toFixed(1) || '0.0'}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                    </div>
                  )}

                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="py-12 text-center text-slate-500">
          <AlertCircle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs">No plan generated yet. Sync your Team ID or load player data to begin.</p>
        </div>
      )}

    </div>
  );
};
