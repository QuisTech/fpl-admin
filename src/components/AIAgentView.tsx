import { useState } from 'react';
import { motion } from 'motion/react';
import { Bot, Sparkles, Send, ShieldAlert } from 'lucide-react';
import { TeamSyncResponse, RecommendationResponse } from '../types';
import { StripeCheckout } from './StripeCheckout';
import { AIDecisionLog } from './AIDecisionLog';
import { cn } from '../lib/utils';
import axios from 'axios';

interface AIAgentViewProps {
  syncedData: TeamSyncResponse | null;
  optimalData: RecommendationResponse | null;
  tier: string;
  userId: string;
  riskMode: string;
}

export const AIAgentView = ({ syncedData, optimalData, tier, userId, riskMode }: AIAgentViewProps) => {
  const [asking, setAsking] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingThread, setGeneratingThread] = useState(false);
  const [generatedThread, setGeneratedThread] = useState<string[] | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);

  const handleAskAgent = async () => {
    if (!syncedData) return;
    setAsking(true);
    setError(null);
    try {
      // Create body matching getLLMTransferDecision signature roughly
      const res = await axios.post('/api/agent/ask', {
        userId,
        gameweek: (syncedData as any).gameweek || 1,
        squad: syncedData.squad,
        bank: syncedData.bank,
        totalCost: syncedData.totalCost,
        chips: {
          WC: 1, FH: 1, BB: 1, TC: 1 // mock chip state
        },
        riskMode: riskMode,
        userPrompt: prompt
      });
      setLastPrompt(prompt);
      setResponse(res.data.decision);
      setPrompt('');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setAsking(false);
    }
  };

  if (tier !== 'aiAgent' && tier !== 'betaPilot') {
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

  return (
    <motion.div
      key="agent-unlocked"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col h-full space-y-6"
    >
      <div className="bg-slate-950/80 border border-fpl-border rounded-2xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3 border-b border-fpl-border pb-4">
          <div className="w-10 h-10 bg-fpl-green/10 rounded-full flex items-center justify-center border border-fpl-green/30">
            <Bot className="w-5 h-5 text-fpl-green" />
          </div>
          <div>
            <h3 className="text-white font-bold">FPL AI Agent</h3>
            <p className="text-[10px] text-fpl-green uppercase tracking-widest font-black">Online & Ready</p>
          </div>
        </div>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-xs">
            {error}
          </div>
        )}

        {response && (
          <div className="flex flex-col gap-3">
            {lastPrompt && lastPrompt.trim() !== '' && (
              <div className="self-end bg-fpl-green/10 border border-fpl-green/20 rounded-xl p-3 max-w-[85%]">
                <p className="text-sm text-fpl-green leading-relaxed text-right italic">"{lastPrompt}"</p>
              </div>
            )}
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 self-start max-w-[95%]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-300">Action: <span className="text-fpl-green">{response.action}</span></span>
                <span className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-400">Confidence: {response.confidence}%</span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">{response.reasoning}</p>
            </div>
          </div>
        )}

        <div className="flex items-end gap-2 mt-2">
          <div className="flex-grow">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="E.g. What should I do this week based on the latest press conferences?"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-fpl-green resize-none h-24"
            />
          </div>
          <button 
            onClick={handleAskAgent}
            disabled={asking || prompt.trim() === ''}
            className="bg-fpl-green text-slate-950 hover:bg-fpl-green/90 disabled:opacity-50 disabled:cursor-not-allowed p-3 rounded-xl transition-colors h-12 flex items-center justify-center shrink-0"
          >
            {asking ? <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Twitter/X Thread Generator */}
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
                // Pass optimal squad info
                const res = await axios.post('/api/agent/thread', {
                  squad: optimalData.squad,
                  riskMode,
                  totalCost: optimalData.totalCost,
                  expectedPoints: optimalData.expectedPoints,
                  topPicks: optimalData.topPicks?.mid || []
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
                        // Optional: show a small copied toast
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

      {/* Embedded Decision Log History */}
      <div className="flex-grow overflow-auto bg-slate-950/50 rounded-2xl border border-fpl-border p-5">
        <AIDecisionLog userId={userId} refreshTrigger={response ? response.reasoning : ''} />
      </div>
    </motion.div>
  );
};
