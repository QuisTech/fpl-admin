import { useState } from 'react';
import { motion } from 'motion/react';
import { Bot, Sparkles, Send, ShieldAlert } from 'lucide-react';
import { TeamSyncResponse } from '../types';
import { StripeCheckout } from './StripeCheckout';
import { AIDecisionLog } from './AIDecisionLog';
import { cn } from '../lib/utils';
import axios from 'axios';

interface AIAgentViewProps {
  syncedData: TeamSyncResponse | null;
  tier: string;
  userId: string;
  riskMode: string;
}

export const AIAgentView = ({ syncedData, tier, userId, riskMode }: AIAgentViewProps) => {
  const [asking, setAsking] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

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

      {/* Embedded Decision Log History */}
      <div className="flex-grow overflow-auto bg-slate-950/50 rounded-2xl border border-fpl-border p-5">
        <AIDecisionLog userId={userId} refreshTrigger={response ? response.reasoning : ''} />
      </div>
    </motion.div>
  );
};
