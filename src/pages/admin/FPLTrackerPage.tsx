import { useState, useEffect } from 'react';
import { 
  Trophy, 
  RefreshCw, 
  Search, 
  ExternalLink, 
  Sparkles, 
  ShieldCheck, 
  Flame, 
  Coins, 
  Eye, 
  TrendingUp, 
  Layers 
} from 'lucide-react';
import { auth } from '../../lib/firebase';
import { cn } from '../../lib/utils';

interface TrackedAccount {
  email: string;
  teamId: number;
  mode: string;
  label: string;
  group: string;
  teamName: string;
  managerName: string;
  overallPoints: number;
  overallRank: number | null;
  gwPoints: number;
  gwRank: number | null;
  lastGw: number | null;
  status: 'active' | 'error';
  error?: string;
}

export function FPLTrackerPage() {
  const [accounts, setAccounts] = useState<TrackedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'points' | 'rank' | 'gwPoints' | 'teamId'>('points');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchTrackerData = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMsg(null);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("You must be logged in as an admin to view this tracker.");
      }
      const token = await currentUser.getIdToken();
      
      const res = await fetch('/api/admin/fpl-tracker', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch FPL account tracker data');
      }

      const data = await res.json();
      setAccounts(data.trackedAccounts || []);
    } catch (err: any) {
      console.error("Error fetching tracker data:", err);
      setErrorMsg(err.message || "Failed to load tracked FPL accounts.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTrackerData();
  }, []);

  const groups = ['all', 'FPLForm', 'Eye-Test', 'Native FPL', 'Strategist', 'Optimizer', 'Horizon Flagship'];

  // Filtering
  const filteredAccounts = accounts.filter(acc => {
    const matchesSearch = 
      acc.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      acc.teamId.toString().includes(searchTerm) ||
      acc.mode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      acc.teamName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      acc.label.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesGroup = selectedGroup === 'all' || acc.group === selectedGroup;

    return matchesSearch && matchesGroup;
  });

  // Sorting
  const sortedAccounts = [...filteredAccounts].sort((a, b) => {
    if (sortBy === 'points') return b.overallPoints - a.overallPoints;
    if (sortBy === 'gwPoints') return b.gwPoints - a.gwPoints;
    if (sortBy === 'rank') {
      if (a.overallRank === null) return 1;
      if (b.overallRank === null) return -1;
      return a.overallRank - b.overallRank;
    }
    if (sortBy === 'teamId') return a.teamId - b.teamId;
    return 0;
  });

  // Calculations for KPI Cards
  const activeCount = accounts.filter(a => a.status === 'active').length;
  const topScoringAccount = accounts.length > 0 ? [...accounts].sort((a, b) => b.overallPoints - a.overallPoints)[0] : null;
  const bestRankAccount = accounts.filter(a => a.overallRank).sort((a, b) => (a.overallRank || Infinity) - (b.overallRank || Infinity))[0];
  const avgPoints = accounts.length > 0 
    ? Math.round(accounts.reduce((sum, a) => sum + (a.overallPoints || 0), 0) / accounts.length) 
    : 0;

  const getModeBadge = (mode: string) => {
    if (mode.includes('safe') || mode.includes('s-m') || mode.includes('s-mode')) {
      return (
        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <ShieldCheck className="w-2.5 h-2.5" /> Safe Mode
        </span>
      );
    }
    if (mode.includes('risky') || mode.includes('r-m') || mode.includes('risky-mode')) {
      return (
        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Flame className="w-2.5 h-2.5" /> Risky Mode
        </span>
      );
    }
    if (mode.includes('value') || mode.includes('value-mode')) {
      return (
        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
          <Coins className="w-2.5 h-2.5" /> Value Mode
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
        {mode}
      </span>
    );
  };

  const getGroupBadge = (group: string) => {
    const groupStyles: Record<string, string> = {
      'FPLForm': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      'Eye-Test': 'bg-blue-500/10 text-blue-400 border-blue-500/30',
      'Native FPL': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      'Strategist': 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
      'Optimizer': 'bg-pink-500/10 text-pink-400 border-pink-500/30',
      'Horizon Flagship': 'bg-fpl-green/10 text-fpl-green border-fpl-green/30 font-black'
    };
    return (
      <span className={cn("text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border", groupStyles[group] || "bg-slate-800 text-slate-400 border-slate-700")}>
        {group}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="w-6 h-6 text-fpl-green" />
            <h1 className="text-2xl font-black tracking-tight text-white uppercase">
              FPL Test Accounts Performance Tracker
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Live Gameweek and Overall Points monitor for all 14 official FPLHorizon engine benchmark accounts.
          </p>
        </div>

        <button
          onClick={() => fetchTrackerData(true)}
          disabled={refreshing || loading}
          className="inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold px-4 py-2.5 rounded-xl transition-all disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 text-fpl-green", refreshing && "animate-spin")} />
          {refreshing ? 'Refreshing Live Points...' : 'Sync Live FPL API'}
        </button>
      </div>

      {errorMsg && (
        <div className="p-4 bg-rose-950/40 border border-rose-500/50 rounded-xl text-rose-300 text-xs font-semibold">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 relative overflow-hidden">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Tracked Accounts</div>
          <div className="text-2xl font-black text-white flex items-baseline gap-2">
            {accounts.length}
            <span className="text-xs font-bold text-emerald-400">({activeCount} Live)</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">14 Benchmarked Models</div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 relative overflow-hidden">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Top Leader Account</div>
          <div className="text-2xl font-black text-fpl-green truncate">
            {topScoringAccount ? `${topScoringAccount.overallPoints} pts` : '—'}
          </div>
          <div className="text-[10px] text-slate-400 truncate mt-1">
            {topScoringAccount ? `${topScoringAccount.teamName} (${topScoringAccount.label})` : 'Calculating...'}
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 relative overflow-hidden">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Best Overall Rank</div>
          <div className="text-2xl font-black text-cyan-400">
            {bestRankAccount?.overallRank ? `#${bestRankAccount.overallRank.toLocaleString()}` : '—'}
          </div>
          <div className="text-[10px] text-slate-400 truncate mt-1">
            {bestRankAccount ? bestRankAccount.label : 'N/A'}
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 relative overflow-hidden">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Average Account Total</div>
          <div className="text-2xl font-black text-amber-400">{avgPoints} pts</div>
          <div className="text-[10px] text-slate-500 mt-1">Across all strategy modes</div>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="flex flex-col md:flex-row gap-3 justify-between items-stretch md:items-center bg-slate-950/40 p-3 rounded-2xl border border-slate-800">
        {/* Group Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar pb-1 md:pb-0">
          {groups.map((group) => (
            <button
              key={group}
              onClick={() => setSelectedGroup(group)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all shrink-0",
                selectedGroup === group
                  ? "bg-fpl-green text-slate-950 shadow-md"
                  : "bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800"
              )}
            >
              {group === 'all' ? 'All Accounts (14)' : group}
            </button>
          ))}
        </div>

        {/* Search Input and Sort Selection */}
        <div className="flex items-center gap-2">
          <div className="relative flex-grow md:w-56">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search email, ID, mode..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-fpl-green/50"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-slate-900 border border-slate-800 text-slate-300 text-xs font-bold rounded-xl px-3 py-1.5 focus:outline-none focus:border-fpl-green/50"
          >
            <option value="points">Sort by Overall Points</option>
            <option value="gwPoints">Sort by GW Points</option>
            <option value="rank">Sort by Overall Rank</option>
            <option value="teamId">Sort by Team ID</option>
          </select>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500 space-y-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-fpl-green"></div>
            <p className="text-xs font-bold">Querying Official FPL API for all 14 benchmark accounts...</p>
          </div>
        ) : sortedAccounts.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs font-semibold">
            No tracked accounts match your search filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/80 border-b border-slate-800 text-[10px] font-black uppercase text-slate-400 tracking-wider">
                  <th className="py-3.5 px-4">#</th>
                  <th className="py-3.5 px-4">Account Email & ID</th>
                  <th className="py-3.5 px-4">FPL Team Name & Manager</th>
                  <th className="py-3.5 px-4">Fuel & Strategy Mode</th>
                  <th className="py-3.5 px-4 text-right">Latest GW Points</th>
                  <th className="py-3.5 px-4 text-right">Overall Points</th>
                  <th className="py-3.5 px-4 text-right">Overall Rank</th>
                  <th className="py-3.5 px-4 text-center">FPL Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {sortedAccounts.map((acc, index) => {
                  const isTopRank = index === 0;
                  return (
                    <tr 
                      key={acc.teamId}
                      className={cn(
                        "hover:bg-slate-900/50 transition-colors group",
                        isTopRank && "bg-fpl-green/5"
                      )}
                    >
                      {/* Rank Index */}
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-500 text-[11px]">
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                      </td>

                      {/* Account Email & Team ID */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-200 group-hover:text-fpl-green transition-colors">{acc.email}</span>
                          <span className="text-[10px] font-mono text-slate-500">ID: {acc.teamId}</span>
                        </div>
                      </td>

                      {/* Team Name & Manager */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-white">{acc.teamName}</span>
                          <span className="text-[10px] text-slate-400">{acc.managerName || '—'}</span>
                        </div>
                      </td>

                      {/* Fuel & Strategy Mode */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col items-start gap-1">
                          {getGroupBadge(acc.group)}
                          {getModeBadge(acc.mode)}
                        </div>
                      </td>

                      {/* Latest GW Points */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-300">
                        {acc.gwPoints > 0 ? (
                          <span className="text-emerald-400 font-black">+{acc.gwPoints} pts</span>
                        ) : (
                          <span className="text-slate-500">0 pts</span>
                        )}
                      </td>

                      {/* Overall Points */}
                      <td className="py-3.5 px-4 text-right font-mono">
                        <span className="text-sm font-black text-fpl-green bg-fpl-green/10 px-2.5 py-1 rounded-lg border border-fpl-green/20">
                          {acc.overallPoints.toLocaleString()} pts
                        </span>
                      </td>

                      {/* Overall Rank */}
                      <td className="py-3.5 px-4 text-right font-mono text-slate-300">
                        {acc.overallRank ? (
                          <span className="font-bold text-slate-200">
                            #{acc.overallRank.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* FPL External Link */}
                      <td className="py-3.5 px-4 text-center">
                        <a
                          href={`https://fantasy.premierleague.com/entry/${acc.teamId}/history`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-fpl-green transition-colors border border-slate-800"
                          title="View on Official FPL Website"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
