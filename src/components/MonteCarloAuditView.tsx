import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart3, 
  TrendingUp, 
  ShieldCheck, 
  Zap, 
  DollarSign, 
  ChevronDown, 
  ChevronUp, 
  AlertTriangle, 
  CheckCircle2, 
  Dice5, 
  Sliders, 
  Activity, 
  Sparkles, 
  RefreshCw,
  Info,
  Crown,
  Play,
  X
} from 'lucide-react';
import { MonteCarloAuditDataset, MonteCarloModeResult, MonteCarloGwArchive } from '../types/monteCarloAudit';

interface MonteCarloAuditViewProps {
  initialFuel?: string;
}

export const MonteCarloAuditView: React.FC<MonteCarloAuditViewProps> = ({ initialFuel = 'fplform' }) => {
  const normalizeFuel = (f?: string): 'fplform' | 'native' | 'eye-test' => {
    if (f === 'native') return 'native';
    if (f === 'eyetest' || f === 'eye-test') return 'eye-test';
    return 'fplform';
  };

  const [fuel, setFuel] = useState<'fplform' | 'native' | 'eye-test'>(normalizeFuel(initialFuel));
  const [scenario, setScenario] = useState<'quant' | 'template'>('quant');
  const [selectedMode, setSelectedMode] = useState<'safe' | 'aggressive' | 'value'>('safe');
  const [data, setData] = useState<MonteCarloAuditDataset | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGw, setExpandedGw] = useState<number | null>(null);
  const [auditHorizon, setAuditHorizon] = useState<'3' | '5' | 'all'>('all');

  // Trigger state
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  const [triggerStatus, setTriggerStatus] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [showCustomModal, setShowCustomModal] = useState<boolean>(false);
  const [customFuel, setCustomFuel] = useState<string>('all');
  const [customStartGw, setCustomStartGw] = useState<number>(1);
  const [customEndGw, setCustomEndGw] = useState<number>(7);

  // Load audit dataset whenever fuel changes
  const loadAuditData = (targetFuel: string) => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    const fuelSuffix = targetFuel === 'eye-test' ? 'eyetest' : targetFuel;
    const url = `/data/monte_carlo_audit_${fuelSuffix}.json?t=${Date.now()}`;

    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const fallbackRes = await fetch(`/data/monte_carlo_history.json?t=${Date.now()}`);
          if (!fallbackRes.ok) throw new Error(`Audit data for ${targetFuel.toUpperCase()} not found. Click "Run Audit" to generate.`);
          return fallbackRes.json();
        }
        return res.json();
      })
      .then((json: MonteCarloAuditDataset) => {
        if (isMounted) {
          setData(json);
          setLoading(false);
          if (json.gameweeks && json.gameweeks.length > 0) {
            setExpandedGw(json.gameweeks[json.gameweeks.length - 1].gameweek);
          }
        }
      })
      .catch((err: any) => {
        if (isMounted) {
          setError(err.message || 'Failed to load Monte Carlo audit dataset');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  };

  useEffect(() => {
    loadAuditData(fuel);
  }, [fuel]);

  const handleRunAudit = async (options: { fuel?: string; startGw?: number; endGw?: number } = {}) => {
    setIsTriggering(true);
    setTriggerStatus('Running Monte Carlo simulations and walk-forward reconciliation...');
    setTriggerError(null);

    try {
      let res = await fetch('/api/run-mc-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
      });

      if (!res.ok && res.status === 404) {
        res = await fetch('/api/admin/run-mc-archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options)
        });
      }

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to execute Monte Carlo audit');
      }

      setTriggerStatus(json.message || 'Audit completed successfully! Reloading dataset...');

      // If backend returned in-memory dataset, update state immediately
      const fuelSuffix = fuel === 'eye-test' ? 'eyetest' : fuel;
      if (json.datasets && json.datasets[fuelSuffix]) {
        setData(json.datasets[fuelSuffix]);
      } else if (json.datasets && json.datasets[fuel]) {
        setData(json.datasets[fuel]);
      } else if (json.dataset) {
        setData(json.dataset);
      } else {
        // Re-fetch active fuel data
        loadAuditData(fuel);
      }

      setTimeout(() => {
        setTriggerStatus(null);
        setShowCustomModal(false);
      }, 3500);
    } catch (err: any) {
      setTriggerError(err.message || 'An error occurred triggering the audit');
    } finally {
      setIsTriggering(false);
    }
  };

  const activeKey = `${scenario}_${selectedMode}`;

  // Filter and sort gameweeks descending (GW6 -> GW1) based on active audit horizon
  const allSortedGameweeks = useMemo(() => {
    if (!data?.gameweeks) return [];
    return [...data.gameweeks].sort((a, b) => b.gameweek - a.gameweek);
  }, [data?.gameweeks]);

  const sortedGameweeks = useMemo(() => {
    if (auditHorizon === '3') {
      return allSortedGameweeks.slice(0, 3);
    }
    if (auditHorizon === '5') {
      return allSortedGameweeks.slice(0, 5);
    }
    return allSortedGameweeks;
  }, [allSortedGameweeks, auditHorizon]);

  // Dynamic KPIs calculated for the active audit horizon and active scenario/mode
  const horizonStats = useMemo(() => {
    let totalPoints = 0;
    let netAlpha = 0;
    let totalAbsError = 0;
    let ciHits = 0;
    let hauls = 0;
    let evaluatedCount = 0;

    sortedGameweeks.forEach(gw => {
      const res = gw.results?.[activeKey];
      if (res) {
        evaluatedCount++;
        totalPoints += res.reconciliation.netActualScore;
        netAlpha += res.reconciliation.alphaVsTemplate;
        totalAbsError += Math.abs(res.reconciliation.predictionError);
        if (res.reconciliation.insideConfidenceInterval) ciHits++;
        if (res.reconciliation.haulAchieved) hauls++;
      }
    });

    return {
      totalPoints: Math.round(totalPoints * 10) / 10,
      netAlpha: Math.round(netAlpha * 10) / 10,
      avgAbsoluteError: evaluatedCount > 0 ? Math.round((totalAbsError / evaluatedCount) * 10) / 10 : 0,
      ciCoverageRate: evaluatedCount > 0 ? Math.round((ciHits / evaluatedCount) * 1000) / 10 : 0,
      ciHitCount: ciHits,
      haulHitCount: hauls,
      totalEvaluated: evaluatedCount
    };
  }, [sortedGameweeks, activeKey]);

  // Mode visual tokens
  const modeTokens = {
    safe: {
      label: 'SAFE Baseline',
      icon: ShieldCheck,
      color: 'text-emerald-400',
      border: 'border-emerald-500/30',
      bg: 'bg-emerald-500/10',
      badge: 'bg-emerald-500/20 text-emerald-300'
    },
    aggressive: {
      label: 'RISKY Differential',
      icon: Zap,
      color: 'text-amber-400',
      border: 'border-amber-500/30',
      bg: 'bg-amber-500/10',
      badge: 'bg-amber-500/20 text-amber-300'
    },
    value: {
      label: 'VALUE Budget ROI',
      icon: DollarSign,
      color: 'text-cyan-400',
      border: 'border-cyan-500/30',
      bg: 'bg-cyan-500/10',
      badge: 'bg-cyan-500/20 text-cyan-300'
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-slate-900/60 rounded-2xl border border-slate-800 text-slate-400 min-h-[380px]">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mb-4" />
        <p className="text-xs font-semibold tracking-wider uppercase text-slate-300">
          Loading Monte Carlo Walk-Forward Audit...
        </p>
        <p className="text-[11px] text-slate-500 mt-1">Reconciling 1,000-iteration probability distributions against live FPL match points</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 bg-slate-900/80 rounded-2xl border border-amber-500/30 text-slate-300">
        <div className="flex items-center gap-3 text-amber-400 mb-3">
          <AlertTriangle className="w-6 h-6" />
          <h3 className="font-bold text-sm uppercase tracking-wider">No Monte Carlo Audit Dataset Found</h3>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed mb-4">
          The walk-forward out-of-sample audit file for <strong className="text-white">{fuel.toUpperCase()}</strong> has not yet been compiled.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleRunAudit({ fuel: 'all' })}
            disabled={isTriggering}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-lg active:scale-95 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isTriggering ? 'Running Simulations...' : 'Run Audit Now (All Fuels)'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Top Header & Sub-Navigation */}
      <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-5 sm:p-6 text-slate-200 shadow-xl">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-800/80 pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
                <Dice5 className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white tracking-wide flex items-center gap-2">
                  Monte Carlo Multi-Week Planner Audit
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase tracking-widest">
                    Out-Of-Sample
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Walk-forward reconciliation: 1,000 Monte Carlo match simulations vs official live FPL matchday points.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Action Trigger Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={isTriggering}
              onClick={() => handleRunAudit({ fuel: 'all' })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 text-xs font-black uppercase tracking-wider transition-all shadow-sm active:scale-95 disabled:opacity-50"
              title="Run Monte Carlo audit across all fuels from GW1 to latest finished GW"
            >
              <Play className="w-3 h-3 fill-current" />
              {isTriggering ? 'Running...' : 'Run All Fuels'}
            </button>

            <button
              disabled={isTriggering}
              onClick={() => handleRunAudit({ fuel })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-black uppercase tracking-wider transition-all shadow-sm active:scale-95 disabled:opacity-50"
              title={`Run walk-forward reconciliation for active fuel (${fuel.toUpperCase()}) from GW1 to latest finished GW`}
            >
              <Zap className="w-3 h-3 fill-current" />
              {isTriggering ? 'Running...' : `Run ${fuel.toUpperCase()}`}
            </button>

            <button
              disabled={isTriggering}
              onClick={() => setShowCustomModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-bold transition-all shadow-sm active:scale-95"
              title="Configure custom fuel and gameweek horizon"
            >
              <Sliders className="w-3.5 h-3.5" />
              Custom...
            </button>
          </div>
        </div>

        {/* Live Trigger Status Banner */}
        {isTriggering && (
          <div className="mt-4 flex items-center gap-2.5 p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-xs text-purple-200">
            <RefreshCw className="w-4 h-4 animate-spin text-purple-400 shrink-0" />
            <span>Running 1,000 Monte Carlo match simulations and walk-forward reconciliation... please wait ~10-15s.</span>
          </div>
        )}
        {triggerStatus && !isTriggering && (
          <div className="mt-4 flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{triggerStatus}</span>
          </div>
        )}
        {triggerError && (
          <div className="mt-4 flex items-center gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{triggerError}</span>
          </div>
        )}

        {/* Controls: Fuel + Scenario */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center gap-3">
            {/* Fuel Selector */}
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setFuel('fplform')}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                  fuel === 'fplform' 
                    ? 'bg-emerald-500 text-slate-950 shadow-md font-extrabold' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                FPLFORM
              </button>
              <button
                onClick={() => setFuel('native')}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                  fuel === 'native' 
                    ? 'bg-purple-600 text-white shadow-md font-extrabold' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                NATIVE
              </button>
              <button
                onClick={() => setFuel('eye-test')}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                  fuel === 'eye-test' 
                    ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                EYE-TEST
              </button>
            </div>

            {/* Scenario Selector: Quant Optimal vs Risky Template Shield */}
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setScenario('quant')}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 ${
                  scenario === 'quant'
                    ? 'bg-indigo-600 text-white shadow-md font-extrabold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                Quant Optimal
              </button>
              <button
                onClick={() => setScenario('template')}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 ${
                  scenario === 'template'
                    ? 'bg-amber-600 text-white shadow-md font-extrabold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShieldCheck className="w-3 h-3" />
                Risky Template Shield
              </button>
            </div>
          </div>

          {/* Horizon Lens Switcher (Matching MultiWeekPlanner's 3, 5, All horizons) */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Horizon:
            </span>
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
              {(['3', '5', 'all'] as const).map(h => (
                <button
                  key={h}
                  onClick={() => setAuditHorizon(h)}
                  className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                    auditHorizon === h
                      ? 'bg-emerald-500 text-slate-950 shadow-md font-extrabold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {h === 'all' ? `All (GW${data.startGw}–${data.endGw})` : `Last ${h} GWs`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">
            Mode Lens:
          </span>
          {(['safe', 'aggressive', 'value'] as const).map((m) => {
            const token = modeTokens[m];
            const Icon = token.icon;
            const isSelected = selectedMode === m;
            return (
              <button
                key={m}
                onClick={() => setSelectedMode(m)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all border ${
                  isSelected
                    ? `${token.bg} ${token.color} ${token.border} shadow-lg scale-105`
                    : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {token.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI HUD Summary Cards (Clean rounded decimals) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: 80% CI Coverage Rate */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">80% CI Hit Rate</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-2xl font-black text-white flex items-baseline gap-1.5">
              {Number(horizonStats.ciCoverageRate).toFixed(1)}%
              <span className="text-[10px] font-semibold text-emerald-400">
                ({horizonStats.ciHitCount}/{horizonStats.totalEvaluated} GWs)
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Target: ~80% (Statistically Well-Calibrated)
            </p>
          </div>
        </div>

        {/* Card 2: Cumulative Actual Score (Rounded to 1 decimal place) */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Cumulative Total</span>
            <Crown className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="text-2xl font-black text-white flex items-baseline gap-2">
              {Number(horizonStats.totalPoints).toFixed(1)} pts
              <span className={`text-xs font-black ${horizonStats.netAlpha >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {horizonStats.netAlpha >= 0 ? `+${Number(horizonStats.netAlpha).toFixed(1)}` : Number(horizonStats.netAlpha).toFixed(1)} Alpha
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Across {sortedGameweeks.length} evaluated Gameweeks ({auditHorizon === 'all' ? 'All' : `Last ${auditHorizon} GWs`})
            </p>
          </div>
        </div>

        {/* Card 3: Mean Absolute Error */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Avg Prediction Error</span>
            <BarChart3 className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="text-2xl font-black text-white flex items-baseline gap-1">
              ±{Number(horizonStats.avgAbsoluteError).toFixed(1)} pts
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Mean absolute deviation (|Actual - Mean|)
            </p>
          </div>
        </div>

        {/* Card 4: Haul Outlier Precision */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Haul Detection (75+ pts)</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <div className="text-2xl font-black text-white flex items-baseline gap-1.5">
              {horizonStats.haulHitCount} Hauls
              <span className="text-[10px] text-purple-300 font-semibold">achieved</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Right-tail ceiling hauls captured in horizon
            </p>
          </div>
        </div>

      </div>

      {/* Gameweek-by-Gameweek Scorecard & Fan Chart List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            Gameweek Audit Ledger ({auditHorizon === 'all' ? `GW${data.startGw} → GW${data.endGw}` : `Last ${sortedGameweeks.length} GWs: GW${sortedGameweeks[sortedGameweeks.length - 1]?.gameweek || data.startGw} → GW${sortedGameweeks[0]?.gameweek || data.endGw}`})
          </h3>
          <span className="text-[10px] text-slate-500">
            Click any Gameweek to inspect Starting XI & Bench autosubs
          </span>
        </div>

        {sortedGameweeks.map((gwRecord) => {
          const res: MonteCarloModeResult | undefined = gwRecord.results[activeKey];
          if (!res) return null;

          const isExpanded = expandedGw === gwRecord.gameweek;
          const { monteCarlo, reconciliation, captain, viceCaptain, startingXI, bench } = res;
          
          let statusBadge = (
            <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Inside 80% CI
            </span>
          );

          if (reconciliation.netActualScore > monteCarlo.p90) {
            statusBadge = (
              <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30">
                Upside Outlier (Haul)
              </span>
            );
          } else if (reconciliation.netActualScore < monteCarlo.p10) {
            statusBadge = (
              <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Downside Blank Outlier
              </span>
            );
          }

          // Gauge bar positioning calculation
          const minRange = Math.min(20, Math.floor(monteCarlo.p10 * 0.7));
          const maxRange = Math.max(120, Math.ceil(monteCarlo.p90 * 1.3));
          const rangeSpan = Math.max(1, maxRange - minRange);

          const p10Percent = Math.max(0, Math.min(100, ((monteCarlo.p10 - minRange) / rangeSpan) * 100));
          const p90Percent = Math.max(0, Math.min(100, ((monteCarlo.p90 - minRange) / rangeSpan) * 100));
          const meanPercent = Math.max(0, Math.min(100, ((monteCarlo.meanXp - minRange) / rangeSpan) * 100));
          const actualPercent = Math.max(0, Math.min(100, ((reconciliation.netActualScore - minRange) / rangeSpan) * 100));

          return (
            <div 
              key={gwRecord.gameweek}
              className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-lg transition-all hover:border-slate-700"
            >
              {/* Gameweek Card Header */}
              <div 
                onClick={() => setExpandedGw(isExpanded ? null : gwRecord.gameweek)}
                className="p-4 sm:p-5 flex flex-col gap-3.5 cursor-pointer select-none"
              >
                {/* Top Row: GW info on Left, Score & Inspect Button on Right */}
                <div className="flex items-center justify-between gap-3">
                  {/* Left: GW title + status */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center font-black text-white shrink-0 shadow-inner">
                      <span className="text-[9px] uppercase tracking-wider text-slate-500">GW</span>
                      <span className="text-base sm:text-lg leading-none">{gwRecord.gameweek}</span>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-black text-white tracking-wide">
                          Gameweek {gwRecord.gameweek}
                        </h4>
                        {statusBadge}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 mt-1">
                        <span>
                          Cap: <strong className="text-white">{captain.name} ({Number.isInteger(captain.actualPoints * (captain.multiplier || 1)) ? captain.actualPoints * (captain.multiplier || 1) : Number(captain.actualPoints * (captain.multiplier || 1)).toFixed(1)} pts)</strong>
                          {captain.isVcPromoted && (
                            <span className="text-[9px] font-bold text-amber-400 ml-1">
                              (VC promoted · {captain.originalName} 0 mins)
                            </span>
                          )}
                          {!captain.isVcPromoted && captain.multiplier === 1 && (
                            <span className="text-[9px] font-bold text-rose-400 ml-1">
                              (C & VC 0 mins · No 2× bonus)
                            </span>
                          )}
                        </span>
                        <span>·</span>
                        <span>Template: <strong className="text-slate-300">{Number(gwRecord.templateScore).toFixed(1)} pts</strong></span>
                        <span>·</span>
                        <span>Avg: <strong className="text-slate-300">{Number(gwRecord.averageScore).toFixed(1)} pts</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Actual Points & Alpha & Inspect Button */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right shrink-0">
                      <div className="text-base sm:text-xl font-black text-white leading-tight">
                        {Number(reconciliation.netActualScore).toFixed(1)} <span className="text-[10px] sm:text-xs text-slate-400 font-normal">pts</span>
                      </div>
                      <div className={`text-[10px] font-black leading-tight ${reconciliation.alphaVsTemplate >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {reconciliation.alphaVsTemplate >= 0 ? `+${Number(reconciliation.alphaVsTemplate).toFixed(1)}` : Number(reconciliation.alphaVsTemplate).toFixed(1)} vs Template
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/60 text-slate-300 text-[11px] font-bold hover:bg-slate-700 hover:text-white transition-all shadow-sm shrink-0">
                      <span>{isExpanded ? 'Close' : 'Inspect'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </div>
                  </div>
                </div>

                {/* Bottom Row: Monte Carlo Forecast Distribution & Outcome Gauge */}
                <div className="w-full pt-3 border-t border-slate-800/60">
                  {/* Top Stats Row (immune to wrapping) */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1.5 whitespace-nowrap gap-2">
                    <span className="flex items-center gap-1">
                      <span className="text-[9px] uppercase font-bold text-slate-500">P10 Floor:</span>
                      <strong className="text-slate-300">{Number(monteCarlo.p10).toFixed(1)}</strong>
                    </span>
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800/80">
                      <span className="text-[9px] uppercase font-bold text-slate-500">Mean xP:</span>
                      <strong className="text-purple-300">{Number(monteCarlo.meanXp).toFixed(1)}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-[9px] uppercase font-bold text-slate-500">P90 Ceil:</span>
                      <strong className="text-slate-300">{Number(monteCarlo.p90).toFixed(1)}</strong>
                    </span>
                  </div>

                  {/* Visual Fan Band Track */}
                  <div className="relative h-3 bg-slate-950 rounded-full border border-slate-800/90 overflow-visible flex items-center my-2">
                    {/* Shaded 80% CI Band */}
                    <div 
                      className="absolute top-0 bottom-0 bg-purple-500/25 border-l-2 border-r-2 border-purple-400/80 rounded"
                      style={{
                        left: `${p10Percent}%`,
                        width: `${Math.max(2, p90Percent - p10Percent)}%`
                      }}
                      title={`80% Confidence Interval: ${Number(monteCarlo.p10).toFixed(1)} to ${Number(monteCarlo.p90).toFixed(1)} pts`}
                    />

                    {/* Mean line marker */}
                    <div 
                      className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-purple-400 z-10 shadow-[0_0_6px_rgba(168,85,247,0.7)]"
                      style={{ left: `${meanPercent}%` }}
                      title={`Mean Forecast: ${Number(monteCarlo.meanXp).toFixed(1)} pts`}
                    />

                    {/* Actual Points Marker Pin (Flag badge - explicitly non-interactive) */}
                    <div 
                      className="absolute top-[-8px] bottom-[-8px] z-20 pointer-events-none transition-all transform -translate-x-1/2 flex flex-col items-center"
                      style={{ left: `${actualPercent}%` }}
                    >
                      {/* Floating Indicator Needle & Pill */}
                      <div className="px-1.5 py-0.2 rounded bg-emerald-500 text-slate-950 text-[8px] font-black uppercase tracking-tighter shadow-md whitespace-nowrap mb-0.5">
                        {Number(reconciliation.netActualScore).toFixed(1)}
                      </div>
                      <div className="w-1.5 h-3 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.9)] border border-slate-950" />
                    </div>
                  </div>

                  {/* Micro Legend */}
                  <div className="flex items-center justify-between text-[9px] text-slate-500 mt-1 whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-1 rounded bg-purple-500/40 inline-block"></span>
                      80% Simulation Range
                    </span>
                    <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                      Actual Outcome Pin
                    </span>
                  </div>
                </div>
              </div>

              {/* Expanded Drilldown */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-slate-800/80 bg-slate-950/60 p-4 sm:p-5"
                  >
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                      
                      {/* Left 2 Cols: Starting XI and Bench */}
                      <div className="xl:col-span-2 space-y-4">
                        <div className="flex items-center justify-between">
                          <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                            Reconciled Matchday Squad (Autosubs Resolved)
                          </h5>
                          <span className="text-[10px] text-slate-500">
                            {captain.multiplier === 1 
                              ? 'Both C & VC played 0 mins (no 2× points)' 
                              : 'Captain gets 2× actual points'}
                          </span>
                        </div>

                        {/* Starting XI Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {startingXI.map((player) => {
                            const isCap = player.id === captain.id;
                            const isVc = viceCaptain && player.id === viceCaptain.id;
                            const rawPts = (isCap && captain.multiplier !== 1) ? player.actualPoints * 2 : player.actualPoints;
                            const effectivePts = Number.isInteger(rawPts) ? rawPts : Number(rawPts).toFixed(1);
                            
                            return (
                              <div 
                                key={player.id}
                                className={`flex items-center justify-between p-2 rounded-xl border text-xs ${
                                  isCap 
                                    ? 'bg-amber-500/10 border-amber-500/30 text-white' 
                                    : 'bg-slate-900 border-slate-800 text-slate-300'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 shrink-0">
                                    {player.position}
                                  </span>
                                  <div className="truncate">
                                    <div className="font-bold truncate flex items-center gap-1">
                                      {player.name}
                                      {isCap && (
                                        <span className="text-[9px] font-black text-amber-400">
                                          {captain.isVcPromoted ? '(VC→C)' : (captain.multiplier === 1 ? '(C·0x)' : '(C)')}
                                        </span>
                                      )}
                                      {!isCap && isVc && (
                                        <span className="text-[9px] font-black text-blue-400">
                                          (VC)
                                        </span>
                                      )}
                                      {player.subbedIn && <span className="text-[8px] font-bold px-1 rounded bg-blue-500/20 text-blue-300">SUB IN</span>}
                                    </div>
                                    <div className="text-[9px] text-slate-500">
                                      {player.team} · xP {Number(player.projectedXp).toFixed(1)}
                                    </div>
                                  </div>
                                </div>

                                <div className="text-right shrink-0">
                                  <div className={`font-black ${Number(effectivePts) >= 8 ? 'text-emerald-400' : 'text-white'}`}>
                                    {effectivePts} pts
                                  </div>
                                  <div className="text-[9px] text-slate-500">
                                    {player.played ? 'Played' : '0 mins'}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Bench List */}
                        <div className="pt-2">
                          <h6 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                            Bench Reserves
                          </h6>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {bench.map((bPlayer, bIdx) => (
                              <div 
                                key={bPlayer.id}
                                className="bg-slate-900/60 p-2 rounded-xl border border-slate-800 text-[11px] text-slate-400"
                              >
                                <div className="text-[9px] font-bold text-slate-500 mb-0.5">
                                  Sub {bIdx + 1} ({bPlayer.position})
                                </div>
                                <div className="font-bold text-slate-200 truncate flex items-center gap-1">
                                  <span className="truncate">{bPlayer.name}</span>
                                  {bPlayer.id === captain.id && (
                                    <span className="text-[8px] font-black px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                                      {captain.isVcPromoted ? 'Orig C' : 'C (0m)'}
                                    </span>
                                  )}
                                  {viceCaptain && bPlayer.id === viceCaptain.id && (
                                    <span className="text-[8px] font-black px-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 shrink-0">
                                      VC (0m)
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] mt-0.5 text-slate-400 flex justify-between">
                                  <span>{Number.isInteger(bPlayer.actualPoints) ? bPlayer.actualPoints : Number(bPlayer.actualPoints).toFixed(1)} pts</span>
                                  <span>{bPlayer.played ? 'Played' : '0 mins'}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Right 1 Col: Statistical Probability Breakdown */}
                      <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 space-y-3">
                        <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                          <Dice5 className="w-3.5 h-3.5 text-purple-400" />
                          Monte Carlo Risk Diagnostics
                        </h5>

                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between py-1 border-b border-slate-800">
                            <span className="text-slate-400">Expected Score (Mean):</span>
                            <strong className="text-white font-mono">{Number(monteCarlo.meanXp).toFixed(1)} pts</strong>
                          </div>
                          <div className="flex justify-between py-1 border-b border-slate-800">
                            <span className="text-slate-400">Median Outcome:</span>
                            <strong className="text-white font-mono">{Number(monteCarlo.median).toFixed(1)} pts</strong>
                          </div>
                          <div className="flex justify-between py-1 border-b border-slate-800">
                            <span className="text-slate-400">80% Confidence Interval:</span>
                            <strong className="text-purple-300 font-mono">[{Number(monteCarlo.p10).toFixed(1)}, {Number(monteCarlo.p90).toFixed(1)}]</strong>
                          </div>
                          <div className="flex justify-between py-1 border-b border-slate-800">
                            <span className="text-slate-400">Haul Probability (≥75):</span>
                            <strong className="text-emerald-400 font-mono">{monteCarlo.haulProbability}%</strong>
                          </div>
                          <div className="flex justify-between py-1 border-b border-slate-800">
                            <span className="text-slate-400">Blank Probability (≤40):</span>
                            <strong className="text-rose-400 font-mono">{monteCarlo.blankProbability}%</strong>
                          </div>
                          <div className="flex justify-between py-1 border-b border-slate-800">
                            <span className="text-slate-400">Simulated Variance (σ²):</span>
                            <strong className="text-slate-300 font-mono">{Number(monteCarlo.variance).toFixed(1)}</strong>
                          </div>
                          <div className="flex justify-between py-1">
                            <span className="text-slate-400">Actual Net Points:</span>
                            <strong className="text-white font-mono">{Number(reconciliation.netActualScore).toFixed(1)} pts</strong>
                          </div>
                        </div>

                        <div className="mt-3 p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 text-[10px] text-slate-400 leading-relaxed">
                          {reconciliation.insideConfidenceInterval ? (
                            <span className="text-emerald-400 font-medium flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Outcome landed within expected variance band ({reconciliation.predictionError > 0 ? `+${Number(reconciliation.predictionError).toFixed(1)}` : Number(reconciliation.predictionError).toFixed(1)} pts error).
                            </span>
                          ) : reconciliation.netActualScore > monteCarlo.p90 ? (
                            <span className="text-purple-300 font-medium flex items-center gap-1">
                              <Sparkles className="w-3.5 h-3.5" />
                              Explosive right-tail haul! Beat the 90th percentile ceiling.
                            </span>
                          ) : (
                            <span className="text-amber-400 font-medium flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Severe low-end matchday blank across key fixtures.
                            </span>
                          )}
                        </div>
                      </div>

                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Custom Run Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 text-slate-200 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-purple-400" />
                <h3 className="font-black text-sm uppercase tracking-wider text-white">Custom Monte Carlo Audit Run</h3>
              </div>
              <button 
                onClick={() => setShowCustomModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Fuel Source:
                </label>
                <select
                  value={customFuel}
                  onChange={(e) => setCustomFuel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold text-xs"
                >
                  <option value="all">All Fuels (FPLForm, Native, Eye-Test)</option>
                  <option value="fplform">FPLForm Only</option>
                  <option value="native">Native Only</option>
                  <option value="eye-test">Eye-Test Only</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Start Gameweek:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={38}
                    value={customStartGw}
                    onChange={(e) => setCustomStartGw(parseInt(e.target.value, 10) || 1)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    End Gameweek:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={38}
                    value={customEndGw}
                    onChange={(e) => setCustomEndGw(parseInt(e.target.value, 10) || 7)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold text-xs"
                  />
                </div>
              </div>

              <p className="text-[10px] text-slate-500 leading-relaxed pt-1">
                This triggers the in-process Monte Carlo simulation loop across both scenarios (Quant Optimal & Risky Template Shield) and all three modes.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowCustomModal(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                disabled={isTriggering}
                onClick={() => handleRunAudit({ fuel: customFuel, startGw: customStartGw, endGw: customEndGw })}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg active:scale-95 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                {isTriggering ? 'Running...' : 'Execute Audit'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

    </div>
  );
};
