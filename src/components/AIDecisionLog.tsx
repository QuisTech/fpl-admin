import { useEffect, useState } from 'react';
import { Brain, Clock, TrendingUp, MessageSquareQuote } from 'lucide-react';
import { cn } from '../lib/utils';
import axios from 'axios';

interface AIDecision {
  id: string;
  gameweek: number;
  decision: string;
  reasoning: string;
  confidence: number;
  timestamp: string;
  userPrompt?: string;
}

interface AIDecisionLogProps {
  userId: string;
  refreshTrigger?: string;
  selectedGw?: number;
  viewAll?: boolean;
}

export const AIDecisionLog = ({ userId, refreshTrigger, selectedGw, viewAll = false }: AIDecisionLogProps) => {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6 text-slate-400 font-mono text-xs animate-pulse">
        Loading AI decision history...
      </div>
    );
  }

  const visibleDecisions = viewAll 
    ? decisions 
    : (selectedGw !== undefined ? decisions.filter(d => (d.gameweek || 1) === selectedGw) : decisions);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b border-fpl-border pb-2">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-fpl-green" />
          <h4 className="text-xs font-black text-white uppercase tracking-wider">
            AI Advisory Records {selectedGw && !viewAll ? `• GW ${selectedGw}` : ''}
          </h4>
        </div>
        <span className="text-[9px] font-mono text-slate-400">
          {visibleDecisions.length} record{visibleDecisions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {visibleDecisions.length === 0 ? (
        <div className="text-center py-6 bg-slate-900/30 rounded-xl border border-slate-800/50">
          <p className="text-slate-400 font-mono text-xs">No decision records for Gameweek {selectedGw || 1}.</p>
          <p className="text-slate-600 text-[10px] mt-0.5">Use the prompt box above to generate AI transfers & strategy.</p>
        </div>
      ) : (
        visibleDecisions.map((decision) => (
          <div key={decision.id} className="bg-slate-950 border border-fpl-border rounded-xl p-3.5 sm:p-4 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-slate-500" />
                <span className="text-[10px] font-mono font-bold text-emerald-400">GW{decision.gameweek}</span>
                {decision.timestamp && (
                  <span className="text-[8.5px] font-mono text-slate-500">
                    {new Date(decision.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <span className={cn(
                "px-2 py-0.5 rounded text-[8.5px] font-black uppercase font-mono",
                decision.confidence >= 80 ? 'bg-fpl-green/10 text-fpl-green border border-fpl-green/20' :
                decision.confidence >= 50 ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                'bg-red-500/10 text-red-400 border border-red-500/20'
              )}>
                {decision.confidence}% confidence
              </span>
            </div>
            
            <div className="flex items-center gap-2 mb-2 mt-1">
              <TrendingUp className="w-3.5 h-3.5 text-fpl-green shrink-0" />
              <span className="text-xs sm:text-sm font-bold text-white leading-tight">{decision.decision}</span>
            </div>
            
            {decision.userPrompt && decision.userPrompt.trim() !== '' && (
              <div className="bg-slate-900/80 rounded-lg p-2.5 border-l-2 border-slate-600 mb-2 flex items-start gap-2">
                <MessageSquareQuote className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-300 italic leading-relaxed">"{decision.userPrompt}"</p>
              </div>
            )}
            
            <div className="bg-slate-900/50 rounded-lg p-3 border-l-2 border-fpl-green">
              <p className="text-xs text-slate-300 leading-relaxed font-sans">{decision.reasoning}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
};
