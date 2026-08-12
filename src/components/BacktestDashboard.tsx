import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart3, TrendingUp, TrendingDown, ShieldCheck, Zap, DollarSign, ChevronDown, ChevronUp, AlertTriangle, CheckCircle } from 'lucide-react';

interface SwapDetail {
  outPlayer: string;
  inPlayer: string;
  position: string;
  xpSacrifice8GW: number;
  xpSacrificePerGw: number;
  eoReduction: number;
}

interface ModeResult {
  mode: string;
  startingXI: string[];
  captain: string;
  projectedGwXp: number;
  projected8GwXp: number;
  actualPoints: number;
  averageXiEo: number;
  alphaVsTemplate: number;
}

interface GameweekData {
  gameweek: number;
  templateScore: number;
  safe: ModeResult;
  risky: ModeResult;
  value: ModeResult;
  riskySwapCount: number;
  riskyAvgSwapCost: number;
  riskyQuality: string;
}

interface BacktestData {
  generatedAt: string;
  fuel: string;
  startGw: number;
  endGw: number;
  hasLivePoints: boolean;
  totals: {
    safe: { totalPoints: number; alphaVsTemplate: number };
    risky: { totalPoints: number; alphaVsTemplate: number };
    value: { totalPoints: number; alphaVsTemplate: number };
    template: { totalPoints: number };
  };
  gameweeks: GameweekData[];
}

export const BacktestDashboard = () => {
  const [activeTab, setActiveTab] = useState<'fplform' | 'native'>('fplform');
  const [data, setData] = useState<BacktestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGw, setExpandedGw] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const fileName = activeTab === 'native' ? 'backtest_results_native.json' : 'backtest_results.json';
    
    fetch(`/data/${fileName}`)
      .then(res => {
        if (!res.ok) throw new Error(`No ${activeTab.toUpperCase()} backtest results found. Run the backtest CLI first.`);
        return res.json();
      })
      .then((d: BacktestData) => {
        setData(d);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [activeTab]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <BarChart3 className="w-8 h-8 text-fpl-green animate-pulse mx-auto mb-3" />
          <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Loading {activeTab.toUpperCase()} Data...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        {/* Toggle (even on error so they can switch back) */}
        <div className="flex bg-slate-900 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('fplform')}
            className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-md transition-colors ${activeTab === 'fplform' ? 'bg-fpl-green text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
          >
            FPLFORM
          </button>
          <button
            onClick={() => setActiveTab('native')}
            className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-md transition-colors ${activeTab === 'native' ? 'bg-fpl-purple text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            NATIVE
          </button>
        </div>

        <div className="flex items-center justify-center h-64">
          <div className="text-center max-w-sm">
            <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
            <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">No {activeTab.toUpperCase()} Data Available</p>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Run the backtest CLI locally to generate results:
            </p>
            <code className="block mt-2 text-[9px] text-fpl-green bg-slate-950 p-2 rounded-lg font-mono text-left overflow-x-auto whitespace-nowrap">
              node --import tsx scripts/run_backtest.ts --start-gw 1 --end-gw 1 --fuel {activeTab}
              <br/>
              cp data/backtest_results.json public/data/{activeTab === 'native' ? 'backtest_results_native.json' : 'backtest_results.json'}
            </code>
            <p className="text-[10px] text-slate-500 mt-2">Then push to deploy the results.</p>
          </div>
        </div>
      </div>
    );
  }

  const modes = [
    { key: 'safe' as const, label: 'SAFE', icon: ShieldCheck, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20' },
    { key: 'risky' as const, label: 'RISKY', icon: Zap, color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/20' },
    { key: 'value' as const, label: 'VALUE', icon: DollarSign, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10', borderColor: 'border-cyan-500/20' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      {/* Header and Toggle */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-wider">Strategy Backtest</h2>
          
          <div className="flex bg-slate-900 rounded-lg p-1 mt-2 w-fit">
            <button
              onClick={() => setActiveTab('fplform')}
              className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-md transition-colors ${activeTab === 'fplform' ? 'bg-fpl-green text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
            >
              FPLFORM
            </button>
            <button
              onClick={() => setActiveTab('native')}
              className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-md transition-colors ${activeTab === 'native' ? 'bg-fpl-purple text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              NATIVE
            </button>
          </div>
          <p className="text-[9px] text-slate-500 mt-0.5">
            GW{data.startGw}–GW{data.endGw} · {data.fuel.toUpperCase()} · Generated {new Date(data.generatedAt).toLocaleDateString()}
          </p>
        </div>
        {!data.hasLivePoints && (
          <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Projected (No Live Data Yet)
          </span>
        )}
      </div>

      {/* Cumulative Scoreboard */}
      <div className="grid grid-cols-3 gap-2">
        {modes.map(m => {
          const totals = data.totals[m.key];
          const Icon = m.icon;
          const isPositiveAlpha = totals.alphaVsTemplate > 0;
          return (
            <motion.div
              key={m.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`${m.bgColor} border ${m.borderColor} rounded-xl p-3 text-center`}
            >
              <Icon className={`w-4 h-4 ${m.color} mx-auto mb-1.5`} />
              <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1">{m.label}</div>
              <div className={`text-lg font-black font-mono ${m.color}`}>{Number(totals.totalPoints).toFixed(1)}</div>
              <div className="text-[9px] text-slate-500 mb-1">Total Points</div>
              <div className={`text-[10px] font-black font-mono flex items-center justify-center gap-0.5 ${isPositiveAlpha ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isPositiveAlpha ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {isPositiveAlpha ? '+' : ''}{Number(totals.alphaVsTemplate).toFixed(1)} vs Template
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Template Baseline */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-slate-400" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Top-1k Template Baseline</span>
        </div>
        <span className="text-sm font-black font-mono text-white">{Number(data.totals.template.totalPoints).toFixed(1)} pts</span>
      </div>

      {/* Gameweek Breakdown */}
      <div>
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Gameweek Breakdown</h3>
        <div className="space-y-2">
          {data.gameweeks.map(gw => {
            const isExpanded = expandedGw === gw.gameweek;
            const bestMode = [gw.safe, gw.risky, gw.value].sort((a, b) => b.actualPoints - a.actualPoints)[0];
            return (
              <motion.div
                key={gw.gameweek}
                layout
                className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => setExpandedGw(isExpanded ? null : gw.gameweek)}
                  className="w-full p-3 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-white uppercase">GW{gw.gameweek}</span>
                    <div className="flex items-center gap-2 text-[9px] font-mono">
                      <span className="text-emerald-400">{gw.safe.actualPoints}</span>
                      <span className="text-slate-600">/</span>
                      <span className="text-amber-400">{gw.risky.actualPoints}</span>
                      <span className="text-slate-600">/</span>
                      <span className="text-cyan-400">{gw.value.actualPoints}</span>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[7px] font-black uppercase ${
                      gw.riskyQuality === 'PASS'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}>
                      {gw.riskyQuality === 'PASS' ? <CheckCircle className="w-2.5 h-2.5 inline mr-0.5" /> : <AlertTriangle className="w-2.5 h-2.5 inline mr-0.5" />}
                      {gw.riskyQuality}
                    </span>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-slate-800"
                    >
                      <div className="p-3 space-y-3">
                        {/* Mode Comparison Table */}
                        <div className="grid grid-cols-4 gap-1 text-[8px] font-bold uppercase text-slate-500">
                          <div>Mode</div>
                          <div className="text-center">GW xP</div>
                          <div className="text-center">Actual Pts</div>
                          <div className="text-center">Alpha</div>
                        </div>
                        {[gw.safe, gw.risky, gw.value].map((m, i) => {
                          const modeConfig = modes[i];
                          return (
                            <div key={m.mode} className="grid grid-cols-4 gap-1 items-center">
                              <div className={`text-[9px] font-black ${modeConfig.color}`}>{modeConfig.label}</div>
                              <div className="text-[10px] font-mono text-white text-center">{m.projectedGwXp}</div>
                              <div className="text-[10px] font-mono font-black text-white text-center">{m.actualPoints}</div>
                              <div className={`text-[10px] font-mono font-black text-center ${m.alphaVsTemplate > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {m.alphaVsTemplate > 0 ? '+' : ''}{m.alphaVsTemplate}
                              </div>
                            </div>
                          );
                        })}

                        {/* Template Score */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-800/50">
                          <span className="text-[8px] text-slate-500 font-bold uppercase">Template Baseline</span>
                          <span className="text-[10px] font-mono text-slate-400">{gw.templateScore} pts</span>
                        </div>

                        {/* RISKY Swap Details */}
                        {gw.riskySwapCount > 0 && (
                          <div className="pt-2 border-t border-slate-800/50">
                            <div className="text-[8px] text-slate-500 font-bold uppercase mb-1.5">
                              Differential Swaps ({gw.riskySwapCount}) · Avg Cost: {gw.riskyAvgSwapCost} xP/GW
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] text-slate-400">Captain:</span>
                              <span className="text-[9px] font-mono text-emerald-400 font-bold">{gw.safe.captain}</span>
                              <span className="text-[9px] text-slate-600">→</span>
                              <span className="text-[9px] font-mono text-amber-400 font-bold">{gw.risky.captain}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};
