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

  const [history, setHistory] = useState<any>(() => {
    const saved = localStorage.getItem('fpl_optimizer_history');
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem('fpl_optimizer_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    fetchRecommendations();
  }, [riskMode, fuel, syncedData?.totalCost, syncedData?.bank, userId, authInitialized]);

  useEffect(() => {
    if (teamId && syncedData) {
      syncTeam();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskMode, fuel]);

  useEffect(() => {
    if (authInitialized && userId) {
      axios.get(`/api/user?userId=${userId}`)
        .then(res => setTier(res.data.tier))
        .catch(console.error);

      axios.get(`/api/user-profile?userId=${userId}`)
        .then(res => {
          if (res.data?.fplTeamId) {
            setTeamId(res.data.fplTeamId);
            setIsTeamIdLocked(true);
          }
        })
        .catch(() => {});
    }
  }, [userId, authInitialized]);

  const fetchRecommendations = async () => {
    if (!authInitialized || !userId) return;
    setLoading(true);
    try {
      const budgetQuery = syncedData ? `&budget=${(syncedData.totalCost || 0) + (syncedData.bank || 0)}` : '';
      const res = await axios.get(`/api/recommendations?riskMode=${riskMode}&fuel=${fuel}${budgetQuery}&userId=${userId}&tier=${tier}`);
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

  const takeSnapshot = (gwId: number, currentModeData: RecommendationResponse, mode: string) => {
    if (!gwId || !currentModeData) {
      console.warn("[Snapshot] Missing GW ID or Data");
      return false;
    }
    
    const newHistory = { ...history };
    const gwHistory = newHistory[gwId] || { safe: null, aggressive: null, value: null };
    
    newHistory[gwId] = {
      ...gwHistory,
      [mode]: {
        players: currentModeData.startingXI.map(p => ({
          id: p.id,
          web_name: p.web_name,
          score: p.score,
          position: p.position
        })),
        xP: currentModeData.expectedPoints,
        captainId: currentModeData.captain?.id,
        viceCaptainId: currentModeData.viceCaptain?.id,
        timestamp: Date.now()
      }
    };

    setHistory(newHistory);
    localStorage.setItem('fpl_optimizer_history', JSON.stringify(newHistory));
    console.log(`[Snapshot] Saved GW${gwId} [${mode}] with ${newHistory[gwId][mode].players.length} players`);
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
    isTeamIdLocked
  };
};
