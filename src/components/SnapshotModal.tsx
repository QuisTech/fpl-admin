import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Zap, X, CheckCircle, AlertTriangle, Play, Sparkles } from 'lucide-react';
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
  const [snapshotOption, setSnapshotOption] = useState<'golden_hour' | 'manual'>('golden_hour');
  const [triggering, setTriggering] = useState(false);
  const [triggerStatus, setTriggerStatus] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const handleTriggerGoldenHour = async () => {
    setTriggering(true);
    setTriggerStatus(null);
    setTriggerError(null);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Authentication required. Please log in as Super Admin.');
      }
      const token = await currentUser.getIdToken();

      const res = await fetch('/api/admin/run-snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to trigger Golden Hour Snapshot pipeline.');
      }

      setTriggerStatus(resData.message || 'Golden Hour Pre-Deadline Snapshot pipeline triggered on GitHub Actions!');
    } catch (err: any) {
      setTriggerError(err.message || 'An error occurred triggering the snapshot action.');
    } finally {
      setTriggering(false);
    }
  };

  const handleConfirm = () => {
    if (snapshotOption === 'manual') {
      onTakeManualSnapshot();
      onClose();
    } else {
      handleTriggerGoldenHour();
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
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl relative space-y-5"
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
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">Snapshot Control Hub</h3>
                  <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-fpl-purple/20 text-fpl-purple border border-fpl-purple/30">
                    Super Admin
                  </span>
                </div>
                <p className="text-[10px] text-slate-400">Choose snapshot execution method for pre-deadline performance tracking</p>
              </div>
            </div>

            {/* Option Selection */}
            <div className="space-y-3 pt-1">
              {/* Golden Hour Action Pipeline Option */}
              <label
                onClick={() => {
                  setSnapshotOption('golden_hour');
                  setTriggerStatus(null);
                  setTriggerError(null);
                }}
                className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
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
                    Golden Hour Action Pipeline (GitHub Action)
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    Triggers full sniper workflow to scrape fresh FPLForm predictions, Top 1k sentiment, archive point-in-time files, and auto-snapshot all registered squad accounts to Firestore.
                  </p>
                </div>
              </label>

              {/* Manual Browser Snapshot Option */}
              <label
                onClick={() => {
                  setSnapshotOption('manual');
                  setTriggerStatus(null);
                  setTriggerError(null);
                }}
                className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
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
                    Immediate Manual Snapshot (Active Pitch State)
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    Instantly saves your current browser pitch view, active risk mode, scenario, and fuel selections directly to your Firestore profile.
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
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-fpl-green hover:bg-emerald-400 text-slate-950 text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 shadow-md"
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
