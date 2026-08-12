import { motion } from 'motion/react';
import { Activity, ShieldCheck, AlertTriangle, Settings2, Code2 } from 'lucide-react';
import { RecommendationResponse } from '../types';

interface EngineDiagnosticsProps {
  data: RecommendationResponse | null;
}

export const EngineDiagnostics = ({ data }: EngineDiagnosticsProps) => {
  if (!data?.engineDiagnostics) return null;

  const { budgetUsed, budgetLimit, solverStatus, riskMode, activeConstraints, metrics } = data.engineDiagnostics;
  const isOptimal = solverStatus === 'optimal';
  const swapAnalysis = metrics?.swapAnalysis;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-950/80 border border-fpl-border rounded-2xl p-4 mt-6 shadow-sm overflow-hidden relative"
    >
      {/* Decorative background grid */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'linear-gradient(#00ff87 1px, transparent 1px), linear-gradient(90deg, #00ff87 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
      
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-slate-400" />
          <h3 className="text-xs font-black text-slate-300 uppercase tracking-widest">Engine Diagnostics</h3>
        </div>
        <div className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider flex items-center gap-1 ${isOptimal ? 'bg-fpl-green/10 text-fpl-green border border-fpl-green/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
          {isOptimal ? <ShieldCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          {isOptimal ? 'LP Solver Optimal' : 'Heuristic Fallback'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 relative z-10 mb-3">
        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-800">
          <p className="text-[9px] text-slate-500 uppercase font-bold mb-1 truncate">Constraint: Budget</p>
          <div className="flex items-end gap-1">
            <p className="text-xs font-mono font-black text-white">£{(budgetUsed / 10).toFixed(1)}M</p>
            <p className="text-[9px] text-slate-500 font-mono hidden sm:block">/ £{(budgetLimit / 10).toFixed(1)}M</p>
          </div>
        </div>

        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-800">
          <p className="text-[9px] text-slate-500 uppercase font-bold mb-1 truncate">Objective Math</p>
          <p className="text-[11px] font-black text-white capitalize truncate">
            {riskMode === 'value' ? 'Max ROI (Pts/£M)' : 'Max Total xP'}
          </p>
        </div>

        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-800">
          <p className="text-[9px] text-slate-500 uppercase font-bold mb-1 truncate">8-GW XI Projected xP</p>
          <p className="text-[11px] font-black font-mono text-emerald-400 truncate">
            {metrics?.horizonTotalXp ? `${metrics.horizonTotalXp} pts` : 'N/A'}
          </p>
        </div>

        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-800">
          <p className="text-[9px] text-slate-500 uppercase font-bold mb-1 truncate">Average XI EO</p>
          <p className="text-[11px] font-black font-mono text-cyan-400 truncate">
            {metrics?.averageXiEo !== undefined ? `${metrics.averageXiEo}%` : 'N/A'}
          </p>
        </div>
      </div>

      {swapAnalysis && (
        <div className="relative z-10 mt-3 pt-3 border-t border-slate-800/80">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">RISKY vs SAFE Divergence</span>
            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${swapAnalysis.differentialQuality === 'PASS' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'}`}>
              Quality: {swapAnalysis.differentialQuality} ({swapAnalysis.withinThresholdPct}% ≤0.35 xP/GW)
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <div className="text-[8px] text-slate-500 font-bold uppercase">Swaps</div>
              <div className="text-xs font-mono font-black text-white">{swapAnalysis.swapCount}</div>
              <div className="text-[8px] text-emerald-400 font-semibold truncate">{swapAnalysis.divergenceTier.replace('_', ' ')}</div>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <div className="text-[8px] text-slate-500 font-bold uppercase">Avg Cost / GW</div>
              <div className="text-xs font-mono font-black text-amber-400">-{swapAnalysis.avgSwapCostPerGw} xP</div>
              <div className="text-[8px] text-slate-500 truncate">Total: -{swapAnalysis.totalXpSacrificed8GW} pts</div>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <div className="text-[8px] text-slate-500 font-bold uppercase">EO Drop</div>
              <div className="text-xs font-mono font-black text-cyan-400">-{swapAnalysis.avgEoReduction}%</div>
              <div className="text-[8px] text-slate-500 truncate">per swap</div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
