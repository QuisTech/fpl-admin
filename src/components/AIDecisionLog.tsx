import { useEffect, useState } from 'react';
import { Brain, Clock, TrendingUp } from 'lucide-react';

interface AIDecision {
  id: string;
  gameweek: number;
  decision: string;
  reasoning: string;
  confidence: number;
  timestamp: string;
  userPrompt?: string;
}

import axios from 'axios';

export const AIDecisionLog = ({ userId, refreshTrigger }: { userId: string, refreshTrigger?: string }) => {
  const [decisions, setDecisions] = useState<AIDecision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    axios.get(`/api/decision-logs?userId=${userId}`)
      .then(res => {
        setDecisions(res.data.decisions || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch decision logs", err);
        setLoading(false);
      });
  }, [userId, refreshTrigger]);

  if (loading) return <div className="animate-pulse text-center p-4">Loading AI decisions...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Brain className="w-5 h-5 text-fpl-green" />
        <h2 className="text-sm font-black uppercase tracking-widest">AI Agent Decision Log</h2>
      </div>
      
      {decisions.length === 0 ? (
        <div className="text-center text-slate-500 py-8">No AI decisions yet. Sync your team.</div>
      ) : (
        decisions.map((decision) => (
          <div key={decision.id} className="bg-slate-950 border border-fpl-border rounded-xl p-4">
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-slate-500" />
                <span className="text-[10px] text-slate-400">GW{decision.gameweek}</span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[9px] font-black ${
                decision.confidence >= 80 ? 'bg-fpl-green/10 text-fpl-green' :
                decision.confidence >= 50 ? 'bg-yellow-500/10 text-yellow-500' :
                'bg-red-500/10 text-red-500'
              }`}>
                {decision.confidence}% confidence
              </span>
            </div>
            
            <div className="flex items-center gap-2 mb-2 mt-3">
              <TrendingUp className="w-4 h-4 text-fpl-green" />
              <span className="text-sm font-bold text-white">{decision.decision}</span>
            </div>
            
            {decision.userPrompt && decision.userPrompt.trim() !== '' && (
              <div className="bg-slate-900/80 rounded-lg p-3 border-l-2 border-slate-600 mb-2">
                <p className="text-[11px] text-slate-400 italic">"Q: {decision.userPrompt}"</p>
              </div>
            )}
            
            <div className="bg-slate-900/50 rounded-lg p-3 border-l-2 border-fpl-green">
              <p className="text-xs text-slate-300">{decision.reasoning}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
};
