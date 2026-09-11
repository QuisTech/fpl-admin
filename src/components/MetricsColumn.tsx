import { Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { RecommendationResponse, TeamSyncResponse } from '../types';
import { EngineDiagnostics } from './EngineDiagnostics';

interface MetricsColumnProps {
  data: RecommendationResponse | null;
  syncedData?: TeamSyncResponse | null;
  riskMode: 'safe' | 'aggressive' | 'value';
  onSyncTeamId?: (teamId: string) => void;
}

export const MetricsColumn = ({ data, syncedData, riskMode, tab, onSyncTeamId }: MetricsColumnProps & { tab: string }) => {
  const isViewingMySquad = !!syncedData && ['transfers', 'performance', 'chips'].includes(tab);
  const squadValue = isViewingMySquad ? (syncedData.totalCost || 0) : (data?.totalCost || 0);
  const itb = isViewingMySquad
    ? (syncedData.bank || 0)
    : Math.max(0, 1000 - (data?.totalCost || 0));
  const badgeText = isViewingMySquad ? "MY SQUAD" : "OPTIMAL";

  // Derive Elite Consensus Captain (from direct API field or dynamically from consensusDetails)
  const consensusCaptain = data?.topManagerInsight?.consensusCaptain || (() => {
    const details = data?.topManagerInsight?.consensusDetails;
    if (!details || details.length === 0) return undefined;
    const captainSorted = [...details]
      .filter(d => (d.captainRate || 0) > 0 || (d.captainCount || 0) > 0)
      .sort((a, b) => b.captainCount - a.captainCount || b.captainRate - a.captainRate);
    if (!captainSorted[0]) return undefined;
    const totalCount = data?.topManagerInsight?.eligibleManagers || data?.topManagerInsight?.noChipLeaderCount || 1;
    return {
      id: captainSorted[0].id,
      web_name: captainSorted[0].web_name,
      full_name: captainSorted[0].full_name || captainSorted[0].web_name,
      position: captainSorted[0].position,
      cost: captainSorted[0].cost,
      captainRate: captainSorted[0].captainRate,
      captainPercentage: Math.round(captainSorted[0].captainRate * 100),
      captainCount: captainSorted[0].captainCount,
      eligibleManagers: totalCount,
    };
  })();

  return (
    <div className="col-span-12 lg:col-span-3 grid grid-cols-1 gap-4">
      {/* Squad Metrics Card */}
      <div className="bg-card-bg border border-fpl-border rounded-3xl p-5 flex flex-col justify-between shadow-sm">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Squad Value</h2>
          <div className="flex items-center gap-2">
            {data?.isHeuristicFallback && !isViewingMySquad && (
              <span title="Exact budget constraints failed; falling back to naive point selection" className="text-amber-500 text-[9px] font-black uppercase tracking-wider bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 flex items-center gap-1">
                ⚠️ Heuristic Fallback
              </span>
            )}
            <span className="text-fpl-green text-[10px] font-bold">{badgeText}</span>
          </div>
        </div>
        <div>
          <div className="text-4xl font-bold font-mono tracking-tighter text-white">
            £{(squadValue / 10).toFixed(1)}M
          </div>
          <div className="flex justify-between mt-3 pt-3 border-t border-fpl-border">
            <span className="text-slate-400 text-xs font-medium">ITB Remaining</span>
            <span className="font-mono font-black text-sm text-fpl-green">£{(itb / 10).toFixed(1)}M</span>
          </div>
        </div>
        <div className="mt-6 space-y-3">
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-slate-400">Projected Rank Gain</span>
            <span className="font-bold text-emerald-400">+12%</span>
          </div>
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-slate-400">Risk Profile</span>
            <span className={cn(
              "font-bold uppercase",
              riskMode === 'aggressive' ? "text-orange-400" :
                riskMode === 'value' ? "text-cyan-400" :
                  "text-fpl-green"
            )}>{riskMode}</span>
          </div>
        </div>
      </div>

      {/* Captain Card with Elite Consensus Armband */}
      <div className="bg-card-bg border border-fpl-border rounded-3xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Top Recommendation</h2>
          {consensusCaptain && (
            <span className="text-[9px] font-mono font-bold bg-amber-400/10 text-amber-300 border border-amber-400/30 px-2 py-0.5 rounded-full flex items-center gap-1">
              👑 {consensusCaptain.captainPercentage}% Herd Pick
            </span>
          )}
        </div>

        {/* Optimal Pick */}
        <div className="flex items-center gap-3 bg-slate-950/60 p-3 rounded-2xl border border-fpl-border">
          <div className="w-10 h-10 bg-gradient-to-tr from-amber-500 to-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20 shrink-0">
            <Star className="w-5 h-5 text-slate-950 font-black" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-slate-400 uppercase font-black truncate">{data?.captain?.team_name || "Top Club"}</p>
              {data?.captain?.xP !== undefined && (
                <span className="text-[9px] font-mono font-black text-cyan-400 shrink-0">{data.captain.xP.toFixed(1)} xP</span>
              )}
            </div>
            <p className="text-sm font-black text-white truncate">{data?.captain?.web_name || "Top Pick"}</p>
            <p className="text-[9.5px] text-emerald-400 font-bold">Optimal Engine Captain (2×)</p>
          </div>
        </div>

        {/* Elite Consensus Captain Widget */}
        {consensusCaptain && (
          <div className="flex items-center gap-3 bg-purple-950/30 p-2.5 rounded-2xl border border-purple-500/30 text-xs">
            <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-400/40 flex items-center justify-center text-amber-300 shrink-0 text-sm">
              👑
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase text-purple-300">Elite Consensus</span>
                <span className="text-[9px] font-mono font-black text-amber-300">
                  {consensusCaptain.captainPercentage}% Armband
                </span>
              </div>
              <p className="text-xs font-black text-white truncate">
                {consensusCaptain.full_name || consensusCaptain.web_name} (£{consensusCaptain.cost > 30 ? (consensusCaptain.cost / 10).toFixed(1) : consensusCaptain.cost.toFixed(1)}M)
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Engine Diagnostics */}
      <EngineDiagnostics data={data} onSyncTeamId={onSyncTeamId} />
    </div>
  );
};
