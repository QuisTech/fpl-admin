import { cn } from '../lib/utils';
import { RecommendationResponse } from '../types';

interface HeaderProps {
  data: RecommendationResponse | null;
  riskMode: 'safe' | 'aggressive' | 'value';
  setRiskMode: (mode: 'safe' | 'aggressive' | 'value') => void;
  onOpenAuth: () => void;
  authUser: any;
  tier: string;
  onSignOut: () => void;
  setTeamId: (id: string) => void;
  profileTab?: string | null;
  setProfileTab?: (tab: string | null) => void;
}

import { UserProfile } from './UserProfile';
import { UserCircle, User } from 'lucide-react';

export const Header = ({ data, riskMode, setRiskMode, onOpenAuth, authUser, tier, onSignOut, setTeamId, profileTab, setProfileTab }: HeaderProps) => {
  return (
    <header className="col-span-12 flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between mb-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-fpl-purple rounded flex items-center justify-center font-black text-xl text-white shadow-lg shadow-fpl-purple/20 shrink-0">F</div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">FPL <span className="text-fpl-green">OPTIMIZER</span></h1>
            <span className="bg-fpl-pink text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow-sm shadow-fpl-pink/20">V3</span>
            <span className="bg-slate-900 text-cyan-400 text-[8px] font-mono px-2 py-0.5 rounded border border-cyan-500/20">GEMINI AI POWERED</span>
          </div>
          <p className="text-[10px] text-slate-500 font-light uppercase tracking-widest">Generative AI Optimization Engine</p>
        </div>
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 bg-card-bg/50 p-2 rounded-xl border border-fpl-border w-full sm:w-auto">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest text-slate-400 text-right font-medium">Strategy Mode</span>
          <div className="flex items-center gap-2 bg-slate-950 p-1 rounded mt-1">
            <button 
              onClick={() => setRiskMode('safe')}
              className={cn(
                "px-3 py-0.5 text-[10px] rounded font-bold transition-all",
                riskMode === 'safe' ? "bg-fpl-green text-slate-950" : "text-slate-400 hover:text-slate-200"
              )}
            >SAFE</button>
            <button 
              onClick={() => setRiskMode('aggressive')}
              className={cn(
                "px-3 py-0.5 text-[10px] rounded font-bold transition-all",
                riskMode === 'aggressive' ? "bg-orange-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
              )}
            >RISKY</button>
            <button 
              onClick={() => setRiskMode('value')}
              className={cn(
                "px-3 py-0.5 text-[10px] rounded font-bold transition-all",
                riskMode === 'value' ? "bg-cyan-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
              )}
            >VALUE</button>
          </div>
        </div>
        <div className="h-8 w-px bg-slate-800"></div>
        <div className="flex flex-col text-right">
          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-medium">Expected Points</span>
          <span className="text-xl font-bold text-fpl-green tabular-nums">+{(data?.expectedPoints || 0).toFixed(1)} xP</span>
        </div>
        
        <div className="h-8 w-px bg-slate-800 hidden sm:block"></div>
        
        {authUser ? (
          <>
            <button 
              onClick={() => setProfileTab?.('account')}
              className="flex items-center gap-3 hover:bg-slate-900 rounded-lg p-2 transition-colors"
            >
              <div className="flex flex-col text-right hidden sm:flex">
                <span className="text-[10px] font-bold text-slate-300">{authUser.email?.split('@')[0]}</span>
                <span className="text-[8px] uppercase text-fpl-green">{tier || 'Claimed'}</span>
              </div>
              <div className="w-8 h-8 bg-gradient-to-br from-fpl-green to-fpl-purple rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
            </button>
            {profileTab && (
              <UserProfile 
                user={{
                  email: authUser.email,
                  displayName: authUser.displayName || authUser.email?.split('@')[0],
                  tier: tier || 'free',
                  uid: authUser.uid,
                  lastLoginAt: authUser.metadata?.lastSignInTime
                }} 
                initialTab={profileTab}
                onClose={() => setProfileTab?.(null)} 
                onSignOut={onSignOut}
                onTeamIdChange={setTeamId}
              />
            )}
          </>
        ) : (
          <button 
            onClick={onOpenAuth}
            className="flex items-center gap-2 bg-fpl-green text-slate-950 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-fpl-green/90 transition-colors"
          >
            <UserCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Sign In</span>
          </button>
        )}
      </div>
    </header>
  );
};
