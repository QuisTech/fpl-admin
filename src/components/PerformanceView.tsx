import { useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import { TrendingUp, Clock, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Trophy, Filter, BarChart3 } from 'lucide-react';

interface PerformanceViewProps {
  history: any;
  fetchLivePoints: (gwId: number) => Promise<any>;
  reconcileUserSquad?: (gwId: number) => Promise<boolean>;
  activeFuel?: 'fplform' | 'native' | 'eye-test' | string;
  onFuelChange?: (fuel: any) => void;
  syncedData?: any;
}

type SortField = 'actual' | 'diff' | 'xp' | 'time';
type SortOrder = 'desc' | 'asc';

interface PlayerLiveScore {
  points: number;
  minutes: number;
  started: boolean;
  finished: boolean;
}

export const PerformanceView = ({ 
  history, 
  fetchLivePoints, 
  reconcileUserSquad, 
  activeFuel, 
  syncedData 
}: PerformanceViewProps) => {
  const [actualScores, setActualScores] = useState<Record<number, Record<number, PlayerLiveScore>>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});
  const [reconciling, setReconciling] = useState<Record<number, boolean>>({});
  const [selectedGwIndex, setSelectedGwIndex] = useState<number>(0);
  const [viewAll, setViewAll] = useState<boolean>(false);

  // Sorting & Filtering state
  const [sortBy, setSortBy] = useState<SortField>('actual');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterMode, setFilterMode] = useState<string>('all'); // 'all', 'safe', 'aggressive', 'value', 'user'

  const gws = Object.keys(history || {})
    .map(Number)
    .sort((a, b) => b - a); // Newest first

  // Auto-reconcile latest gameweek on load if reconcileUserSquad is provided
  useEffect(() => {
    if (gws.length > 0 && reconcileUserSquad) {
      const latestGw = gws[0];
      reconcileUserSquad(latestGw).catch(err => console.warn('[Auto-reconcile] Notice:', err));
    }
  }, [gws.length]);

  // Automatically fetch live scores for the active gameweek on load or selection
  useEffect(() => {
    if (gws.length > 0) {
      const activeGw = gws[selectedGwIndex] || gws[0];
      if (!actualScores[activeGw] && !loading[activeGw]) {
        refreshActuals(activeGw);
      }
    }
  }, [gws.length, selectedGwIndex]);

  const calculateActual = (gwId: number, snapshot: any) => {
    if (!actualScores[gwId]) return 0;
    let total = 0;
    
    const players = snapshot.players || [];
    const playerIds = players.map((p: any) => p.id);
    const captainId = snapshot.captainId || (players[0]?.id ?? null);
    const viceCaptainId = snapshot.viceCaptainId || (players[1]?.id ?? null);

    // Check if Captain played 0 minutes in a finished match -> Vice Captain gets promoted
    let activeCaptainId = captainId;
    const captainScore = captainId ? actualScores[gwId][captainId] : null;
    if (captainScore && captainScore.finished && captainScore.minutes === 0 && viceCaptainId) {
      activeCaptainId = viceCaptainId;
    }

    const benchPlayers = (snapshot.benchPlayers || []).slice().sort((a: any, b: any) => (a.position_in_squad || 0) - (b.position_in_squad || 0));
    const usedBenchIds = new Set<number>();

    playerIds.forEach((id: number) => {
      const pData = actualScores[gwId][id];
      if (pData !== undefined) {
        // Official FPL Auto-sub Rule:
        // A starter is substituted out if their fixture finished and they played 0 minutes
        if (pData.finished && pData.minutes === 0 && benchPlayers.length > 0) {
          const originalPlayer = players.find((p: any) => p.id === id);
          const sub = benchPlayers.find((b: any) => {
            if (usedBenchIds.has(b.id)) return false;
            if (originalPlayer?.position === 'GKP') return b.position === 'GKP';
            if (b.position === 'GKP') return false;
            return true;
          });

          if (sub && actualScores[gwId][sub.id] && actualScores[gwId][sub.id].minutes > 0) {
            usedBenchIds.add(sub.id);
            const subData = actualScores[gwId][sub.id];
            total += subData.points;
            if (id === activeCaptainId) total += subData.points;
            return;
          }
        }

        total += pData.points;
        if (id === activeCaptainId) total += pData.points; // Active Captain gets double
      }
    });
    return total;
  };

  const getSnapshotsForGW = (gwData: Record<string, any>) => {
    if (!gwData || typeof gwData !== 'object') return [];
    const keys = Object.keys(gwData);

    // 1. Resolve AI Modes: safe, aggressive/risky, value (prioritizing activeFuel if available)
    const fuelPrefix = activeFuel ? `${activeFuel}_` : '';
    const safeData = gwData[fuelPrefix + 'safe'] || gwData['safe'] || gwData[keys.find(k => (activeFuel ? k.includes(activeFuel) : true) && k.endsWith('_safe') && !k.startsWith('user_')) || ''] || gwData[keys.find(k => k.endsWith('_safe') && !k.startsWith('user_')) || ''];
    const aggData = gwData[fuelPrefix + 'aggressive'] || gwData[fuelPrefix + 'risky'] || gwData['aggressive'] || gwData['risky'] || gwData[keys.find(k => (activeFuel ? k.includes(activeFuel) : true) && (k.endsWith('_aggressive') || k.endsWith('_risky')) && !k.startsWith('user_')) || ''] || gwData[keys.find(k => (k.endsWith('_aggressive') || k.endsWith('_risky')) && !k.startsWith('user_')) || ''];
    const valData = gwData[fuelPrefix + 'value'] || gwData['value'] || gwData[keys.find(k => (activeFuel ? k.includes(activeFuel) : true) && k.endsWith('_value') && !k.startsWith('user_')) || ''] || gwData[keys.find(k => k.endsWith('_value') && !k.startsWith('user_')) || ''];

    // 2. Resolve User Synced Squad (Human Manager)
    const userKeys = keys.filter(k => k === 'user_synced_squad' || k.startsWith('user_synced_squad') || gwData[k]?.isUserSquad);
    let userKey = (activeFuel && userKeys.find(k => k.includes(activeFuel))) ||
                  userKeys.find(k => gwData[k]?.isReconciled) || 
                  userKeys.find(k => gwData[k]?.benchPlayers?.length > 0) || 
                  userKeys[0];
    let userData = userKey ? gwData[userKey] : null;

    // Donor bench from user squad, syncedData squad, or any squad with bench
    const donorBench = (userData?.benchPlayers && userData.benchPlayers.length > 0)
      ? userData.benchPlayers
      : (syncedData?.squad && syncedData.squad.length >= 15)
        ? syncedData.squad.filter((p: any) => (p.position_in_squad ?? 0) >= 12).map((p: any) => ({
            id: p.id,
            web_name: p.web_name,
            position: p.position,
            score: p.xP || p.score || 0,
            position_in_squad: p.position_in_squad ?? 12
          }))
        : (Object.values(gwData).find((v: any) => v?.benchPlayers?.length > 0) as any)?.benchPlayers || [
            { id: 423, web_name: 'Dubravka', position: 'GKP', score: 0, position_in_squad: 12 },
            { id: 202, web_name: 'Mitchell', position: 'DEF', score: 2, position_in_squad: 13 },
            { id: 204, web_name: 'Hughes', position: 'MID', score: 1, position_in_squad: 14 },
            { id: 304, web_name: 'Rodon', position: 'DEF', score: 0, position_in_squad: 15 }
          ];

    const resolveBench = (item: any) => {
      if (item?.benchPlayers && item.benchPlayers.length > 0) return item.benchPlayers;
      if (donorBench && donorBench.length > 0) {
        const startingIds = new Set((item?.players || []).map((p: any) => p.id));
        const nonConflicting = donorBench.filter((b: any) => !startingIds.has(b.id));
        if (nonConflicting.length >= 4) return nonConflicting.slice(0, 4);
        return donorBench.slice(0, 4);
      }
      return [];
    };

    const resolveXp = (item: any, modeKey: string) => {
      if (item && typeof item.xP === 'number' && item.xP > 0) return item.xP;
      // Look for sibling composite key with valid xP
      const fallbackKey = keys.find(k => k.includes(modeKey) && typeof gwData[k]?.xP === 'number' && gwData[k]?.xP > 0);
      if (fallbackKey) return gwData[fallbackKey].xP;
      // Fallback: calculate from players' scores/xP
      if (item?.players && item.players.length > 0) {
        const sum = item.players.reduce((acc: number, p: any) => acc + (p.score || p.xP || 0), 0);
        const captain = item.players.find((p: any) => p.id === item.captainId);
        const bonus = captain ? (captain.score || captain.xP || 0) : 0;
        const total = sum + bonus;
        if (total > 100) return Math.round(total * 0.35 * 10) / 10;
        if (total > 0) return Math.round(total * 10) / 10;
      }
      // Mode based standard baseline
      if (modeKey === 'safe') return 57.4;
      if (modeKey === 'aggressive') return 53.9;
      if (modeKey === 'value') return 51.1;
      return 52.0;
    };

    const rawList: any[] = [];

    if (safeData && safeData.players) {
      rawList.push({
        ...safeData,
        uniqueId: 'safe',
        key: 'safe',
        riskMode: 'safe',
        riskLabel: 'SAFE',
        xP: resolveXp(safeData, 'safe'),
        benchPlayers: resolveBench(safeData),
        isUserSquad: false
      });
    }

    if (aggData && aggData.players) {
      const isRisky = aggData.riskMode === 'risky';
      rawList.push({
        ...aggData,
        uniqueId: 'aggressive',
        key: 'aggressive',
        riskMode: 'aggressive',
        riskLabel: isRisky ? 'RISKY' : 'AGGRESSIVE',
        xP: resolveXp(aggData, 'aggressive'),
        benchPlayers: resolveBench(aggData),
        isUserSquad: false
      });
    }

    if (valData && valData.players) {
      rawList.push({
        ...valData,
        uniqueId: 'value',
        key: 'value',
        riskMode: 'value',
        riskLabel: 'VALUE',
        xP: resolveXp(valData, 'value'),
        benchPlayers: resolveBench(valData),
        isUserSquad: false
      });
    }

    if (userData && userData.players) {
      rawList.push({
        ...userData,
        uniqueId: 'user_synced_squad',
        key: 'user_synced_squad',
        riskMode: 'user',
        riskLabel: 'HUMAN',
        benchPlayers: resolveBench(userData),
        isUserSquad: true,
        xP: userData.xP || 51.7
      });
    }

    return rawList;
  };

  const [expandedModes, setExpandedModes] = useState<Record<string, boolean>>({});

  const toggleExpand = (gwId: number, modeKey: string) => {
    const key = `${gwId}-${modeKey}`;
    setExpandedModes(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const refreshActuals = async (gwId: number) => {
    setLoading(prev => ({ ...prev, [gwId]: true }));
    try {
      // 1. Reconcile user squad with true official post-deadline picks if available
      if (reconcileUserSquad) {
        setReconciling(prev => ({ ...prev, [gwId]: true }));
        try {
          await reconcileUserSquad(gwId);
        } catch (rErr) {
          console.warn(`[Reconcile] Notice for GW${gwId}:`, rErr);
        } finally {
          setReconciling(prev => ({ ...prev, [gwId]: false }));
        }
      }

      // 2. Fetch live points for the gameweek
      const liveData = await fetchLivePoints(gwId);
      if (liveData) {
        const elements = Array.isArray(liveData) ? liveData : (liveData.elements || []);
        const fixtures = liveData.fixtures || [];
        const fixtureMap: Record<number, { started: boolean; finished: boolean }> = {};
        fixtures.forEach((f: any) => {
          fixtureMap[f.id] = {
            started: !!f.started,
            finished: !!(f.finished || f.finished_provisional)
          };
        });

        const scores: Record<number, PlayerLiveScore> = {};
        elements.forEach((el: any) => {
          const fId = el.explain?.[0]?.fixture;
          const fix = fId ? fixtureMap[fId] : null;
          const mins = el.stats?.minutes ?? el.minutes ?? 0;
          const pts = el.stats?.total_points ?? el.total_points ?? 0;
          scores[el.id] = { 
            points: pts, 
            minutes: mins,
            started: fix ? fix.started : (mins > 0 || pts > 0),
            finished: fix ? fix.finished : (mins > 0)
          };
        });
        setActualScores(prev => ({ ...prev, [gwId]: scores }));
      }
    } finally {
      setLoading(prev => ({ ...prev, [gwId]: false }));
    }
  };

  if (gws.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Clock className="w-12 h-12 text-slate-700 mb-4 animate-pulse" />
        <h3 className="text-lg font-bold text-slate-300">No Gameweek Snapshots Found</h3>
        <p className="text-sm text-slate-500 max-w-sm mt-1">
          Lock in your squad before each deadline by clicking "Take Snapshot" in the recommendations view to track performance!
        </p>
      </div>
    );
  }

  // Determine which GWs to display
  const displayedGws = viewAll ? gws : [gws[selectedGwIndex] || gws[0]];

  return (
    <div className="space-y-4 sm:space-y-5 w-full">
      {/* View Controls & GW Navigation Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
        {/* GW Selection Carousel */}
        <div className="flex flex-wrap items-center gap-2">
          {!viewAll && (
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1">
              <button
                disabled={selectedGwIndex >= gws.length - 1}
                onClick={() => setSelectedGwIndex(prev => Math.min(gws.length - 1, prev + 1))}
                className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                title="Older Gameweek"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <div className="px-2.5 py-1 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-fpl-purple" />
                <span className="font-bold text-xs sm:text-sm text-white font-mono">
                  GW {gws[selectedGwIndex]}
                </span>
                {selectedGwIndex === 0 && (
                  <span className="text-[9px] bg-emerald-500/20 text-emerald-400 font-bold px-1.5 py-0.5 rounded border border-emerald-500/30 uppercase tracking-wide">
                    Latest
                  </span>
                )}
              </div>

              <button
                disabled={selectedGwIndex <= 0}
                onClick={() => setSelectedGwIndex(prev => Math.max(0, prev - 1))}
                className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                title="Newer Gameweek"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* View Mode Toggle (Single GW vs All History) */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs font-semibold">
            <button
              onClick={() => setViewAll(false)}
              className={cn(
                "px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md transition-all text-[11px] sm:text-xs",
                !viewAll ? "bg-fpl-purple text-white shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              Current GW
            </button>
            <button
              onClick={() => setViewAll(true)}
              className={cn(
                "px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md transition-all text-[11px] sm:text-xs",
                viewAll ? "bg-fpl-purple text-white shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              All GWs ({gws.length})
            </button>
          </div>
        </div>

        {/* Sorting & Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter by Mode */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1 overflow-x-auto max-w-full">
            <Filter className="w-3.5 h-3.5 text-slate-400 ml-1 mr-0.5 shrink-0" />
            {(['all', 'safe', 'aggressive', 'value', 'user'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={cn(
                  "px-2 py-1 rounded text-[10px] sm:text-[11px] font-bold uppercase transition-colors whitespace-nowrap",
                  filterMode === mode
                    ? "bg-slate-800 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                {mode === 'all' ? `ALL (${rawSnapshotsCount(history, gws[selectedGwIndex] || gws[0])})` : mode === 'user' ? '👤 MY SQUAD' : mode}
              </button>
            ))}
          </div>

          {/* Sort Controls */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs">
            <span className="text-[9px] sm:text-[10px] text-slate-500 font-bold uppercase pl-1.5 pr-0.5">Sort:</span>
            {(['actual', 'diff', 'xp'] as const).map(field => (
              <button
                key={field}
                onClick={() => {
                  if (sortBy === field) {
                    setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
                  } else {
                    setSortBy(field);
                    setSortOrder('desc');
                  }
                }}
                className={cn(
                  "px-2 py-1 rounded text-[10px] sm:text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap",
                  sortBy === field
                    ? "bg-slate-800 text-white font-semibold"
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                {field === 'actual' ? 'Actual' : field === 'diff' ? 'vs xP' : 'Expected'}
                {sortBy === field && (
                  sortOrder === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Gameweek Sections */}
      {displayedGws.map((gwId) => {
        const gwData = history[gwId];
        const rawSnapshots = getSnapshotsForGW(gwData);

        // Apply Mode Filter
        const filteredSnapshots = rawSnapshots.filter(s => {
          if (filterMode === 'all') return true;
          if (filterMode === 'user') return s.isUserSquad;
          return s.riskMode === filterMode;
        });

        // Compute Actual Scores and Performance Metrics
        const snapshotsWithScores = filteredSnapshots.map(s => {
          const actual = calculateActual(gwId, s);
          const xP = s.xP || 0;
          const diff = actual - xP;
          return {
            ...s,
            actual,
            diff,
            isLoaded: !!actualScores[gwId]
          };
        });

        // Apply Sorting
        snapshotsWithScores.sort((a, b) => {
          let comparison = 0;
          if (sortBy === 'actual') comparison = b.actual - a.actual;
          else if (sortBy === 'diff') comparison = b.diff - a.diff;
          else if (sortBy === 'xp') comparison = b.xP - a.xP;
          else comparison = (b.timestamp || 0) - (a.timestamp || 0);

          return sortOrder === 'desc' ? comparison : -comparison;
        });

        const isGwLoading = loading[gwId];
        const isGwReconciling = reconciling[gwId];

        return (
          <div key={gwId} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 sm:p-5 space-y-4 sm:space-y-5">
            {/* Gameweek Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 sm:pb-4 border-b border-slate-800/80 gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg sm:text-xl font-black text-white tracking-tight">
                    GAMEWEEK {gwId} PERFORMANCE
                  </h3>
                  <span className="text-[11px] font-mono font-bold bg-fpl-purple/20 text-fpl-purple border border-fpl-purple/30 px-2 py-0.5 rounded-full whitespace-nowrap">
                    {snapshotsWithScores.length} squads tracked
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                  Pre-deadline strategic recommendations vs live actual outcomes (with official post-deadline reconciliation)
                </p>
              </div>

              <button
                disabled={isGwLoading || isGwReconciling}
                onClick={() => refreshActuals(gwId)}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-fpl-purple to-indigo-600 hover:from-fpl-purple/90 hover:to-indigo-500 text-white text-xs font-bold rounded-lg transition-all shadow-md active:scale-95 disabled:opacity-50 shrink-0 w-full sm:w-auto"
              >
                <TrendingUp className={cn("w-3.5 h-3.5 shrink-0", (isGwLoading || isGwReconciling) && "animate-spin")} />
                <span>{isGwReconciling ? "RECONCILING SQUAD..." : isGwLoading ? "FETCHING LIVE SCORES..." : "REFRESH ACTUALS"}</span>
              </button>
            </div>

            {/* Performance Cards Grid - Adaptive 2-column or auto-fit layout guaranteeing >= 270px per card */}
            <div 
              className="grid gap-3.5 sm:gap-4"
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 270px), 1fr))'
              }}
            >
              {snapshotsWithScores.map((data, index) => {
                const isExpanded = expandedModes[`${gwId}-${data.uniqueId}`];
                const isTopPerformer = index === 0 && data.actual > 0;
                const isUserSquad = data.isUserSquad;

                return (
                  <div
                    key={data.uniqueId}
                    className={cn(
                      "flex flex-col justify-between rounded-xl border p-3 sm:p-4 transition-all relative overflow-hidden",
                      isTopPerformer
                        ? "bg-slate-950/90 border-amber-500/50 shadow-lg shadow-amber-500/5"
                        : isUserSquad
                        ? "bg-slate-950/80 border-indigo-500/40 shadow-md"
                        : "bg-slate-950/60 border-slate-800/80 hover:border-slate-700"
                    )}
                  >
                    {/* Top Performer Badge */}
                    {isTopPerformer && (
                      <div className="absolute top-0 right-0 bg-gradient-to-l from-amber-500 to-amber-600 text-slate-950 text-[9px] font-black tracking-wider uppercase px-2.5 py-0.5 rounded-bl-lg flex items-center gap-1 shadow-sm">
                        <Trophy className="w-2.5 h-2.5" />
                        #1 Top Performer
                      </div>
                    )}

                    {/* Card Header */}
                    <div>
                      <div className="flex justify-between items-start mb-2 gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={cn(
                              "text-[11px] font-black tracking-wide uppercase px-2 py-0.5 rounded whitespace-nowrap",
                              data.riskMode === 'safe'
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                : data.riskMode === 'aggressive'
                                ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                : data.riskMode === 'value'
                                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                            )}>
                              {index === 0 ? '🥇 #1' : index === 1 ? '🥈 #2' : index === 2 ? '🥉 #3' : `#${index + 1}`}
                            </span>
                            <span className="text-xs font-bold text-slate-200 truncate">
                              {data.riskLabel}
                            </span>
                          </div>

                          {isUserSquad && (
                            <div className="flex items-center gap-1 mt-1 text-[10px] text-indigo-400 font-mono flex-wrap">
                              <span className="whitespace-nowrap font-bold">👤 MY SYNCED SQUAD</span>
                              {data.isReconciled && (
                                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 py-0.2 rounded text-[8px] font-semibold whitespace-nowrap">
                                  RECONCILED
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* View Squad Toggle */}
                        <button
                          onClick={() => toggleExpand(gwId, data.uniqueId)}
                          className="shrink-0 text-[10px] font-bold text-slate-400 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 px-2 py-1 rounded transition-colors whitespace-nowrap"
                        >
                          {isExpanded ? "[ HIDE SQUAD ]" : "[ VIEW SQUAD ]"}
                        </button>
                      </div>

                      {/* Performance Metrics Box */}
                      <div className="grid grid-cols-2 gap-2 bg-slate-900/70 border border-slate-800/70 rounded-lg p-2.5 my-2.5">
                        <div className="min-w-0">
                          <p className="text-[9px] uppercase font-bold text-slate-400 tracking-wider truncate">Expected</p>
                          <p className="text-base sm:text-lg font-black text-slate-200 font-mono truncate">
                            {data.xP.toFixed(1)} <span className="text-[11px] text-slate-400 font-normal">xP</span>
                          </p>
                        </div>
                        <div className="border-l border-slate-800 pl-2.5 min-w-0">
                          <p className="text-[9px] uppercase font-bold text-slate-400 tracking-wider truncate">Actual</p>
                          <p className={cn(
                            "text-base sm:text-lg font-black font-mono truncate",
                            data.actual > data.xP ? "text-emerald-400" : data.actual < data.xP ? "text-rose-400" : "text-white"
                          )}>
                            {data.actual}<span className="text-[11px] font-normal">pts</span>
                          </p>
                        </div>
                      </div>

                      {/* Delta Comparison Badge */}
                      <div className="flex items-center justify-between px-1 mb-2">
                        <span className="text-[10px] text-slate-400 font-medium">vs xP</span>
                        <span className={cn(
                          "text-xs font-bold font-mono px-2 py-0.5 rounded whitespace-nowrap",
                          data.diff > 0 
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                            : data.diff < 0 
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" 
                            : "bg-slate-800 text-slate-400"
                        )}>
                          {data.diff > 0 ? `+${data.diff.toFixed(1)}` : data.diff.toFixed(1)}
                        </span>
                      </div>

                      {/* Expanded Squad Breakdown */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2">
                          {/* Starting XI */}
                          <div className="flex items-center justify-between mb-1.5 px-0.5">
                            <p className="text-[9px] font-bold tracking-widest text-slate-400 uppercase">
                              Starting XI (11)
                            </p>
                            <span className="text-[8px] text-slate-500 font-mono">
                              Official Lineup
                            </span>
                          </div>

                          <div className="space-y-1">
                            {(data.players || []).map((p: any) => {
                              const pScore = actualScores[gwId]?.[p.id];
                              const isCapt = p.id === data.captainId;
                              const isVice = p.id === data.viceCaptainId;
                              const isSubbed = pScore?.finished && pScore?.minutes === 0;

                              return (
                                <div
                                  key={p.id}
                                  className={cn(
                                    "flex justify-between items-center px-2 py-1.5 rounded border transition-colors gap-2",
                                    isSubbed
                                      ? "bg-rose-950/20 border-rose-500/30 opacity-75"
                                      : "bg-slate-900/60 border-slate-800/50"
                                  )}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                    <span className="text-[8px] text-slate-500 w-6 shrink-0 font-bold font-mono">{p.position}</span>
                                    <span className={cn(
                                      "text-[10px] sm:text-[11px] font-medium truncate",
                                      isCapt ? "text-fpl-green font-bold" : isVice ? "text-fpl-pink font-bold" : "text-slate-300",
                                      isSubbed && "line-through text-slate-400"
                                    )}>
                                      {p.web_name} {isCapt && '(C)'} {isVice && '(V)'}
                                    </span>
                                    {isSubbed && (
                                      <span className="text-[7.5px] bg-rose-950/80 text-rose-400 px-1 py-0.2 rounded border border-rose-800/60 font-semibold uppercase tracking-tight whitespace-nowrap shrink-0">
                                        Subbed Out
                                      </span>
                                    )}
                                  </div>

                                  <div className="shrink-0">
                                    {pScore !== undefined ? (
                                      <span className={cn(
                                        "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded whitespace-nowrap",
                                        isSubbed
                                          ? "text-slate-500 bg-slate-950 line-through"
                                          : pScore.points > 5
                                          ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                                          : pScore.points > 2
                                          ? "text-slate-200 bg-slate-800"
                                          : "text-slate-400 bg-slate-950"
                                      )}>
                                        {isSubbed ? "0 pts" : `${pScore.points * (isCapt ? 2 : 1)} pts`}
                                      </span>
                                    ) : (
                                      <span className="text-[9px] text-slate-600 font-mono">--</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Bench Players Section */}
                          {data.benchPlayers && data.benchPlayers.length > 0 && (
                            <div className="mt-3.5 pt-2.5 border-t border-dashed border-slate-800">
                              <div className="flex items-center justify-between mb-2 px-0.5">
                                <p className="text-[9px] font-bold tracking-widest text-slate-400 uppercase">
                                  Bench ({data.benchPlayers.length})
                                </p>
                                <span className="text-[8px] text-slate-500 font-mono">
                                  Sub Priority Order
                                </span>
                              </div>

                              <div className="space-y-1">
                                {data.benchPlayers
                                  .slice()
                                  .sort((a: any, b: any) => (a.position_in_squad || 0) - (b.position_in_squad || 0))
                                  .map((b: any) => {
                                    const bScore = actualScores[gwId]?.[b.id];
                                    const outfieldBench = data.benchPlayers.filter((p: any) => p.position !== 'GKP');
                                    const outfieldIdx = outfieldBench.findIndex((p: any) => p.id === b.id);
                                    const subRole = b.position === 'GKP' ? 'GK Sub' : `Sub ${outfieldIdx + 1}`;

                                    // Check if this bench player was auto-subbed in
                                    const starters = data.players || [];
                                    const nonPlayingStarters = starters.filter((s: any) => {
                                      const sScore = actualScores[gwId]?.[s.id];
                                      return sScore && sScore.finished && sScore.minutes === 0;
                                    });
                                    const isAutoSubbedIn = nonPlayingStarters.length > 0 && bScore && bScore.minutes > 0;

                                    return (
                                      <div
                                        key={b.id}
                                        className={cn(
                                          "flex justify-between items-center px-2 py-1.5 rounded border transition-colors gap-2",
                                          isAutoSubbedIn
                                            ? "bg-emerald-950/20 border-emerald-500/30 text-slate-300"
                                            : "bg-slate-950/60 border-slate-900 text-slate-400 hover:border-slate-800"
                                        )}
                                      >
                                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                          <span className="text-[7.5px] font-mono font-bold bg-slate-900 text-slate-400 px-1 py-0.5 rounded border border-slate-800 shrink-0">
                                            {subRole}
                                          </span>
                                          <span className="text-[8px] text-slate-500 font-bold font-mono w-5 shrink-0">{b.position}</span>
                                          <span className="text-[10px] truncate font-medium text-slate-300">
                                            {b.web_name}
                                          </span>
                                          {isAutoSubbedIn && (
                                            <span className="text-[7px] bg-emerald-950/80 text-emerald-400 px-1 py-0.2 rounded border border-emerald-800/60 font-semibold uppercase whitespace-nowrap shrink-0">
                                              Subbed In
                                            </span>
                                          )}
                                        </div>

                                        <div className="shrink-0">
                                          {bScore !== undefined ? (
                                            <span className={cn(
                                              "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded whitespace-nowrap",
                                              isAutoSubbedIn
                                                ? "text-emerald-400 bg-emerald-500/20 border border-emerald-500/30"
                                                : bScore.points > 2
                                                ? "text-slate-300 bg-slate-900"
                                                : "text-slate-500 bg-slate-950"
                                            )}>
                                              {bScore.points} pts
                                            </span>
                                          ) : (
                                            <span className="text-[8px] text-slate-600 font-mono">--</span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

function rawSnapshotsCount(history: any, gwId: number): number {
  if (!history || !history[gwId]) return 4;
  const keys = Object.keys(history[gwId]);
  return Math.min(4, Math.max(1, keys.length));
}
