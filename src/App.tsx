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
import { BacktestDashboard } from './components/BacktestDashboard';
import { FixtureList } from './components/FixtureList';
import { OptimizerPositioning } from './components/OptimizerPositioning';
import { AuthModal } from './components/AuthModal';
import { AIAgentView } from './components/AIAgentView';
import { Camera } from 'lucide-react';
import { cn } from './lib/utils';
import { auth, onAuthStateChanged, signOut, signInAnonymously } from './lib/firebase';
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';

// Configure Axios to automatically attach Firebase JWT to all outgoing requests
axios.interceptors.request.use(async (config) => {
  if (auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      config.headers.Authorization = `Bearer ${token}`;
    } catch (e) {
      console.error("Failed to get auth token", e);
    }
  }
  return config;
});

import { AdminLayout } from './components/AdminLayout';
import { UsersPage } from './pages/admin/UsersPage';
import { BetaPage } from './pages/admin/BetaPage';
import { AnalyticsPage } from './pages/admin/AnalyticsPage';
import { FeatureFlagsPage } from './pages/admin/FeatureFlagsPage';
import { FPLTrackerPage } from './pages/admin/FPLTrackerPage';

import { SnapshotToast, SnapshotToastData } from './components/SnapshotToast';
import { SnapshotModal } from './components/SnapshotModal';

function FPLApp() {
  const [riskMode, setRiskMode] = useState<'safe' | 'aggressive' | 'value'>('safe');
  const [fuel, setFuel] = useState<'fplform' | 'native' | 'eye-test'>('fplform');
  const [tab, setTab] = useState<'optimizer' | 'pitch' | 'picks' | 'transfers' | 'chips' | 'performance' | 'backtest' | 'agent'>('optimizer');
  const [snapshotToast, setSnapshotToast] = useState<SnapshotToastData | null>(null);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<any>(null);
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setAuthUser(user);
      } else {
        // Automatically sign in anonymously if no user is found
        try {
          const cred = await signInAnonymously(auth);
          setAuthUser(cred.user);
        } catch (e) {
          console.error("Anonymous auth failed", e);
        }
      }
      setAuthInitialized(true);
    });
    return () => unsubscribe();
  }, []);

  const activeUserId = authUser?.uid || '';

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
    isTeamIdLocked,
    activeScenario,
    setActiveScenario,
    lockedPlayerIds,
    excludedPlayerIds,
    toggleLock,
    toggleExclude,
    clearConstraints
  } = useFPLData(riskMode, fuel, activeUserId, authInitialized);

  const isSuperAdmin = (authUser?.email || '').toLowerCase().trim() === 'michquis@gmail.com' || tier === 'admin';

  const handleSync = async () => {
    if (!isSuperAdmin && tier !== 'free' && tier !== 'admin' && !isTeamIdLocked) {
      alert("Premium Account: Please link your FPL Team ID in your Settings profile before running an analysis.");
      if (authUser) setProfileTab('fpl');
      else setIsAuthModalOpen(true);
      return;
    }
    const success = await syncTeam();
    if (success) setTab('transfers');
  };

  const executeManualSnapshot = async () => {
    if (data) {
      const success = await takeSnapshot(data.nextEventId, data, riskMode, fuel, activeScenario);
      if (success) {
        const scenarioLabel = activeScenario === 'quant' ? 'Quant Optimal' : 'Risky Template Shield';
        const fuelLabel = fuel === 'eye-test' ? 'Eye Test' : fuel === 'native' ? 'Native FPL' : 'FPLForm';
        
        setSnapshotToast({
          gwId: data.nextEventId,
          fuel,
          scenario: activeScenario,
          riskMode,
          fuelLabel,
          scenarioLabel,
          riskLabel: riskMode.toUpperCase(),
          timestamp: Date.now()
        });
      }
    }
  };

  const handleSnapshotClick = () => {
    if (isSuperAdmin) {
      setIsSnapshotModalOpen(true);
    } else {
      executeManualSnapshot();
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

        <Header data={data} riskMode={riskMode} setRiskMode={setRiskMode} fuel={fuel} setFuel={setFuel} authUser={authUser} tier={tier} onOpenAuth={() => setIsAuthModalOpen(true)} onSignOut={() => signOut(auth)} setTeamId={setTeamId} profileTab={profileTab} setProfileTab={setProfileTab} />

        <MetricsColumn data={data} syncedData={syncedData} riskMode={riskMode} tab={tab} />

        {/* Primary Content Area */}
        <div className="col-span-12 lg:col-span-6 bg-card-bg border border-fpl-border rounded-3xl overflow-hidden relative shadow-xl min-h-[600px]">
          <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.1) 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.1) 40px)` }}></div>
          
          <div className="relative z-10 p-4 sm:p-6 h-full flex flex-col">
            <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between mb-8">
              <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-xl border border-fpl-border w-full md:w-auto justify-center">
                {(['optimizer', 'pitch', 'picks', 'transfers', 'chips', 'performance', 'backtest', 'agent'] as const).map((t) => (
                  <button 
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all",
                      tab === t 
                        ? "bg-fpl-green text-slate-950 shadow-[0_0_15px_rgba(0,255,133,0.3)]" 
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                    )}
                  >{t}</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 w-full md:w-auto">
                <button 
                  onClick={handleSnapshotClick}
                  className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-1.5 bg-slate-900 border border-fpl-border rounded-xl text-xs font-black uppercase text-slate-300 hover:text-white hover:bg-slate-800 transition-colors shadow-sm"
                  title="Save current recommendations to track performance after the gameweek"
                >
                  <Camera className="w-3.5 h-3.5 text-fpl-green" />
                  <span>Snapshot</span>
                </button>
                <div className="flex items-center gap-2">
                  <input 
                    type="text" 
                    placeholder={!isSuperAdmin && tier !== 'free' && tier !== 'admin' && !isTeamIdLocked ? "LINK ID" : "TEAM ID"} 
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    disabled={!isSuperAdmin && tier !== 'free' && tier !== 'admin' && isTeamIdLocked}
                    onClick={() => {
                      if (!isSuperAdmin && tier !== 'free' && tier !== 'admin' && !isTeamIdLocked) {
                        if (authUser) setProfileTab('fpl');
                        else setIsAuthModalOpen(true);
                      }
                    }}
                    className={cn("bg-slate-950 border border-fpl-border rounded-lg px-3 py-1 text-[10px] font-mono text-fpl-green w-24 focus:outline-none focus:border-fpl-green",
                      !isSuperAdmin && tier !== 'free' && tier !== 'admin' && isTeamIdLocked ? "opacity-50 cursor-not-allowed" : "",
                      !isSuperAdmin && tier !== 'free' && tier !== 'admin' && !isTeamIdLocked ? "cursor-pointer hover:bg-slate-900 text-rose-400" : ""
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
                <PitchView 
                  data={data} 
                  syncedData={syncedData}
                  formation={formation} 
                  activeScenario={activeScenario}
                  onSelectScenario={setActiveScenario}
                  lockedPlayerIds={lockedPlayerIds}
                  excludedPlayerIds={excludedPlayerIds}
                  onToggleLock={toggleLock}
                  onToggleExclude={toggleExclude}
                  onClearConstraints={clearConstraints}
                />
              ) : tab === 'picks' ? (
                <DataGrid 
                  data={data} 
                  lockedPlayerIds={lockedPlayerIds}
                  excludedPlayerIds={excludedPlayerIds}
                  onToggleLock={toggleLock}
                  onToggleExclude={toggleExclude}
                />
              ) : tab === 'transfers' ? (
                <TransferView syncedData={syncedData} tier={tier} setTab={setTab} userId={activeUserId} />
              ) : tab === 'performance' ? (
                <PerformanceView history={history} fetchLivePoints={fetchLivePoints} />
              ) : tab === 'backtest' ? (
                <BacktestDashboard initialFuel={fuel} />
              ) : tab === 'chips' ? (
                <ChipAdvisor syncedData={syncedData} tier={tier} setTab={setTab} userId={activeUserId} />
              ) : (
                <AIAgentView syncedData={syncedData} optimalData={data} tier={tier} userId={activeUserId} riskMode={riskMode} fuel={fuel} />
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
        anonymousId={activeUserId}
      />
      <SnapshotToast 
        toast={snapshotToast} 
        onClose={() => setSnapshotToast(null)} 
      />
      <SnapshotModal 
        isOpen={isSnapshotModalOpen}
        onClose={() => setIsSnapshotModalOpen(false)}
        onTakeManualSnapshot={executeManualSnapshot}
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
          <Route path="fpl-tracker" element={<FPLTrackerPage />} />
          <Route path="beta" element={<BetaPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="features" element={<FeatureFlagsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
