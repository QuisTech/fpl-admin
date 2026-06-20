import { Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { RecommendationResponse, TeamSyncResponse } from '../types';

interface MetricsColumnProps {
  data: RecommendationResponse | null;
  syncedData?: TeamSyncResponse | null;
  riskMode: 'safe' | 'aggressive' | 'value';
}

export const MetricsColumn = ({ data, syncedData, riskMode, tab }: MetricsColumnProps & { tab: string }) => {
  const isViewingMySquad = !!syncedData && ['transfers', 'performance', 'chips'].includes(tab);
  const squadValue = isViewingMySquad ? (syncedData.totalCost || 0) : (data?.totalCost || 0);
  const itb = isViewingMySquad
    ? (syncedData.bank || 0)
    : Math.max(0, 1000 - (data?.totalCost || 0));
  const badgeText = isViewingMySquad ? "MY SQUAD" : "OPTIMAL";

  return (
    <div className="col-span-12 lg:col-span-3 grid grid-cols-1 gap-4">
      {/* Squad Metrics Card */}
      <div className="bg-card-bg border border-fpl-border rounded-3xl p-5 flex flex-col justify-between shadow-sm">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Squad Value</h2>
          <span className="text-fpl-green text-[10px] font-bold">{badgeText}</span>
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

      {/* Captain Card */}
      <div className="bg-card-bg border border-fpl-border rounded-3xl p-5 shadow-sm">
        <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Top Recommendation</h2>
        <div className="flex items-center gap-4 bg-slate-950/50 p-3 rounded-2xl border border-fpl-border">
          <div className="w-10 h-10 bg-fpl-pink rounded-xl flex items-center justify-center shadow-lg shadow-fpl-pink/20">
            <Star className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase font-black">{data?.captain?.team_name || "Unknown"}</p>
            <p className="text-sm font-black text-white">{data?.captain?.web_name || "Unknown"}</p>
            <p className="text-[10px] text-fpl-green font-bold">Captain Pick</p>
          </div>
        </div>
      </div>
    </div>
  );
};
