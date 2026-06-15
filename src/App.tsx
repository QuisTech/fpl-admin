import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { RefreshCw } from 'lucide-react';

import { useFPLData } from './hooks/useFPLData';
import { Header } from './components/Header';
import { MetricsColumn } from './components/MetricsColumn';
import { PitchView } from './components/PitchView';
import { DataGrid } from './components/DataGrid';
import { TransferView } from './components/TransferView';
import { ChipAdvisor } from './components/ChipAdvisor';
import { PerformanceView } from './components/PerformanceView';
import { FixtureList } from './components/FixtureList';
import { OptimizerPositioning } from './components/OptimizerPositioning';
import { AuthModal } from './components/AuthModal';
import { AIAgentView } from './components/AIAgentView';
import { Camera } from 'lucide-react';
import { cn } from './lib/utils';
import { auth, onAuthStateChanged, signOut } from './lib/firebase';
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { AdminLayout } from './components/AdminLayout';
import { UsersPage } from './pages/admin/UsersPage';
import { BetaPage } from './pages/admin/BetaPage';
import { AnalyticsPage } from './pages/admin/AnalyticsPage';
import { FeatureFlagsPage } from './pages/admin/FeatureFlagsPage';

function FPLApp() {
  const [riskMode, setRiskMode] = useState<'safe' | 'aggressive' | 'value'>('safe');
  const [tab, setTab] = useState<'optimizer' | 'pitch' | 'picks' | 'transfers' | 'chips' | 'performance' | 'agent'>('optimizer');
  
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authUser, setAuthUser] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
    });
    return () => unsubscribe();
  }, []);

  const [anonymousId] = useState(() => {
    let id = localStorage.getItem('fpl_user_id');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('fpl_user_id', id);
    }
    return id;
  });
  
  const activeUserId = authUser?.uid || anonymousId;
  
  const { 
    data, 
    loading, 
    error,
    teamId, 
    setTeamId, 
    syncedData, 
    syncing, 
    syncTeam, 
    formation,
    history,
    takeSnapshot,
    fetchLivePoints,
    tier,
    isTeamIdLocked
  } = useFPLData(riskMode, activeUserId);

  const handleSync = async () => {
    if (tier !== 'free' && tier !== 'admin' && !isTeamIdLocked) {
      alert("Premium Account: Please link your FPL Team ID in your Settings profile before running an analysis.");
      setIsAuthModalOpen(true);
      return;
    }
    const success = await syncTeam();
    if (success) setTab('transfers');
  };

  const handleSnapshot = () => {
    if (data) {
      const success = takeSnapshot(data.nextEventId, data, riskMode);
      if (success) {
        alert(`Snapshot taken for GW${data.nextEventId} [${riskMode.toUpperCase()}]`);
      }
    }
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center p-4">
        <RefreshCw className="w-8 h-8 text-fpl-green animate-spin mb-4" />
        <p className="text-slate-400 font-mono text-sm tracking-widest uppercase">Optimizing Strategy...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] text-[#f8fafc] p-4 sm:p-6 font-sans">
      {error && (
        <div className="max-w-[1400px] mx-auto mb-4 p-4 bg-red-500/10 border border-red-500/50 rounded-2xl text-red-400 text-xs font-mono">
          <span className="font-bold uppercase mr-2">[Engine Error]:</span> {error}
        </div>
      )}
      <div className="max-w-[1400px] mx-auto grid grid-cols-12 gap-4 auto-rows-min">

        <Header data={data} riskMode={riskMode} setRiskMode={setRiskMode} authUser={authUser} tier={tier} onOpenAuth={() => setIsAuthModalOpen(true)} onSignOut={() => signOut(auth)} setTeamId={setTeamId} />

        <MetricsColumn data={data} syncedData={syncedData} riskMode={riskMode} />

        {/* Primary Content Area */}
        <div className="col-span-12 lg:col-span-6 bg-card-bg border border-fpl-border rounded-3xl overflow-hidden relative shadow-xl min-h-[600px]">
          <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.1) 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.1) 40px)` }}></div>
          
          <div className="relative z-10 p-4 sm:p-6 h-full flex flex-col">
            <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between mb-8">
              <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-xl border border-fpl-border w-full md:w-auto justify-center">
                {(['optimizer', 'pitch', 'picks', 'transfers', 'chips', 'performance', 'agent'] as const).map((t) => (
                  <button 
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all",
                      tab === t ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-300"
                    )}
                  >{t}</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 w-full md:w-auto">
                {tab === 'pitch' && data && (
                  <button 
                    onClick={handleSnapshot}
                    className="flex items-center gap-2 bg-slate-900 border border-fpl-border rounded-lg px-3 py-1 text-[9px] font-black uppercase tracking-widest text-white hover:bg-slate-800 transition-all mr-2 sm:mr-4"
                  >
                    <Camera className="w-3 h-3 text-fpl-green" />
                    Snapshot
                  </button>
                )}
                <div className="flex items-center gap-2">
                  <input 
                    type="text" 
                    placeholder={tier !== 'free' && tier !== 'admin' && !isTeamIdLocked ? "LINK ID" : "TEAM ID"} 
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    disabled={tier !== 'free' && tier !== 'admin' && isTeamIdLocked}
                    onClick={() => {
                      if (tier !== 'free' && tier !== 'admin' && !isTeamIdLocked) {
                        setIsAuthModalOpen(true);
                      }
                    }}
                    className={cn("bg-slate-950 border border-fpl-border rounded-lg px-3 py-1 text-[10px] font-mono text-fpl-green w-24 focus:outline-none focus:border-fpl-green",
                      tier !== 'free' && tier !== 'admin' && isTeamIdLocked ? "opacity-50 cursor-not-allowed" : "",
                      tier !== 'free' && tier !== 'admin' && !isTeamIdLocked ? "cursor-pointer hover:bg-slate-900 text-rose-400" : ""
                    )}
                  />
                  <button 
                    onClick={handleSync}
                    disabled={syncing}
                    className="bg-fpl-purple hover:bg-fpl-purple/80 disabled:opacity-50 text-white text-[10px] font-black px-3 py-1 rounded-lg transition-colors"
                  >
                    {syncing ? 'SYNCING...' : 'SYNC TEAM'}
                  </button>
                </div>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {tab === 'optimizer' ? (
                <OptimizerPositioning userId={activeUserId} currentTier={tier} />
              ) : tab === 'pitch' ? (
                <PitchView data={data} formation={formation} />
              ) : tab === 'picks' ? (
                <DataGrid data={data} />
              ) : tab === 'transfers' ? (
                <TransferView syncedData={syncedData} tier={tier} setTab={setTab} userId={activeUserId} />
              ) : tab === 'performance' ? (
                <PerformanceView history={history} fetchLivePoints={fetchLivePoints} />
              ) : tab === 'chips' ? (
                <ChipAdvisor syncedData={syncedData} tier={tier} setTab={setTab} userId={activeUserId} />
              ) : (
                <AIAgentView syncedData={syncedData} tier={tier} userId={activeUserId} />
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Column */}
        <div className="col-span-12 lg:col-span-3 grid grid-cols-1 gap-4">
           {/* Top Value Picks Card */}
           <div className="bg-card-bg border border-fpl-border rounded-3xl p-5 flex flex-col shadow-sm">
            <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Top Value Picks (PPM)</h2>
            <div className="space-y-3 flex-grow">
               {data?.topPicks?.mid?.slice(0, 5).map((p, i) => (
                <div key={p.id} className={cn("flex items-center justify-between border-b border-fpl-border pb-2", i >= 4 && "border-0")}>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-200">{p.web_name}</span>
                    <span className="text-[10px] text-slate-500 uppercase">{p.position} | £{((p?.now_cost || 0)/10).toFixed(1)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-mono font-bold text-fpl-green">{(p?.ppm || 0).toFixed(2)}</span>
                    <div className="text-[8px] text-slate-500 uppercase font-bold">Pts/£M</div>
                  </div>
                </div>
               ))}
            </div>
          </div>
          
          <FixtureList data={data} />
        </div>
      </div>
      <AuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)} 
        anonymousId={anonymousId}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<FPLApp />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="analytics" replace />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="beta" element={<BetaPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="features" element={<FeatureFlagsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
