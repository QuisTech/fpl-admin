import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { Bot, Sparkles, Send, ShieldAlert, ChevronLeft, ChevronRight, MessageSquare, Award } from 'lucide-react';
import { TeamSyncResponse, RecommendationResponse } from '../types';
import { StripeCheckout } from './StripeCheckout';
import { AIDecisionLog } from './AIDecisionLog';
import { cn } from '../lib/utils';
import axios from 'axios';
import { auth } from '../lib/firebase';

interface AIAgentViewProps {
  syncedData: TeamSyncResponse | null;
  optimalData: RecommendationResponse | null;
  tier: string;
  userId: string;
  riskMode: string;
  fuel: string;
}

interface ChatMessage {
  id: string;
  gameweek: number;
  prompt?: string;
  response?: any;
  timestamp: string;
}

export const AIAgentView = ({ syncedData, optimalData, tier, userId, riskMode, fuel }: AIAgentViewProps) => {
  const [asking, setAsking] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [generatingThread, setGeneratingThread] = useState(false);
  const [generatedThread, setGeneratedThread] = useState<string[] | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // 🤖 Gameweek Enveloped Chevron Navigator & Chat History State
  const liveGw = syncedData?.gameweek || optimalData?.nextEventId || 3;
  const [gwsList, setGwsList] = useState<number[]>(() => {
    const initGw = syncedData?.gameweek || optimalData?.nextEventId || 3;
    const list: number[] = [];
    for (let g = initGw; g >= 1; g--) {
      list.push(g);
    }
    return list.length > 0 ? list : [3, 2, 1];
  });
  const [selectedGwIndex, setSelectedGwIndex] = useState<number>(0);
  const [viewAll, setViewAll] = useState<boolean>(false);

  // Chat message history stored per Gameweek
  const [chatMessages, setChatMessages] = useState<Record<number, ChatMessage[]>>(() => {
    try {
      const saved = localStorage.getItem(`fpl_agent_chat_${userId}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Save chat messages locally
  useEffect(() => {
    if (userId && Object.keys(chatMessages).length > 0) {
      try {
        localStorage.setItem(`fpl_agent_chat_${userId}`, JSON.stringify(chatMessages));
      } catch (e) {
        console.error("Failed to cache agent chat", e);
      }
    }
  }, [chatMessages, userId]);

  useEffect(() => {
    // Check if the current user is an actual admin (role: 'admin') regardless of their tier
    const checkAdmin = async () => {
      if (auth.currentUser) {
        try {
          const token = await auth.currentUser.getIdToken();
          const res = await fetch('/api/admin/check', {
            headers: { Authorization: `Bearer ${token}` }
          });
          setIsAdmin(res.ok);
        } catch (e) {
          setIsAdmin(false);
        }
      }
    };
    checkAdmin();
  }, [auth.currentUser]);

  // Synchronize gameweeks list when live gameweek is available from syncedData or optimalData
  useEffect(() => {
    const targetGw = syncedData?.gameweek || optimalData?.nextEventId;
    if (targetGw) {
      setGwsList(prev => {
        const set = new Set([...prev]);
        for (let g = 1; g <= targetGw; g++) {
          set.add(g);
        }
        return Array.from(set).sort((a, b) => b - a);
      });
    }
  }, [syncedData?.gameweek, optimalData?.nextEventId]);

  const activeGwIndex = Math.min(selectedGwIndex, gwsList.length - 1);
  const activeGw = gwsList[activeGwIndex] || liveGw;

  const handleAskAgent = async () => {
    if (!syncedData || prompt.trim() === '') return;
    setAsking(true);
    setError(null);
    const targetGw = activeGw;

    try {
      const res = await axios.post('/api/agent/ask', {
        userId,
        gameweek: targetGw,
        squad: syncedData.squad,
        bank: syncedData.bank,
        totalCost: syncedData.totalCost,
        chips: {
          WC: 1, FH: 1, BB: 1, TC: 1 // chip state
        },
        riskMode: riskMode,
        fuel: fuel,
        userPrompt: prompt
      });

      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        gameweek: targetGw,
        prompt: prompt,
        response: res.data.decision,
        timestamp: new Date().toISOString()
      };

      setChatMessages(prev => ({
        ...prev,
        [targetGw]: [...(prev[targetGw] || []), newMsg]
      }));

      setPrompt('');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setAsking(false);
    }
  };

  if (tier !== 'aiAgent' && tier !== 'betaPilot' && tier !== 'admin' && !isAdmin) {
    return (
      <motion.div
        key="agent-locked"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex flex-col items-center justify-center h-full py-10 text-center"
      >
        <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 border border-fpl-green/30 shadow-[0_0_30px_rgba(0,255,135,0.15)]">
          <Bot className="text-fpl-green w-8 h-8" />
        </div>
        <h3 className="text-xl text-white font-black uppercase tracking-widest mb-3">AI Optimizer Agent</h3>
        <p className="text-slate-400 text-sm max-w-md leading-relaxed mb-8">
          Unlock your personal FPL assistant powered by AI. The agent scrapes press conferences, interprets injury reports, and makes contextual recommendations that the mathematical solver might miss.
        </p>
        
        <div className="grid grid-cols-1 gap-3 text-left w-full max-w-sm mb-8">
          <div className="flex items-center gap-3 bg-slate-950 p-3 rounded-xl border border-fpl-border">
            <Sparkles className="w-4 h-4 text-fpl-green shrink-0" />
            <span className="text-xs text-slate-300">Natural Language Context parsing</span>
          </div>
          <div className="flex items-center gap-3 bg-slate-950 p-3 rounded-xl border border-fpl-border">
            <ShieldAlert className="w-4 h-4 text-fpl-green shrink-0" />
            <span className="text-xs text-slate-300">Injury & Press Conference Analysis</span>
          </div>
        </div>

        <StripeCheckout 
          userId={userId} 
          tier="betaPilot" 
          buttonText="Unlock AI Agent (£49.99/mo)"
          className="bg-fpl-green text-slate-950 hover:bg-fpl-green/90 text-xs font-black px-6 py-3 rounded-xl transition-all uppercase tracking-widest shadow-lg shadow-fpl-green/20"
        />
      </motion.div>
    );
  }

  if (!syncedData) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-center">
        <Bot className="text-slate-700 w-12 h-12 mb-4" />
        <h3 className="text-slate-300 font-bold mb-2">Sync Your Team</h3>
        <p className="text-slate-500 text-xs max-w-xs leading-relaxed">
          The AI Agent needs to read your squad before it can give you personalized advice.
        </p>
      </div>
    );
  }

  const activeMessages = viewAll 
    ? Object.values(chatMessages).flat() 
    : (chatMessages[activeGw] || []);

  return (
    <motion.div
      key="agent-unlocked"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col h-full space-y-4 overflow-y-auto pr-1 custom-scrollbar"
    >
      {/* 🤖 User Requested Enveloped Chevron Navigator (Keeps Chat Compact & Non-Infinite) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/70 p-3 rounded-2xl border border-fpl-border/60">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-fpl-green/10 border border-fpl-green/30 flex items-center justify-center text-fpl-green shadow-inner">
            <Award className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider">
              AI Agent Advisor
            </h3>
            <p className="text-[10px] text-slate-400 font-mono">
              {gwsList.length} Gameweek{gwsList.length > 1 ? 's' : ''} Tracked
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2">
          {/* Enveloped Chevron Bar */}
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-fpl-border/50">
            <button 
              onClick={() => {
                setViewAll(false);
                setSelectedGwIndex(prev => Math.min(gwsList.length - 1, prev + 1));
              }}
              disabled={viewAll || activeGwIndex >= gwsList.length - 1}
              className="p-0.5 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" 
              title="Previous Gameweek"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <span className="text-[8.5px] font-mono text-emerald-400 font-bold px-1.5 select-none">
              {viewAll ? `GWs ${gwsList[gwsList.length - 1]}–${gwsList[0]}` : `GW ${activeGw}`}
            </span>

            <button 
              onClick={() => {
                setViewAll(false);
                setSelectedGwIndex(prev => Math.max(0, prev - 1));
              }}
              disabled={viewAll || activeGwIndex <= 0}
              className="p-0.5 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" 
              title="Next Gameweek"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Gameweek Quick Pills */}
          {gwsList.length > 1 && (
            <div className="hidden md:flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              {gwsList.map((gw, idx) => (
                <button
                  key={gw}
                  onClick={() => {
                    setViewAll(false);
                    setSelectedGwIndex(idx);
                  }}
                  className={cn(
                    "px-2 py-0.5 rounded text-[9px] font-mono font-bold transition-all",
                    !viewAll && activeGwIndex === idx 
                      ? "bg-fpl-green text-slate-950 shadow-sm" 
                      : "text-slate-400 hover:text-white hover:bg-slate-900"
                  )}
                >
                  GW{gw}
                </button>
              ))}
            </div>
          )}

          {/* Toggle View All */}
          {gwsList.length > 1 && (
            <button
              onClick={() => setViewAll(!viewAll)}
              className={cn(
                "text-[9px] font-mono font-black px-2.5 py-1 rounded-lg border transition-all uppercase tracking-wider",
                viewAll ? "bg-fpl-purple/20 text-fpl-purple border-fpl-purple/40" : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
              )}
            >
              {viewAll ? "Single GW" : "View All"}
            </button>
          )}
        </div>
      </div>

      {/* Main AI Chat & Dialogue Box for Selected Gameweek */}
      <div className="bg-slate-950/80 border border-fpl-border rounded-2xl p-4 sm:p-5 flex flex-col gap-4 shadow-lg">
        <div className="flex items-center justify-between border-b border-fpl-border pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-fpl-green/10 rounded-full flex items-center justify-center border border-fpl-green/30">
              <Bot className="w-4 h-4 text-fpl-green" />
            </div>
            <div>
              <h3 className="text-white text-xs sm:text-sm font-bold flex items-center gap-2">
                <span>FPL AI Intelligence</span>
                <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">GW {activeGw}</span>
              </h3>
              <p className="text-[9px] text-fpl-green uppercase tracking-widest font-black">Online & Context Synced</p>
            </div>
          </div>

          {activeMessages.length > 0 && (
            <span className="text-[9px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
              {activeMessages.length} message{activeMessages.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-xs font-mono">
            {error}
          </div>
        )}

        {/* Dynamic Chat Message Exchange */}
        <div className="flex flex-col gap-3 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
          {activeMessages.length === 0 ? (
            <div className="text-center py-6 bg-slate-900/40 rounded-xl border border-slate-800/60 p-4">
              <Sparkles className="w-6 h-6 text-fpl-green/60 mx-auto mb-2" />
              <p className="text-xs text-slate-300 font-medium">Ready to assist for Gameweek {activeGw}</p>
              <p className="text-[10px] text-slate-500 mt-1 max-w-sm mx-auto">
                Ask about recommended captaincy, optimal transfers, press conference news, or chip timing.
              </p>
            </div>
          ) : (
            activeMessages.map((msg) => (
              <div key={msg.id} className="flex flex-col gap-2.5">
                {/* User Message Bubble */}
                {msg.prompt && (
                  <div className="self-end bg-fpl-green/10 border border-fpl-green/30 rounded-xl p-3 max-w-[85%] shadow-sm">
                    <p className="text-xs sm:text-sm text-fpl-green leading-relaxed text-right italic font-medium">
                      "{msg.prompt}"
                    </p>
                  </div>
                )}

                {/* AI Agent Response Card */}
                {msg.response && (
                  <div className="bg-slate-900 border border-slate-700 rounded-xl p-3.5 sm:p-4 self-start max-w-[95%] shadow-md">
                    <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-800">
                      <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <Bot className="w-3.5 h-3.5 text-fpl-green" />
                        Action: <span className="text-fpl-green font-black">{msg.response.action}</span>
                      </span>
                      <span className="text-[9px] bg-slate-800 px-2 py-0.5 rounded text-slate-300 font-mono font-bold">
                        Confidence: {msg.response.confidence}%
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">{msg.response.reasoning}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Input Bar */}
        <div className="flex items-end gap-2 mt-1 pt-2 border-t border-slate-800">
          <div className="flex-grow">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAskAgent();
                }
              }}
              placeholder={`Ask AI Agent about Gameweek ${activeGw} (e.g. "Who should I captain or transfer in?")...`}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs sm:text-sm text-white focus:outline-none focus:border-fpl-green resize-none h-20 placeholder:text-slate-500 font-sans"
            />
          </div>
          <button 
            onClick={handleAskAgent}
            disabled={asking || prompt.trim() === ''}
            className="bg-fpl-green text-slate-950 hover:bg-fpl-green/90 disabled:opacity-50 disabled:cursor-not-allowed p-3 rounded-xl transition-all h-20 w-14 flex items-center justify-center shrink-0 shadow-md font-bold"
            title="Send prompt"
          >
            {asking ? <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Twitter/X Thread Generator (ADMIN ONLY) */}
      {isAdmin && (
        <div className="bg-slate-950/80 border border-fpl-border rounded-2xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-fpl-border pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500/10 rounded-full flex items-center justify-center border border-blue-500/30">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5 fill-blue-400"><g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.008 5.96H5.078z"></path></g></svg>
              </div>
              <div>
                <h3 className="text-white font-bold">Social Pipeline</h3>
                <p className="text-[10px] text-blue-400 uppercase tracking-widest font-black">X (Twitter) Thread Generator</p>
              </div>
            </div>
            <button 
              onClick={async () => {
                if (!optimalData) return;
                setGeneratingThread(true);
                setThreadError(null);
                try {
                  const omittedStars = optimalData.engineDiagnostics?.metrics?.omissionAnalysis?.map(oa => oa.omittedPlayer) || [];
                  const allTopPicks = [
                    ...(optimalData.topPicks?.fwd || []),
                    ...(optimalData.topPicks?.mid || []),
                    ...(optimalData.topPicks?.def || []),
                    ...(optimalData.topPicks?.gkp || [])
                  ];

                  // Pass optimal squad info
                  const res = await axios.post('/api/agent/thread', {
                    squad: optimalData.squad,
                    riskMode,
                    totalCost: optimalData.totalCost,
                    expectedPoints: optimalData.expectedPoints,
                    topPicks: allTopPicks.length > 0 ? allTopPicks : (optimalData.squad || []),
                    omittedStars,
                    captain: optimalData.captain,
                    viceCaptain: optimalData.viceCaptain
                  });
                  setGeneratedThread(res.data.tweets);
                } catch (err: any) {
                  setThreadError(err.response?.data?.error || err.message);
                } finally {
                  setGeneratingThread(false);
                }
              }}
              disabled={generatingThread}
              className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {generatingThread ? 'Generating...' : 'Generate Thread'}
            </button>
          </div>

          {threadError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-xs">
              {threadError}
            </div>
          )}

          {generatedThread && generatedThread.length > 0 && (
            <div className="flex flex-col gap-0 relative pt-2">
              <div className="absolute left-6 top-8 bottom-8 w-0.5 bg-slate-800 z-0"></div>
              {generatedThread.map((tweet, i) => (
                <div key={i} className="flex gap-4 relative z-10 mb-6 group">
                  <div className="w-12 h-12 bg-slate-900 rounded-full flex-shrink-0 flex items-center justify-center border-2 border-slate-950">
                    <Bot className="w-6 h-6 text-fpl-green" />
                  </div>
                  <div className="flex-grow bg-slate-900 border border-slate-700 rounded-xl p-4 shadow-sm group-hover:border-slate-500 transition-colors">
                    <p className="text-sm text-slate-200 whitespace-pre-wrap">{tweet}</p>
                    <div className="mt-3 flex justify-end">
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(tweet);
                        }}
                        className="text-xs text-slate-400 hover:text-blue-400 flex items-center gap-1 transition-colors"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex justify-end mt-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedThread.join('\n\n'));
                  }}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Copy Full Thread
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Embedded Decision Log History */}
      <div className="flex-grow overflow-auto bg-slate-950/50 rounded-2xl border border-fpl-border p-4 sm:p-5">
        <AIDecisionLog 
          userId={userId} 
          refreshTrigger={activeMessages.length.toString()} 
          selectedGw={activeGw}
          viewAll={viewAll}
        />
      </div>
    </motion.div>
  );
};
