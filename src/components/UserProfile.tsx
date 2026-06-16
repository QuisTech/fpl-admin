import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';
import {
  User, Mail, Key, Globe, CreditCard,
  Github, Facebook, Chrome, Trash2,
  Shield, CheckCircle, Edit2, RefreshCw, Lock
} from 'lucide-react';

export const UserProfile = ({ user, onClose, onSignOut, onTeamIdChange, initialTab = 'account' }: { user: any, onClose: () => void, onSignOut: () => void, onTeamIdChange?: (id: string) => void, initialTab?: string }) => {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [editingFplId, setEditingFplId] = useState(false);
  const [fplTeamId, setFplTeamId] = useState(user?.fplTeamId || '');
  const [isLocked, setIsLocked] = useState(!!user?.fplTeamId);
  const [savingId, setSavingId] = useState(false);

  useEffect(() => {
    if (user?.uid) {
      axios.get(`/api/user-profile?userId=${user.uid}`).then(res => {
        if (res.data?.fplTeamId) {
          setFplTeamId(res.data.fplTeamId);
          setIsLocked(true);
        }
      }).catch(() => { });
    }
  }, [user?.uid]);

  const tabs = [
    { id: 'account', label: 'Account', icon: User },
    { id: 'fpl', label: 'FPL', icon: Shield },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'connections', label: 'Connections', icon: Chrome },
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 20 }}
          className="bg-slate-950 border border-fpl-border rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-6 border-b border-fpl-border flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-fpl-green to-fpl-purple rounded-full flex items-center justify-center text-xl font-black">
                {user?.displayName?.[0] || 'U'}
              </div>
              <div>
                <h2 className="text-xl font-black text-white">{user?.displayName}</h2>
                <p className="text-xs text-slate-400">@{user?.username || user?.email?.split('@')[0]} · {user?.tier || 'Free'} Member</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-900 rounded-lg">
              <span className="text-2xl text-slate-400">✕</span>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-4 sm:px-6 pt-4 border-b border-fpl-border overflow-x-auto scrollbar-hide shrink-0 whitespace-nowrap">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-t-lg transition-all ${activeTab === tab.id
                    ? 'bg-slate-900 text-fpl-green border-t border-x border-fpl-border'
                    : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto flex-1 max-h-[60vh] space-y-6">
            {activeTab === 'account' && (
              <>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-slate-900/50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <Mail className="w-4 h-4 text-slate-400" />
                      <div>
                        <p className="text-xs text-slate-400">Email Address</p>
                        <p className="text-sm font-medium text-white">{user?.email || 'N/A'}</p>
                      </div>
                    </div>
                    <button className="text-xs text-fpl-green font-bold">Change</button>
                  </div>

                  <div className="flex justify-between items-center p-3 bg-slate-900/50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <Key className="w-4 h-4 text-slate-400" />
                      <div>
                        <p className="text-xs text-slate-400">Password</p>
                        <p className="text-sm font-mono text-white">••••••••</p>
                      </div>
                    </div>
                    <button className="text-xs text-fpl-green font-bold">Reset</button>
                  </div>

                  <div className="flex justify-between items-center p-3 bg-slate-900/50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <Globe className="w-4 h-4 text-slate-400" />
                      <div>
                        <p className="text-xs text-slate-400">Language</p>
                        <select className="bg-transparent text-sm font-medium text-white border border-fpl-border rounded px-2 py-1">
                          <option>English (UK)</option>
                          <option>Español</option>
                          <option>Français</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-900/30 rounded-xl border border-fpl-border">
                  <p className="text-xs text-slate-400 mb-2">Last Login</p>
                  <p className="text-sm text-white">{user?.lastLoginAt ? new Date(user?.lastLoginAt).toLocaleString() : 'N/A'}</p>
                </div>
              </>
            )}

            {activeTab === 'fpl' && (
              <>
                <div className="space-y-4">
                  <div className="p-4 bg-slate-900/50 rounded-xl">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="text-xs text-slate-400">FPL Team ID</p>
                        {editingFplId ? (
                          <input
                            type="text"
                            value={fplTeamId}
                            onChange={(e) => setFplTeamId(e.target.value)}
                            className="mt-1 bg-slate-950 border border-fpl-border rounded px-3 py-1 text-white text-sm"
                            placeholder="Enter your Team ID"
                          />
                        ) : (
                          <p className="text-lg font-bold text-white font-mono mt-1">
                            {fplTeamId || 'Not set'}
                          </p>
                        )}
                      </div>
                      {isLocked ? (
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex items-center gap-1 text-xs text-slate-500 font-bold bg-slate-900 px-3 py-1 rounded">
                            <Lock className="w-3 h-3" /> Locked
                          </div>
                          <button
                            onClick={async () => {
                              if (!user?.uid) return;
                              if (confirm("Are you sure you want to use your 1 free reset for this season?")) {
                                try {
                                  await axios.put(`/api/user-profile?userId=${user.uid}`, { action: 'request_reset' });
                                  setFplTeamId('');
                                  setIsLocked(false);
                                  if (onTeamIdChange) onTeamIdChange('');
                                  alert("Team ID has been reset successfully. You can now link a new ID.");
                                } catch (e: any) {
                                  alert(e.response?.data?.error || "Failed to reset FPL Team ID.");
                                }
                              }
                            }}
                            className="text-[10px] text-fpl-green border border-fpl-green/30 px-2 py-1 rounded hover:bg-fpl-green/10 transition"
                          >
                            Use 1 Free Reset
                          </button>
                        </div>
                      ) : editingFplId ? (
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              if (!user?.uid) return;
                              setSavingId(true);
                              try {
                                await axios.put(`/api/user-profile?userId=${user.uid}`, { fplTeamId });
                                setIsLocked(true);
                                if (onTeamIdChange) onTeamIdChange(fplTeamId);
                                setEditingFplId(false);
                              } catch (e: any) {
                                alert(e.response?.data?.error || "Failed to save FPL Team ID");
                              } finally {
                                setSavingId(false);
                              }
                            }}
                            disabled={savingId}
                            className="text-xs bg-fpl-green text-slate-950 px-3 py-1 rounded font-bold disabled:opacity-50"
                          >
                            {savingId ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingFplId(false)}
                            className="text-xs bg-slate-800 px-3 py-1 rounded text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingFplId(true)}
                          className="text-xs text-fpl-green font-bold flex items-center gap-1"
                        >
                          <Edit2 className="w-3 h-3" /> Edit
                        </button>
                      )}
                    </div>

                    {user?.fplVerified && (
                      <div className="flex items-center gap-2 text-xs text-fpl-green mt-2">
                        <CheckCircle className="w-3 h-3" />
                        Verified Team ✓
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t border-slate-800/50">
                      <a
                        href="https://fantasy.premierleague.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-slate-400 hover:text-fpl-green block mb-2"
                      >
                        How do I find my Team ID? →
                      </a>
                      {isLocked && (
                        <p className="text-xs text-slate-500">
                          Locked to a Team ID by mistake? <a href="mailto:michquis@gmail.com" className="text-fpl-green hover:underline">Contact Support</a> to request a manual reset.
                        </p>
                      )}
                    </div>
                  </div>

                  <button className="w-full p-3 bg-slate-900 rounded-xl flex items-center justify-between hover:bg-slate-800 transition-colors">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="w-4 h-4 text-fpl-green" />
                      <span className="text-sm font-medium">Sync FPL Team Data</span>
                    </div>
                    <span className="text-xs text-slate-400">Last synced recently</span>
                  </button>
                </div>
              </>
            )}

            {activeTab === 'connections' && (
              <div className="space-y-3">
                <div className="p-4 bg-slate-900/50 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Chrome className="w-6 h-6 text-fpl-green" />
                    <div>
                      <p className="font-medium text-white">Google</p>
                      <p className="text-xs text-slate-400">{user?.connectedAccounts?.google ? 'Connected' : 'Not connected'}</p>
                    </div>
                  </div>
                  {user?.connectedAccounts?.google ? (
                    <button className="text-xs text-rose-400">Disconnect</button>
                  ) : (
                    <button className="text-xs text-fpl-green">Connect</button>
                  )}
                </div>

                <div className="p-4 bg-slate-900/50 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Github className="w-6 h-6" />
                    <div>
                      <p className="font-medium text-white">GitHub</p>
                      <p className="text-xs text-slate-400">Not connected</p>
                    </div>
                  </div>
                  <button className="text-xs text-fpl-green">Connect</button>
                </div>

                <div className="p-4 bg-slate-900/50 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Facebook className="w-6 h-6 text-blue-400" />
                    <div>
                      <p className="font-medium text-white">Facebook</p>
                      <p className="text-xs text-slate-400">Not connected</p>
                    </div>
                  </div>
                  <button className="text-xs text-fpl-green">Connect</button>
                </div>
              </div>
            )}

            {activeTab === 'billing' && (
              <div className="space-y-4">
                <div className="p-4 bg-gradient-to-r from-fpl-green/10 to-fpl-purple/10 rounded-xl border border-fpl-green/20">
                  <p className="text-xs text-slate-400 mb-1">Current Plan</p>
                  <p className="text-2xl font-black text-fpl-green">{user?.tier || 'Free'}</p>
                  <p className="text-xs text-slate-400 mt-2">Renews Next Month</p>
                </div>

                <div className="p-4 bg-slate-900/50 rounded-xl">
                  <p className="text-xs text-slate-400 mb-2">Payment Method</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CreditCard className="w-5 h-5" />
                      <span className="text-sm text-white">Visa •••• 4242</span>
                    </div>
                    <button className="text-xs text-fpl-green">Update</button>
                  </div>
                </div>

                <button
                  onClick={() => alert('To view invoice history, please check your email for Dodo Payments receipts or contact support.')}
                  className="w-full text-left p-3 bg-slate-900 rounded-xl text-sm hover:bg-slate-800 transition-colors"
                >
                  View Invoice History →
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-fpl-border flex justify-between items-center">
            <button
              onClick={onSignOut}
              className="px-4 py-2 bg-rose-500/10 text-rose-400 rounded-lg text-sm font-bold hover:bg-rose-500/20 transition-colors"
            >
              Sign Out
            </button>

            <button
              onClick={async () => {
                if (!user?.uid) return;
                if (confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
                  try {
                    await axios.delete(`/api/user-profile?userId=${user.uid}`);
                    onSignOut();
                    onClose();
                  } catch (e) {
                    alert("Failed to delete account");
                  }
                }
              }}
              className="text-xs text-slate-500 hover:text-rose-400 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Delete Account
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
