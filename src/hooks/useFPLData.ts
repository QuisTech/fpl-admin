import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { RecommendationResponse, TeamSyncResponse, ScoredPlayer } from '../types';

export const sanitizeHistory = (raw: any): Record<string, any> => {
  if (!raw || typeof raw !== 'object') return {};
  const cleanHistory: Record<string, any> = {};
  Object.keys(raw).forEach(gw => {
    const gwObj = raw[gw];
    if (gwObj && typeof gwObj === 'object') {
      const keys = Object.keys(gwObj);
      const hasComposite = keys.some(k => k.includes('_'));
      if (hasComposite) {
        const cleanGw: Record<string, any> = {};
        keys.forEach(k => {
          if (!['safe', 'aggressive', 'value'].includes(k)) {
            cleanGw[k] = gwObj[k];
          }
        });
        cleanHistory[gw] = cleanGw;
      } else {
        cleanHistory[gw] = gwObj;
      }
    }
  });
  return cleanHistory;
};

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
    try {
      const saved = localStorage.getItem('fpl_optimizer_history');
      return saved ? sanitizeHistory(JSON.parse(saved)) : {};
    } catch {
      return {};
    }
  });

  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    localStorage.setItem('fpl_optimizer_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    const controller = new AbortController();
    fetchRecommendations(controller.signal);
    return () => {
      controller.abort();
    };
  }, [riskMode, fuel, syncedData?.totalCost, syncedData?.bank, userId, authInitialized, activeScenario, lockedPlayerIds, excludedPlayerIds]);

  useEffect(() => {
    if (teamId && syncedData) {
      syncTeam();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskMode, fuel]);

  // Load user tier and profile ONCE on login/auth init
  useEffect(() => {
    if (authInitialized && userId) {
      axios.get(`/api/user-profile?userId=${userId}`)
        .then(res => {
          if (res.data?.tier) {
            setTier(res.data.tier);
          }
          if (res.data?.fplTeamId) {
            setTeamId(res.data.fplTeamId);
          }
          if (res.data?.isAdmin || res.data?.tier === 'admin') {
            setIsTeamIdLocked(false);
          } else if (res.data?.fplTeamId) {
            setIsTeamIdLocked(true);
          }
          setProfileLoaded(true);
        })
        .catch(() => {
          setProfileLoaded(true);
        });
    }
  }, [userId, authInitialized]);

  // Fetch backend performance snapshots once profile is loaded or teamId changes
  useEffect(() => {
    if (authInitialized && userId && profileLoaded) {
      const keyToFetch = teamId ? `team_${teamId.trim()}` : userId;
      axios.get(`/api/snapshots?userId=${keyToFetch}`)
        .then(res => {
          const rawHistory = (res.data?.history && typeof res.data.history === 'object') ? res.data.history : {};
          const sanitized = sanitizeHistory(rawHistory);
          setHistory(sanitized);
          localStorage.setItem('fpl_optimizer_history', JSON.stringify(sanitized));
        })
        .catch(err => console.warn("[Snapshots API] Backend fetch notice:", err));
    }
  }, [userId, authInitialized, profileLoaded, teamId]);

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

  const fetchRecommendations = async (signal?: AbortSignal) => {
    if (!authInitialized || !userId) return;
    setLoading(true);
    try {
      const budgetQuery = syncedData ? `&budget=${(syncedData.totalCost || 0) + (syncedData.bank || 0)}` : '';
      const scenarioQuery = `&scenario=${activeScenario}`;
      const lockedQuery = lockedPlayerIds.length > 0 ? `&locked=${lockedPlayerIds.join(',')}` : '';
      const excludedQuery = excludedPlayerIds.length > 0 ? `&excluded=${excludedPlayerIds.join(',')}` : '';
      
      const res = await axios.get(
        `/api/recommendations?riskMode=${riskMode}&fuel=${fuel}${budgetQuery}${scenarioQuery}${lockedQuery}${excludedQuery}&userId=${userId}&tier=${tier}`,
        { signal }
      );
      if (res.data) {
        setData(res.data);
      }
      setError(null);
    } catch (err: any) {
      if (axios.isCancel(err) || err.name === 'CanceledError' || err.name === 'AbortError') {
        return;
      }
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
      benchPlayers: (currentModeData.bench || []).map(p => ({
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

    // 2. Fetch & record all 18 combinations in concurrent batches (accelerated by backend memoization)
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
    const batchSize = 4;
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
          benchPlayers: (res.data.bench || []).map((p: any) => ({
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

    // Record user's real synced squad across all 3 fuels (fplform, native, eye-test)
    if (syncedData && syncedData.squad && syncedData.squad.length >= 11) {
      const fuelsToEval: Array<'fplform' | 'native' | 'eye-test'> = ['fplform', 'native', 'eye-test'];
      
      const syncFuelPromises = fuelsToEval.map(f => {
        if (f === currentFuel && syncedData) {
          return Promise.resolve({ fuel: f, squad: syncedData.squad, managerInfo: syncedData.managerInfo });
        }
        if (!teamId) {
          return Promise.resolve({ fuel: f, squad: syncedData.squad, managerInfo: syncedData.managerInfo });
        }
        return axios.get(`/api/sync/${teamId}?riskMode=${mode}&fuel=${f}&userId=${userId}&tier=${tier}`)
          .then(res => ({ fuel: f, squad: res.data?.squad, managerInfo: res.data?.managerInfo }))
          .catch(err => {
            console.warn(`[Snapshot] Notice syncing squad for ${f}:`, err.message);
            return { fuel: f, squad: syncedData.squad, managerInfo: syncedData.managerInfo };
          });
      });

      const syncedResults = await Promise.all(syncFuelPromises);

      syncedResults.forEach(({ fuel: f, squad, managerInfo }) => {
        if (!squad || squad.length < 11) return;
        const startingXI = squad.filter((p: any) => (p.position_in_squad ?? 0) <= 11);
        const bench = squad.filter((p: any) => (p.position_in_squad ?? 0) >= 12);
        const captain = squad.find((p: any) => p.isCaptain || p.is_captain) || (startingXI.length > 0 ? startingXI[0] : null);
        const viceCaptain = squad.find((p: any) => p.isViceCaptain || p.is_vice_captain);
        const captainBonus = captain ? (captain.xP || 0) : 0;
        const startingTotalXp = startingXI.reduce((sum: number, p: any) => sum + (p.xP || 0), 0) + captainBonus;

        const userKey = `user_synced_squad_${f}`;
        gwHistory[userKey] = {
          key: userKey,
          fuel: f,
          fuelLabel: f === 'eye-test' ? 'Eye Test' : f === 'native' ? 'Native FPL' : 'FPLForm',
          scenario: 'user',
          scenarioLabel: managerInfo?.teamName || syncedData.managerInfo?.teamName || 'Synced FPL Squad',
          riskLabel: 'HUMAN',
          isUserSquad: true,
          players: startingXI.map((p: any) => ({
            id: p.id,
            web_name: p.web_name,
            score: p.xP || p.score || 0,
            position: p.position
          })),
          benchPlayers: bench.map((p: any) => ({
            id: p.id,
            web_name: p.web_name,
            score: p.xP || p.score || 0,
            position: p.position,
            position_in_squad: p.position_in_squad
          })),
          xP: Math.round(startingTotalXp * 10) / 10,
          captainId: captain?.id,
          viceCaptainId: viceCaptain?.id,
          timestamp: now
        };
      });

      // Remove any legacy un-suffixed key
      delete gwHistory['user_synced_squad'];
    }

    // Purge legacy single-mode keys so they do not pollute Firestore or localStorage
    delete gwHistory['safe'];
    delete gwHistory['aggressive'];
    delete gwHistory['value'];

    newHistory[gwId] = gwHistory;
    const sanitizedHistory = sanitizeHistory(newHistory);

    setHistory(sanitizedHistory);
    localStorage.setItem('fpl_optimizer_history', JSON.stringify(sanitizedHistory));

    // Persist to backend Firestore endpoint for cross-device access
    const keyToSave = teamId ? `team_${teamId.trim()}` : userId;
    if (keyToSave) {
      axios.post('/api/snapshots', { userId: keyToSave, history: sanitizedHistory, season: '2026/27' })
        .catch(err => console.warn("[Snapshots API] Backend save notice:", err));
    }

    console.log(`[Snapshot] Saved complete 18-combination GW${gwId} matrix for ${keyToSave}`);
    return true;
  };

  const fetchLivePoints = async (gwId: number) => {
    try {
      const res = await axios.get(`/api/live/${gwId}`);
      return res.data; // Returns { elements, fixtures }
    } catch (err) {
      console.error("Live points fetch error:", err);
      return null;
    }
  };

  const reconcileUserSquad = async (gwId: number): Promise<boolean> => {
    if (!teamId) return false;
    try {
      // Query official FPL picks specifically for this gameweek (unlocked after deadline)
      const res = await axios.get(`/api/sync/${teamId.trim()}?gw=${gwId}&riskMode=${riskMode}&fuel=${fuel}&userId=${userId}&tier=${tier}`);
      const squad = res.data?.squad;
      const managerInfo = res.data?.managerInfo;
      if (!squad || squad.length < 11) return false;

      const startingXI = squad.filter((p: any) => (p.position_in_squad ?? 0) <= 11);
      const bench = squad.filter((p: any) => (p.position_in_squad ?? 0) >= 12);
      const captain = squad.find((p: any) => p.isCaptain || p.is_captain) || (startingXI.length > 0 ? startingXI[0] : null);
      const viceCaptain = squad.find((p: any) => p.isViceCaptain || p.is_vice_captain);
      const captainBonus = captain ? (captain.xP || 0) : 0;
      const startingTotalXp = startingXI.reduce((sum: number, p: any) => sum + (p.xP || 0), 0) + captainBonus;

      const now = Date.now();
      const currentHistory = { ...history };
      const gwHistory = { ...(currentHistory[gwId] || {}) };

      const fuelsToEval: Array<'fplform' | 'native' | 'eye-test'> = ['fplform', 'native', 'eye-test'];
      fuelsToEval.forEach(f => {
        const userKey = `user_synced_squad_${f}`;
        const existing = gwHistory[userKey];
        gwHistory[userKey] = {
          ...(existing || {}),
          key: userKey,
          fuel: f,
          fuelLabel: f === 'eye-test' ? 'Eye Test' : f === 'native' ? 'Native FPL' : 'FPLForm',
          scenario: 'user',
          scenarioLabel: managerInfo?.teamName || existing?.scenarioLabel || 'Synced FPL Squad',
          riskLabel: 'HUMAN',
          isUserSquad: true,
          players: startingXI.map((p: any) => ({
            id: p.id,
            web_name: p.web_name,
            score: p.xP || p.score || 0,
            position: p.position
          })),
          benchPlayers: bench.map((p: any) => ({
            id: p.id,
            web_name: p.web_name,
            score: p.xP || p.score || 0,
            position: p.position,
            position_in_squad: p.position_in_squad
          })),
          xP: Math.round(startingTotalXp * 10) / 10,
          captainId: captain?.id,
          viceCaptainId: viceCaptain?.id,
          timestamp: now,
          isReconciled: true
        };
      });

      currentHistory[gwId] = gwHistory;
      const sanitized = sanitizeHistory(currentHistory);
      setHistory(sanitized);
      localStorage.setItem('fpl_optimizer_history', JSON.stringify(sanitized));

      const keyToSave = teamId ? `team_${teamId.trim()}` : userId;
      if (keyToSave) {
        axios.post('/api/snapshots', { userId: keyToSave, history: sanitized, season: '2026/27' })
          .catch(err => console.warn("[Snapshots API] Reconcile save notice:", err));
      }

      console.log(`[Reconcile] Successfully updated GW${gwId} user squad with official FPL picks for ${keyToSave}`);
      return true;
    } catch (err: any) {
      console.warn(`[Reconcile] Could not reconcile GW${gwId} picks (gameweek may not have deadline passed):`, err.message);
      return false;
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
          const rawHistory = (snapRes.data?.history && typeof snapRes.data.history === 'object') ? snapRes.data.history : {};
          const sanitized = sanitizeHistory(rawHistory);
          setHistory(sanitized);
          localStorage.setItem('fpl_optimizer_history', JSON.stringify(sanitized));
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
    reconcileUserSquad,
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
