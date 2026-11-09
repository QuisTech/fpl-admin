import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Zap, X, CheckCircle, AlertTriangle, Play, Sparkles, Trophy, RefreshCw } from 'lucide-react';
import { auth } from '../lib/firebase';

interface SnapshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTakeManualSnapshot: () => void;
}

export const SnapshotModal: React.FC<SnapshotModalProps> = ({
  isOpen,
  onClose,
  onTakeManualSnapshot
}) => {
  const [snapshotOption, setSnapshotOption] = useState<'golden_hour' | 'post_deadline' | 'gw_finalizer' | 'manual'>('golden_hour');
  const [triggering, setTriggering] = useState(false);
  const [triggerStatus, setTriggerStatus] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const handleTriggerWorkflow = async (option: 'golden_hour' | 'post_deadline' | 'gw_finalizer') => {
    setTriggering(true);
    setTriggerStatus(null);
    setTriggerError(null);

    const endpointMap: Record<'golden_hour' | 'post_deadline' | 'gw_finalizer', string> = {
      golden_hour: '/api/admin/run-snapshot',
      post_deadline: '/api/admin/run-post-deadline',
      gw_finalizer: '/api/admin/run-gw-finalizer'
    };

    try {
      const currentUser = auth.currentUser;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (currentUser) {
        const token = await currentUser.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(endpointMap[option], {
        method: 'POST',
        headers
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to trigger GitHub Action pipeline.');
      }

      setTriggerStatus(resData.message || 'GitHub Action pipeline triggered successfully!');
    } catch (err: any) {
      setTriggerError(err.message || 'An error occurred triggering the GitHub Action.');
    } finally {
      setTriggering(false);
    }
  };

  const handleConfirm = () => {
    if (snapshotOption === 'manual') {
      onTakeManualSnapshot();
      onClose();
    } else {
      handleTriggerWorkflow(snapshotOption);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
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
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl relative space-y-5 max-h-[90vh] overflow-y-auto"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-fpl-green/10 border border-fpl-green/20 rounded-xl text-fpl-green">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">Snapshot & Feed Control Hub</h3>
                  <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm">
                    Super Admin
                  </span>
                </div>
                <p className="text-[10px] text-slate-400">Trigger GitHub Actions workflows or browser snapshots with 1 click</p>
              </div>
            </div>

            {/* Option Selection */}
            <div className="space-y-2.5 pt-1">
              {/* 1. Golden Hour Action Pipeline Option */}
              <label
                onClick={() => {
                  setSnapshotOption('golden_hour');
                  setTriggerStatus(null);
                  setTriggerError(null);
                }}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  snapshotOption === 'golden_hour'
                    ? 'bg-fpl-green/10 border-fpl-green/50 text-white shadow-[0_0_15px_rgba(0,255,133,0.1)]'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="snapshotOption"
                  checked={snapshotOption === 'golden_hour'}
                  onChange={() => setSnapshotOption('golden_hour')}
                  className="mt-0.5 accent-fpl-green"
                />
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white">
                    <Zap className="w-3.5 h-3.5 text-fpl-green" />
                    Golden Hour Pre-Deadline Pipeline (sniper-fetch.yml)
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    Scrapes fresh FPLForm predictions, Top 1k sentiment, archives point-in-time files, and auto-snapshots all registered squad accounts.
                  </p>
                </div>
              </label>

              {/* 2. Post-Deadline Elite Intelligence Fetch Option */}
              <label
                onClick={() => {
                  setSnapshotOption('post_deadline');
                  setTriggerStatus(null);
                  setTriggerError(null);
                }}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  snapshotOption === 'post_deadline'
                    ? 'bg-fpl-green/10 border-fpl-green/50 text-white shadow-[0_0_15px_rgba(0,255,133,0.1)]'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="snapshotOption"
                  checked={snapshotOption === 'post_deadline'}
                  onChange={() => setSnapshotOption('post_deadline')}
                  className="mt-0.5 accent-fpl-green"
                />
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white">
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                    FPL Post-Deadline Elite Intelligence Fetch (post-deadline-fetch.yml)
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    Captures live Top 250 Manager picks, captaincy consensus, and chip usage immediately after the gameweek deadline unlocks.
                  </p>
                </div>
              </label>

              {/* 3. Post-Gameweek Table Finalizer Option */}
              <label
                onClick={() => {
                  setSnapshotOption('gw_finalizer');
                  setTriggerStatus(null);
                  setTriggerError(null);
                }}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  snapshotOption === 'gw_finalizer'
                    ? 'bg-fpl-green/10 border-fpl-green/50 text-white shadow-[0_0_15px_rgba(0,255,133,0.1)]'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="snapshotOption"
                  checked={snapshotOption === 'gw_finalizer'}
                  onChange={() => setSnapshotOption('gw_finalizer')}
                  className="mt-0.5 accent-fpl-green"
                />
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white">
                    <Trophy className="w-3.5 h-3.5 text-amber-400" />
                    FPL Post-Gameweek Table Finalizer (gameweek-finalizer.yml)
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    Captures and locks finalized official post-gameweek Top Manager standings and points once all fixtures and bonus points finish.
                  </p>
                </div>
              </label>

              {/* 4. Manual Browser Snapshot Option */}
              <label
                onClick={() => {
                  setSnapshotOption('manual');
                  setTriggerStatus(null);
                  setTriggerError(null);
                }}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  snapshotOption === 'manual'
                    ? 'bg-fpl-green/10 border-fpl-green/50 text-white shadow-[0_0_15px_rgba(0,255,133,0.1)]'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="snapshotOption"
                  checked={snapshotOption === 'manual'}
                  onChange={() => setSnapshotOption('manual')}
                  className="mt-0.5 accent-fpl-green"
                />
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    Full Matrix Manual Snapshot (18 Combinations + Synced XI)
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    Instantly evaluates and captures all 18 AI strategy matrix combinations plus your active synced Starting XI at once into your Firestore profile.
                  </p>
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
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={triggering}
                onClick={handleConfirm}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-fpl-green hover:bg-emerald-400 text-slate-950 text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 shadow-md cursor-pointer"
              >
                {triggering ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    Triggering...
                  </>
                ) : snapshotOption === 'golden_hour' ? (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Launch Golden Hour Pipeline
                  </>
                ) : snapshotOption === 'post_deadline' ? (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Launch Post-Deadline Fetch
                  </>
                ) : snapshotOption === 'gw_finalizer' ? (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Launch GW Table Finalizer
                  </>
                ) : (
                  <>
                    <Camera className="w-3.5 h-3.5" />
                    Save Manual Snapshot
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
