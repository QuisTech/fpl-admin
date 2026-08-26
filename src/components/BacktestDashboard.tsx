import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart3, TrendingUp, TrendingDown, ShieldCheck, Zap, DollarSign, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Play, X } from 'lucide-react';
import { auth } from '../lib/firebase';

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

interface BacktestDashboardProps {
  initialFuel?: string;
}

export const BacktestDashboard = ({ initialFuel }: BacktestDashboardProps) => {
  const normalizeFuel = (f?: string): 'fplform' | 'native' | 'eye-test' => {
    if (f === 'native') return 'native';
    if (f === 'eyetest' || f === 'eye-test') return 'eye-test';
    return 'eye-test'; // Default to EYE-TEST
  };

  const [activeTab, setActiveTab] = useState<'fplform' | 'native' | 'eye-test'>(normalizeFuel(initialFuel));
  const [data, setData] = useState<BacktestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGw, setExpandedGw] = useState<number | null>(null);

  // Trigger Backtest Modal State
  const [isAdmin, setIsAdmin] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runMode, setRunMode] = useState<'auto' | 'custom'>('auto');
  const [startGw, setStartGw] = useState(1);
  const [endGw, setEndGw] = useState(1);
  const [triggering, setTriggering] = useState(false);
  const [triggerStatus, setTriggerStatus] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  useEffect(() => {
    const checkAdmin = async () => {
      const user = auth.currentUser;
      if (!user) {
        setIsAdmin(false);
        return;
      }
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/check', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setIsAdmin(res.ok);
      } catch {
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, []);

  const handleTriggerBacktest = async () => {
    setTriggering(true);
    setTriggerStatus(null);
    setTriggerError(null);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Authentication required. Please log in.');
      }
      const token = await currentUser.getIdToken();

      const payload: any = {};
      if (runMode === 'custom') {
        payload.startGw = Number(startGw) || 1;
        payload.endGw = Number(endGw) || 1;
      }

      const res = await fetch('/api/admin/run-backtest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to trigger backtest pipeline.');
      }

      setTriggerStatus(resData.message || 'Backtest triggered successfully on GitHub Actions!');
    } catch (err: any) {
      setTriggerError(err.message || 'An error occurred triggering the backtest.');
    } finally {
      setTriggering(false);
    }
  };

  useEffect(() => {
    if (initialFuel) {
      setActiveTab(normalizeFuel(initialFuel));
    }
  }, [initialFuel]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let fileName = 'backtest_results_fplform.json';
    if (activeTab === 'native') fileName = 'backtest_results_native.json';
    if (activeTab === 'eye-test') fileName = 'backtest_results_eyetest.json';
    
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
          <button
            onClick={() => setActiveTab('eye-test')}
            className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-md transition-colors ${activeTab === 'eye-test' ? 'bg-cyan-500 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
          >
            EYE-TEST
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
              node --import tsx scripts/run_backtest.ts --fuel {activeTab}
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
            <button
              onClick={() => setActiveTab('eye-test')}
              className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-md transition-colors ${activeTab === 'eye-test' ? 'bg-cyan-500 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
            >
              EYE-TEST
            </button>
          </div>
          <p className="text-[9px] text-slate-500 mt-0.5">
            GW{data.startGw}–GW{data.endGw} · {data.fuel.toUpperCase()} · Generated {new Date(data.generatedAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {isAdmin && (
            <button
              onClick={() => {
                setShowRunModal(true);
                setTriggerStatus(null);
                setTriggerError(null);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider transition-all shadow-sm active:scale-95"
            >
              <Play className="w-3 h-3 fill-current" />
              Run Backtest
            </button>
          )}
          {!data.hasLivePoints && (
            <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Projected (No Live Data Yet)
            </span>
          )}
        </div>
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

      {/* Trigger Backtest Modal */}
      <AnimatePresence>
        {showRunModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl relative space-y-5"
            >
              <button
                onClick={() => setShowRunModal(false)}
                className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
                  <Play className="w-5 h-5 fill-current" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">Run Backtest Pipeline</h3>
                  <p className="text-[10px] text-slate-400">Trigger all 3 prediction fuels (FPLForm, Native, Eye-Test)</p>
                </div>
              </div>

              {/* Mode Selection */}
              <div className="space-y-3 pt-2">
                <label
                  onClick={() => setRunMode('auto')}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    runMode === 'auto'
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-white'
                      : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="runMode"
                    checked={runMode === 'auto'}
                    onChange={() => setRunMode('auto')}
                    className="mt-0.5 accent-emerald-500"
                  />
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-white">Auto-Detect Gameweeks</div>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                      Runs backtest from GW1 up to the latest completed gameweek on the official FPL API.
                    </p>
                  </div>
                </label>

                <label
                  onClick={() => setRunMode('custom')}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    runMode === 'custom'
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-white'
                      : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="runMode"
                    checked={runMode === 'custom'}
                    onChange={() => setRunMode('custom')}
                    className="mt-0.5 accent-emerald-500"
                  />
                  <div className="w-full">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-white">Custom Gameweek Range</div>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                      Specify exact start and end gameweeks (e.g. GW1 to GW1).
                    </p>

                    {runMode === 'custom' && (
                      <div className="grid grid-cols-2 gap-3 mt-3 pt-2 border-t border-slate-800/80">
                        <div>
                          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Start GW</label>
                          <input
                            type="number"
                            min={1}
                            max={38}
                            value={startGw}
                            onChange={(e) => setStartGw(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">End GW</label>
                          <input
                            type="number"
                            min={1}
                            max={38}
                            value={endGw}
                            onChange={(e) => setEndGw(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </label>
              </div>

              {/* Status and Feedback Messages */}
              {triggerStatus && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-[10px] font-medium leading-relaxed flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>{triggerStatus}</div>
                </div>
              )}

              {triggerError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-[10px] font-medium leading-relaxed flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>{triggerError}</div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowRunModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={triggering}
                  onClick={handleTriggerBacktest}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50"
                >
                  {triggering ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                      Triggering...
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Launch Pipeline
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
