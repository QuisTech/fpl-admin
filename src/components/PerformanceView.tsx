import { useState, useMemo } from 'react';
import { cn } from '../lib/utils';
import { TrendingUp, Award, Clock, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Trophy, Filter, BarChart3, Sparkles } from 'lucide-react';

interface PerformanceViewProps {
  history: any;
  fetchLivePoints: (gwId: number) => Promise<any>;
}

type SortField = 'actual' | 'diff' | 'xp' | 'time';
type SortOrder = 'desc' | 'asc';

export const PerformanceView = ({ history, fetchLivePoints }: PerformanceViewProps) => {
  const [actualScores, setActualScores] = useState<Record<number, Record<number, { points: number; minutes: number }>>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});
  const [selectedGwIndex, setSelectedGwIndex] = useState<number>(0);
  const [viewAll, setViewAll] = useState<boolean>(false);

  // Sorting & Filtering state
  const [sortBy, setSortBy] = useState<SortField>('actual');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [fuelFilter, setFuelFilter] = useState<string>('all');
  const [scenarioFilter, setScenarioFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');

  const gws = Object.keys(history).map(Number).sort((a, b) => b - a);

  const calculateActual = (gwId: number, snapshot: any) => {
    if (!actualScores[gwId]) return 0;
    let total = 0;
    
    // Support both old 'ids' format and new 'players' metadata format
    const playerIds = snapshot.players ? snapshot.players.map((p: any) => p.id) : (snapshot.ids || []);
    const captainId = snapshot.captainId;
    const viceCaptainId = snapshot.viceCaptainId;

    let activeCaptainId = captainId;
    if (captainId && actualScores[gwId][captainId] && actualScores[gwId][captainId].minutes === 0) {
      activeCaptainId = viceCaptainId;
    }

    playerIds.forEach((id: number) => {
      const pData = actualScores[gwId][id];
      if (pData !== undefined) {
        total += pData.points;
        if (id === activeCaptainId) total += pData.points; // Active Captain gets double
      }
    });
    return total;
  };

  const getSnapshotsForGW = (gwData: Record<string, any>) => {
    if (!gwData || typeof gwData !== 'object') return [];
    const list: any[] = [];
    const seenKeys = new Set<string>();

    Object.keys(gwData).forEach(key => {
      const item = gwData[key];
      if (!item || typeof item !== 'object' || !item.players) return;

      const fuel = item.fuel || 'fplform';
      const scenario = item.scenario || 'quant';
      const riskMode = item.riskMode || (['safe', 'aggressive', 'value'].includes(key) ? key : 'safe');
      const uniqueId = item.key || `${fuel}_${scenario}_${riskMode}_${item.timestamp || key}`;

      if (!seenKeys.has(uniqueId)) {
        seenKeys.add(uniqueId);
        list.push({
          ...item,
          uniqueId,
          fuel,
          scenario,
          riskMode,
          fuelLabel: item.fuelLabel || (fuel === 'eye-test' ? 'Eye Test' : fuel === 'native' ? 'Native FPL' : 'FPLForm'),
          scenarioLabel: item.scenarioLabel || (scenario === 'quant' ? 'Quant Optimal' : 'Risky Template Shield'),
          riskLabel: item.riskLabel || riskMode.toUpperCase()
        });
      }
    });

    return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  };

  const [expandedModes, setExpandedModes] = useState<Record<string, boolean>>({});

  const toggleExpand = (gwId: number, modeKey: string) => {
    const key = `${gwId}-${modeKey}`;
    setExpandedModes(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const refreshActuals = async (gwId: number) => {
    setLoading(prev => ({ ...prev, [gwId]: true }));
    const elements = await fetchLivePoints(gwId);
    if (elements) {
      const scores: Record<number, { points: number; minutes: number }> = {};
      elements.forEach((el: any) => {
        scores[el.id] = { points: el.stats.total_points, minutes: el.stats.minutes };
      });
      setActualScores(prev => ({ ...prev, [gwId]: scores }));
    }
    setLoading(prev => ({ ...prev, [gwId]: false }));
  };

  if (gws.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Clock className="w-12 h-12 text-slate-700 mb-4" />
        <p className="text-slate-400 font-mono text-sm tracking-widest uppercase">No history snapshots yet.</p>
        <p className="text-slate-600 text-[10px] mt-2 max-w-[250px]">
          Snapshots are taken when you use the <span className="text-fpl-green font-bold">SNAPSHOT</span> button in the Pitch view. 
          Use it before the deadline to lock in your final recommendations!
        </p>
      </div>
    );
  }

  const activeGwIndex = Math.min(selectedGwIndex, gws.length - 1);
  const visibleGws = viewAll ? gws : [gws[activeGwIndex] || gws[0]];

  return (
    <div className="space-y-4 overflow-y-auto pr-2 custom-scrollbar">
      {/* Gameweek Enveloped Chevron Navigator */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/70 p-3 rounded-2xl border border-fpl-border/60">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-fpl-green/10 border border-fpl-green/30 flex items-center justify-center text-fpl-green shadow-inner">
            <Award className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider">
              Performance Analysis
            </h3>
            <p className="text-[10px] text-slate-400 font-mono">
              {gws.length} Gameweek{gws.length > 1 ? 's' : ''} Tracked
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2">
          {/* User Requested Enveloped Chevron Bar */}
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-fpl-border/50">
            <button 
              onClick={() => {
                setViewAll(false);
                setSelectedGwIndex(prev => Math.min(gws.length - 1, prev + 1));
              }}
              disabled={viewAll || activeGwIndex >= gws.length - 1}
              className="p-0.5 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" 
              title="Previous Gameweek"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <span className="text-[8.5px] font-mono text-emerald-400 font-bold px-1.5 select-none">
              {viewAll ? `GWs ${gws[gws.length - 1]}–${gws[0]}` : `GW ${gws[activeGwIndex]}`}
            </span>

            <button 
              onClick={() => {
                setViewAll(false);
                setSelectedGwIndex(prev => Math.max(0, prev - 1));
              }}
              disabled={viewAll || activeGwIndex <= 0}
              className="p-0.5 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" 
              title="Next Gameweek"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Gameweek Quick Pills */}
          {gws.length > 1 && (
            <div className="hidden md:flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              {gws.map((gw, idx) => (
                <button
                  key={gw}
                  onClick={() => {
                    setViewAll(false);
                    setSelectedGwIndex(idx);
                  }}
                  className={cn(
                    "px-2 py-0.5 rounded text-[9px] font-mono font-bold transition-all",
                    !viewAll && activeGwIndex === idx 
                      ? "bg-fpl-green text-slate-950 shadow-sm" 
                      : "text-slate-400 hover:text-white hover:bg-slate-900"
                  )}
                >
                  GW{gw}
                </button>
              ))}
            </div>
          )}

          {/* Toggle View All */}
          {gws.length > 1 && (
            <button
              onClick={() => setViewAll(!viewAll)}
              className={cn(
                "text-[9px] font-mono font-black px-2.5 py-1 rounded-lg border transition-all uppercase tracking-wider",
                viewAll ? "bg-fpl-purple/20 text-fpl-purple border-fpl-purple/40" : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
              )}
            >
              {viewAll ? "Single GW" : "View All"}
            </button>
          )}
        </div>
      </div>

      {visibleGws.map(gwId => {
        const modes = history[gwId];
        const rawSnapshots = getSnapshotsForGW(modes);

        // Enrich with calculated points
        const enrichedSnapshots = rawSnapshots.map(data => {
          const normalizedXP = data.xP || 0;
          const actual = calculateActual(gwId, data);
          const diff = actual - normalizedXP;
          const hasStarted = actual > 0;
          return {
            ...data,
            normalizedXP,
            actual,
            diff,
            hasStarted
          };
        });

        // Filter
        const filteredSnapshots = enrichedSnapshots.filter(data => {
          if (fuelFilter !== 'all' && data.fuel !== fuelFilter) return false;
          if (scenarioFilter !== 'all' && data.scenario !== scenarioFilter) return false;
          if (riskFilter !== 'all' && data.riskMode !== riskFilter) return false;
          return true;
        });

        // Sort
        const sortedSnapshots = [...filteredSnapshots].sort((a, b) => {
          let res = 0;
          if (sortBy === 'actual') {
            res = b.actual - a.actual;
            if (res === 0) res = b.diff - a.diff; // tiebreak by beat
            if (res === 0) res = b.normalizedXP - a.normalizedXP; // tiebreak by xP
          } else if (sortBy === 'diff') {
            res = b.diff - a.diff;
            if (res === 0) res = b.actual - a.actual;
          } else if (sortBy === 'xp') {
            res = b.normalizedXP - a.normalizedXP;
            if (res === 0) res = b.actual - a.actual;
          } else if (sortBy === 'time') {
            res = (b.timestamp || 0) - (a.timestamp || 0);
          }
          return sortOrder === 'desc' ? res : -res;
        });

        return (
          <div key={gwId} className="bg-slate-950/40 border border-fpl-border rounded-2xl p-4 sm:p-5">
            {/* Header with Title & Refresh */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-white flex items-center gap-2">
                  <Award className="w-4 h-4 text-fpl-green" />
                  GAMEWEEK {gwId} PERFORMANCE
                </h3>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                  {sortedSnapshots.length} scenario{sortedSnapshots.length !== 1 ? 's' : ''}
                </span>
              </div>

              <button 
                onClick={() => refreshActuals(gwId)}
                disabled={loading[gwId]}
                className="text-[9px] font-black uppercase tracking-widest bg-fpl-purple hover:bg-fpl-purple/80 text-white px-3 py-1.5 rounded-lg transition-all shadow-md disabled:opacity-50 w-full sm:w-auto flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3 h-3" />
                {loading[gwId] ? 'FETCHING...' : 'REFRESH ACTUALS'}
              </button>
            </div>

            {/* 🎛️ Interactive Sorting & Filtering Control Bar */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 mb-5 p-2.5 sm:p-3 rounded-xl bg-slate-900/90 border border-slate-800/90 shadow-inner">
              
              {/* Sort Modes */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                  <ArrowUpDown className="w-3 h-3 text-emerald-400" /> Sort:
                </span>
                
                <button
                  onClick={() => {
                    if (sortBy === 'actual') {
                      setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('actual');
                      setSortOrder('desc');
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-mono font-bold transition-all border select-none",
                    sortBy === 'actual'
                      ? "bg-fpl-green text-slate-950 border-fpl-green font-black shadow-sm"
                      : "bg-slate-950/70 text-slate-300 border-slate-800 hover:text-white hover:border-slate-700"
                  )}
                  title="Sort by Actual Points scored"
                >
                  <Trophy className="w-3 h-3" />
                  <span>Actual Points</span>
                  {sortBy === 'actual' && (sortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 stroke-[3]" /> : <ArrowUp className="w-2.5 h-2.5 stroke-[3]" />)}
                </button>

                <button
                  onClick={() => {
                    if (sortBy === 'diff') {
                      setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('diff');
                      setSortOrder('desc');
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-mono font-bold transition-all border select-none",
                    sortBy === 'diff'
                      ? "bg-emerald-500 text-slate-950 border-emerald-500 font-black shadow-sm"
                      : "bg-slate-950/70 text-slate-300 border-slate-800 hover:text-white hover:border-slate-700"
                  )}
                  title="Sort by Beat vs Expected Points (Actual minus xP)"
                >
                  <TrendingUp className="w-3 h-3" />
                  <span>vs xP (Beat)</span>
                  {sortBy === 'diff' && (sortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 stroke-[3]" /> : <ArrowUp className="w-2.5 h-2.5 stroke-[3]" />)}
                </button>

                <button
                  onClick={() => {
                    if (sortBy === 'xp') {
                      setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('xp');
                      setSortOrder('desc');
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-mono font-bold transition-all border select-none",
                    sortBy === 'xp'
                      ? "bg-cyan-400 text-slate-950 border-cyan-400 font-black shadow-sm"
                      : "bg-slate-950/70 text-slate-300 border-slate-800 hover:text-white hover:border-slate-700"
                  )}
                  title="Sort by Projected Model Expected Points"
                >
                  <BarChart3 className="w-3 h-3" />
                  <span>Expected xP</span>
                  {sortBy === 'xp' && (sortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 stroke-[3]" /> : <ArrowUp className="w-2.5 h-2.5 stroke-[3]" />)}
                </button>

                <button
                  onClick={() => {
                    if (sortBy === 'time') {
                      setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('time');
                      setSortOrder('desc');
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-mono font-bold transition-all border select-none",
                    sortBy === 'time'
                      ? "bg-purple-400 text-slate-950 border-purple-400 font-black shadow-sm"
                      : "bg-slate-950/70 text-slate-300 border-slate-800 hover:text-white hover:border-slate-700"
                  )}
                  title="Sort by Snapshot Timestamp"
                >
                  <Clock className="w-3 h-3" />
                  <span>Time</span>
                  {sortBy === 'time' && (sortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 stroke-[3]" /> : <ArrowUp className="w-2.5 h-2.5 stroke-[3]" />)}
                </button>
              </div>

              {/* Filter Selectors */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                  <Filter className="w-3 h-3 text-slate-400" /> Filter:
                </span>

                {/* Model Filter */}
                <select
                  value={fuelFilter}
                  onChange={(e) => setFuelFilter(e.target.value)}
                  aria-label="Filter by model"
                  className="bg-slate-950 text-slate-200 border border-slate-800 text-[9px] font-mono font-bold rounded-lg px-2 py-1 focus:outline-none focus:border-fpl-green transition-colors cursor-pointer"
                >
                  <option value="all">All Models</option>
                  <option value="eye-test">Eye Test</option>
                  <option value="fplform">FPLForm</option>
                  <option value="native">Native FPL</option>
                </select>

                {/* Scenario Filter */}
                <select
                  value={scenarioFilter}
                  onChange={(e) => setScenarioFilter(e.target.value)}
                  aria-label="Filter by scenario"
                  className="bg-slate-950 text-slate-200 border border-slate-800 text-[9px] font-mono font-bold rounded-lg px-2 py-1 focus:outline-none focus:border-fpl-green transition-colors cursor-pointer"
                >
                  <option value="all">All Scenarios</option>
                  <option value="quant">Quant Optimal</option>
                  <option value="template">Risky Template Shield</option>
                </select>

                {/* Risk Tier Filter */}
                <select
                  value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value)}
                  aria-label="Filter by risk tier"
                  className="bg-slate-950 text-slate-200 border border-slate-800 text-[9px] font-mono font-bold rounded-lg px-2 py-1 focus:outline-none focus:border-fpl-green transition-colors cursor-pointer"
                >
                  <option value="all">All Tiers</option>
                  <option value="safe">Safe</option>
                  <option value="aggressive">Aggressive</option>
                  <option value="value">Value</option>
                </select>

                {/* Reset Filters button if any active */}
                {(fuelFilter !== 'all' || scenarioFilter !== 'all' || riskFilter !== 'all') && (
                  <button
                    onClick={() => {
                      setFuelFilter('all');
                      setScenarioFilter('all');
                      setRiskFilter('all');
                    }}
                    className="text-[8px] font-mono uppercase text-rose-400 hover:text-rose-300 underline ml-1"
                  >
                    Reset
                  </button>
                )}
              </div>

            </div>

            {/* Scenario Performance Cards Grid/List */}
            <div className="flex flex-col gap-3.5">
              {sortedSnapshots.length === 0 ? (
                <div className="text-center py-10 bg-slate-950/50 rounded-xl border border-slate-800/80">
                  <p className="text-slate-400 font-mono text-xs">No scenarios match your active filters.</p>
                  <button
                    onClick={() => {
                      setFuelFilter('all');
                      setScenarioFilter('all');
                      setRiskFilter('all');
                    }}
                    className="mt-2 text-[9px] font-mono font-bold text-fpl-green underline uppercase tracking-wider"
                  >
                    Clear Filters
                  </button>
                </div>
              ) : (
                sortedSnapshots.map((data, rankIndex) => {
                  const isExpanded = !!expandedModes[`${gwId}-${data.uniqueId}`];
                  const isTopOne = rankIndex === 0 && sortBy === 'actual' && data.actual > 0 && sortOrder === 'desc';
                  
                  const activeCaptainId = data.captainId && actualScores[gwId]?.[data.captainId]?.minutes === 0 
                    ? data.viceCaptainId 
                    : data.captainId;

                  return (
                    <div 
                      key={data.uniqueId} 
                      className={cn(
                        "relative bg-card-bg border rounded-xl p-4 transition-all duration-200 shadow-sm",
                        isTopOne 
                          ? "border-amber-400/60 bg-gradient-to-r from-amber-500/[0.06] via-card-bg to-card-bg shadow-[0_0_20px_rgba(251,191,36,0.12)]" 
                          : "border-fpl-border hover:border-slate-700"
                      )}
                    >
                      {/* Top Performer Badge */}
                      {isTopOne && (
                        <div className="absolute -top-2.5 right-4 z-10 bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 font-black text-[8px] sm:text-[9px] px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-md flex items-center gap-1">
                          <Trophy className="w-2.5 h-2.5 fill-slate-950" />
                          <span>#1 Top Performer</span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          
                          {/* Numerical Leaderboard Rank Badge */}
                          <span className={cn(
                            "text-[8.5px] font-mono font-black px-2 py-0.5 rounded-md border flex items-center gap-0.5",
                            rankIndex === 0 ? "bg-amber-400/20 text-amber-300 border-amber-400/40" :
                            rankIndex === 1 ? "bg-slate-300/20 text-slate-200 border-slate-300/40" :
                            rankIndex === 2 ? "bg-amber-700/20 text-amber-400 border-amber-700/40" :
                            "bg-slate-900 text-slate-500 border-slate-800"
                          )}>
                            {rankIndex === 0 ? '🥇 #1' : rankIndex === 1 ? '🥈 #2' : rankIndex === 2 ? '🥉 #3' : `#${rankIndex + 1}`}
                          </span>

                          {/* Fuel Source Badge */}
                          <span className={cn(
                            "text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border",
                            data.fuel === 'eye-test' ? "bg-amber-500/10 text-amber-400 border-amber-500/30" :
                            data.fuel === 'native' ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                            "bg-fpl-purple text-white border-fpl-purple/50 shadow-sm"
                          )}>
                            {data.fuelLabel}
                          </span>

                          {/* Scenario Strategy Badge */}
                          <span className={cn(
                            "text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded border",
                            data.scenario === 'template' ? "bg-rose-500/10 text-rose-400 border-rose-500/30" :
                            "bg-fpl-green/10 text-fpl-green border-fpl-green/30"
                          )}>
                            {data.scenarioLabel}
                          </span>

                          {/* Risk Tier Badge */}
                          <span className={cn(
                            "text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded",
                            data.riskMode === 'aggressive' ? "bg-orange-500/20 text-orange-400" : 
                            data.riskMode === 'value' ? "bg-cyan-500/20 text-cyan-400" : 
                            "bg-slate-800 text-slate-300"
                          )}>
                            {data.riskLabel}
                          </span>
                        </div>
                        
                        <button 
                          onClick={() => toggleExpand(gwId, data.uniqueId)}
                          className="text-[8px] text-slate-400 hover:text-white uppercase font-bold tracking-tighter transition-colors bg-slate-900 px-2 py-0.5 rounded border border-slate-800 hover:border-slate-700"
                        >
                          {isExpanded ? '[ HIDE SQUAD ]' : '[ VIEW SQUAD ]'}
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 sm:gap-6 bg-slate-950/40 p-2.5 rounded-lg border border-slate-900">
                        <div>
                          <p className="text-[8px] text-slate-500 uppercase font-medium">Expected</p>
                          <p className="text-sm sm:text-lg font-black text-white">{data.normalizedXP.toFixed(1)} <span className="text-[9px] sm:text-[10px] font-normal text-slate-500">xP</span></p>
                        </div>
                        
                        <div>
                          <p className="text-[8px] text-slate-500 uppercase font-medium">Actual</p>
                          <p className="text-sm sm:text-lg font-black text-white">
                            {actualScores[gwId] ? data.actual.toFixed(0) : '--'}
                            <span className="text-[9px] sm:text-[10px] font-normal text-slate-500 ml-1">pts</span>
                          </p>
                        </div>

                        <div className="flex flex-col justify-center">
                          {data.hasStarted ? (
                            <div className={cn(
                              "flex items-center gap-0.5 sm:gap-1 text-[9px] sm:text-[10px] font-black",
                              data.diff >= 0 ? "text-fpl-green" : "text-fpl-pink"
                            )}>
                              <TrendingUp className={cn("w-2.5 h-2.5 sm:w-3 sm:h-3", data.diff < 0 && "rotate-180")} />
                              {data.diff > 0 ? `+${data.diff.toFixed(1)}` : data.diff.toFixed(1)} <span className="hidden sm:inline">vs xP</span>
                            </div>
                          ) : (
                            <span className="text-[8px] text-slate-600 font-mono uppercase tracking-tighter">
                              {data.timestamp ? new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'No Time'}
                            </span>
                          )}
                        </div>
                      </div>

                      {isExpanded && data.players && (
                        <div className="mt-4 pt-4 border-t border-fpl-border grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                          {data.players.map((p: any) => (
                            <div key={p.id} className="flex justify-between items-center bg-slate-900/50 px-2 py-1 rounded border border-slate-800/50">
                              <div className="flex items-center gap-2">
                                <span className="text-[8px] text-slate-500 w-6 font-bold font-mono">{p.position}</span>
                                <span className={cn(
                                  "text-[10px] font-bold",
                                  p.id === data.captainId ? "text-fpl-green" : p.id === data.viceCaptainId ? "text-fpl-pink" : "text-slate-300"
                                )}>
                                  {p.web_name} {p.id === data.captainId && '(C)'} {p.id === data.viceCaptainId && '(V)'}
                                </span>
                              </div>
                              <span className="text-[9px] font-mono text-slate-400 font-bold">
                                {actualScores[gwId]?.[p.id] !== undefined ? `${actualScores[gwId][p.id].points}${p.id === activeCaptainId ? 'x2' : ''} pts` : '--'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
