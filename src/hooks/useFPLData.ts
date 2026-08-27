import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { RecommendationResponse, TeamSyncResponse, ScoredPlayer } from '../types';

export const useFPLData = (riskMode: 'safe' | 'aggressive' | 'value', fuel: 'fplform' | 'native' | 'eye-test', userId: string, authInitialized: boolean) => {
  const [data, setData] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string>('');
  const [syncedData, setSyncedData] = useState<TeamSyncResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [tier, setTier] = useState<string>('free');
  const [isTeamIdLocked, setIsTeamIdLocked] = useState(false);
  const [activeScenario, setActiveScenario] = useState<'quant' | 'template'>('quant');
  const [lockedPlayerIds, setLockedPlayerIds] = useState<number[]>([]);
  const [excludedPlayerIds, setExcludedPlayerIds] = useState<number[]>([]);

  const [history, setHistory] = useState<any>(() => {
    const saved = localStorage.getItem('fpl_optimizer_history');
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem('fpl_optimizer_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    fetchRecommendations();
  }, [riskMode, fuel, syncedData?.totalCost, syncedData?.bank, userId, authInitialized, activeScenario, lockedPlayerIds, excludedPlayerIds]);

  useEffect(() => {
    if (teamId && syncedData) {
      syncTeam();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskMode, fuel]);

  const effectiveSnapshotKey = teamId ? `team_${teamId.trim()}` : userId;

  // Load user tier and profile ONCE on login/auth init
  useEffect(() => {
    if (authInitialized && userId) {
      axios.get(`/api/user?userId=${userId}`)
        .then(res => setTier(res.data.tier))
        .catch(console.error);

      axios.get(`/api/user-profile?userId=${userId}`)
        .then(res => {
          if (res.data?.fplTeamId) {
            setTeamId(res.data.fplTeamId);
          }
          if (res.data?.isAdmin || res.data?.tier === 'admin') {
            setIsTeamIdLocked(false);
          } else if (res.data?.fplTeamId) {
            setIsTeamIdLocked(true);
          }
        })
        .catch(() => {});
    }
  }, [userId, authInitialized]);

  // Fetch backend performance snapshots when effectiveSnapshotKey changes
  useEffect(() => {
    if (authInitialized && userId) {
      const keyToFetch = effectiveSnapshotKey || userId;
      axios.get(`/api/snapshots?userId=${keyToFetch}`)
        .then(res => {
          const fetchedHistory = (res.data?.history && typeof res.data.history === 'object') ? res.data.history : {};
          setHistory(fetchedHistory);
          localStorage.setItem('fpl_optimizer_history', JSON.stringify(fetchedHistory));
        })
        .catch(err => console.warn("[Snapshots API] Backend fetch notice:", err));
    }
  }, [userId, authInitialized, effectiveSnapshotKey]);

  const toggleLock = (playerId: number) => {
    setExcludedPlayerIds(prev => prev.filter(id => id !== playerId));
    setLockedPlayerIds(prev => 
      prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]
    );
  };

  const toggleExclude = (playerId: number) => {
    setLockedPlayerIds(prev => prev.filter(id => id !== playerId));
    setExcludedPlayerIds(prev => 
      prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]
    );
  };

  const clearConstraints = () => {
    setLockedPlayerIds([]);
    setExcludedPlayerIds([]);
  };

  const fetchRecommendations = async () => {
    if (!authInitialized || !userId) return;
    setLoading(true);
    try {
      const budgetQuery = syncedData ? `&budget=${(syncedData.totalCost || 0) + (syncedData.bank || 0)}` : '';
      const scenarioQuery = `&scenario=${activeScenario}`;
      const lockedQuery = lockedPlayerIds.length > 0 ? `&locked=${lockedPlayerIds.join(',')}` : '';
      const excludedQuery = excludedPlayerIds.length > 0 ? `&excluded=${excludedPlayerIds.join(',')}` : '';
      
      const res = await axios.get(`/api/recommendations?riskMode=${riskMode}&fuel=${fuel}${budgetQuery}${scenarioQuery}${lockedQuery}${excludedQuery}&userId=${userId}&tier=${tier}`);
      if (res.data) {
        setData(res.data);
      }
      setError(null);
    } catch (err: any) {
      console.error("Fetch error:", err);
      setError(err.response?.data?.message || err.message || "Failed to load recommendations");
    } finally {
      setLoading(false);
    }
  };

  const takeSnapshot = async (
    gwId: number, 
    currentModeData: RecommendationResponse, 
    mode: 'safe' | 'aggressive' | 'value' = 'safe',
    currentFuel: 'fplform' | 'native' | 'eye-test' = 'fplform',
    currentScenario: 'quant' | 'template' = 'quant'
  ): Promise<boolean> => {
    if (!gwId || !currentModeData) {
      console.warn("[Snapshot] Missing GW ID or Data");
      return false;
    }
    
    const fuels: ('fplform' | 'native' | 'eye-test')[] = ['fplform', 'native', 'eye-test'];
    const scenarios: ('quant' | 'template')[] = ['quant', 'template'];
    const modes: ('safe' | 'aggressive' | 'value')[] = ['safe', 'aggressive', 'value'];

    const budgetQuery = syncedData ? `&budget=${(syncedData.totalCost || 0) + (syncedData.bank || 0)}` : '';
    const lockedQuery = lockedPlayerIds.length > 0 ? `&locked=${lockedPlayerIds.join(',')}` : '';
    const excludedQuery = excludedPlayerIds.length > 0 ? `&excluded=${excludedPlayerIds.join(',')}` : '';

    const newHistory = { ...history };
    const gwHistory = { ...(newHistory[gwId] || {}) };
    const now = Date.now();

    // 1. Immediately record current active view snapshot
    const activeSnapshotKey = `${currentFuel}_${currentScenario}_${mode}`;
    const activeSnapshotItem = {
      key: activeSnapshotKey,
      fuel: currentFuel,
      scenario: currentScenario,
      riskMode: mode,
      fuelLabel: currentFuel === 'eye-test' ? 'Eye Test' : currentFuel === 'native' ? 'Native FPL' : 'FPLForm',
      scenarioLabel: currentScenario === 'quant' ? 'Quant Optimal' : 'Risky Template Shield',
      riskLabel: mode.toUpperCase(),
      players: currentModeData.startingXI.map(p => ({
        id: p.id,
        web_name: p.web_name,
        score: p.score,
        position: p.position
      })),
      xP: currentModeData.expectedPoints,
      captainId: currentModeData.captain?.id,
      viceCaptainId: currentModeData.viceCaptain?.id,
      timestamp: now
    };

    gwHistory[activeSnapshotKey] = activeSnapshotItem;
    gwHistory[mode] = activeSnapshotItem;

    // 2. Fetch & record all 18 combinations in chunks to avoid overwhelming Vercel (504 Timeouts)
    const tasks: (() => Promise<any>)[] = [];
    for (const f of fuels) {
      for (const s of scenarios) {
        for (const m of modes) {
          if (f === currentFuel && s === currentScenario && m === mode) continue;
          tasks.push(() => 
            axios.get(`/api/recommendations?riskMode=${m}&fuel=${f}&scenario=${s}${budgetQuery}${lockedQuery}${excludedQuery}&userId=${userId}&tier=${tier}&skipComparison=true`)
              .then(res => ({ fuel: f, scenario: s, riskMode: m, data: res.data }))
              .catch(err => {
                console.warn(`[Snapshot] Notice generating ${f}_${s}_${m}:`, err.message);
                return null;
              })
          );
        }
      }
    }

    const results: any[] = [];
    const batchSize = 1;
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize).map(task => task());
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    }

    results.forEach(res => {
      if (res && res.data && res.data.startingXI) {
        const key = `${res.fuel}_${res.scenario}_${res.riskMode}`;
        const item = {
          key,
          fuel: res.fuel,
          scenario: res.scenario,
          riskMode: res.riskMode,
          fuelLabel: res.fuel === 'eye-test' ? 'Eye Test' : res.fuel === 'native' ? 'Native FPL' : 'FPLForm',
          scenarioLabel: res.scenario === 'quant' ? 'Quant Optimal' : 'Risky Template Shield',
          riskLabel: res.riskMode.toUpperCase(),
          players: res.data.startingXI.map((p: any) => ({
            id: p.id,
            web_name: p.web_name,
            score: p.score,
            position: p.position
          })),
          xP: res.data.expectedPoints,
          captainId: res.data.captain?.id,
          viceCaptainId: res.data.viceCaptain?.id,
          timestamp: now
        };
        gwHistory[key] = item;
      }
    });

    newHistory[gwId] = gwHistory;

    setHistory(newHistory);
    localStorage.setItem('fpl_optimizer_history', JSON.stringify(newHistory));

    // Persist to backend Firestore endpoint for cross-device access
    const keyToSave = effectiveSnapshotKey || userId;
    if (keyToSave) {
      axios.post('/api/snapshots', { userId: keyToSave, history: newHistory, season: '2026/27' })
        .catch(err => console.warn("[Snapshots API] Backend save notice:", err));
    }

    console.log(`[Snapshot] Saved complete 18-combination GW${gwId} matrix for ${keyToSave}`);
    return true;
  };

  const fetchLivePoints = async (gwId: number) => {
    try {
      const res = await axios.get(`/api/live/${gwId}`);
      return res.data.elements; // Array of { id, stats: { total_points } }
    } catch (err) {
      console.error("Live points fetch error:", err);
      return null;
    }
  };

  const syncTeam = async () => {
    if (!teamId) return;
    setSyncing(true);
    try {
      const res = await axios.get(`/api/sync/${teamId}?riskMode=${riskMode}&fuel=${fuel}&userId=${userId}&tier=${tier}`);
      setSyncedData(res.data);
      setError(null);

      // Fetch performance snapshots for the target teamId (allows Super Admin to inspect any team's history)
      axios.get(`/api/snapshots?userId=team_${teamId.trim()}`)
        .then(snapRes => {
          const fetchedHistory = (snapRes.data?.history && typeof snapRes.data.history === 'object') ? snapRes.data.history : {};
          setHistory(fetchedHistory);
          localStorage.setItem('fpl_optimizer_history', JSON.stringify(fetchedHistory));
        })
        .catch(err => console.warn("[Snapshots API] Fetch notice on sync:", err));

      return true;
    } catch (err: any) {
      setSyncedData(null);
      setError(err.response?.data?.error || "Failed to sync team. Check your Team ID.");
      return false;
    } finally {
      setSyncing(false);
    }
  };

  const formation = useMemo(() => {
    if (!data || !data.startingXI) return { def: [], mid: [], fwd: [], gkp: [] };
    const validXI = data.startingXI.filter((p): p is ScoredPlayer => !!p);
    return {
      def: validXI.filter(p => p.position === 'DEF'),
      mid: validXI.filter(p => p.position === 'MID'),
      fwd: validXI.filter(p => p.position === 'FWD'),
      gkp: validXI.filter(p => p.position === 'GKP'),
    };
  }, [data]);

  return {
    data,
    loading,
    error,
    teamId,
    setTeamId,
    syncedData,
    syncing,
    syncTeam,
    formation,
    refresh: fetchRecommendations,
    history,
    takeSnapshot,
    fetchLivePoints,
    tier,
    isTeamIdLocked,
    activeScenario,
    setActiveScenario,
    lockedPlayerIds,
    excludedPlayerIds,
    toggleLock,
    toggleExclude,
    clearConstraints
  };
};
