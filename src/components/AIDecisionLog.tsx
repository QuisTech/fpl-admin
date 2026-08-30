import { useEffect, useState } from 'react';
import { Brain, Clock, TrendingUp, ChevronLeft, ChevronRight, MessageSquareQuote } from 'lucide-react';
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

export const AIDecisionLog = ({ userId, refreshTrigger }: { userId: string, refreshTrigger?: string }) => {
  const [decisions, setDecisions] = useState<AIDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGwIndex, setSelectedGwIndex] = useState<number>(0);
  const [viewAll, setViewAll] = useState<boolean>(false);

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
      <div className="flex items-center justify-center p-8 text-slate-400 font-mono text-xs animate-pulse">
        Loading AI advisory history...
      </div>
    );
  }

  const gws = Array.from(new Set(decisions.map(d => Number(d.gameweek) || 1))).map(Number).sort((a: number, b: number) => b - a);

  if (decisions.length === 0 || gws.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10">
        <Brain className="w-10 h-10 text-slate-700 mb-3" />
        <p className="text-slate-400 font-mono text-xs uppercase tracking-wider">No AI decisions recorded yet.</p>
        <p className="text-slate-600 text-[10px] mt-1 max-w-xs">Ask the AI agent above to analyze your squad or latest press conferences!</p>
      </div>
    );
  }

  const activeGwIndex = Math.min(selectedGwIndex, gws.length - 1);
  const currentGw = gws[activeGwIndex] || gws[0];
  const visibleDecisions = viewAll ? decisions : decisions.filter(d => (d.gameweek || 1) === currentGw);

  return (
    <div className="space-y-4">
      {/* 🤖 Gameweek Enveloped Chevron Navigator (Keeps Chat & Decisions Compact) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/70 p-3 rounded-2xl border border-fpl-border/60">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-fpl-green/10 border border-fpl-green/30 flex items-center justify-center text-fpl-green shadow-inner">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider">
              AI Advisory History
            </h3>
            <p className="text-[10px] text-slate-400 font-mono">
              {decisions.length} Decision{decisions.length !== 1 ? 's' : ''} across {gws.length} Gameweek{gws.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2">
          {/* Enveloped Chevron Bar */}
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-fpl-border/50">
            <button 
              onClick={() => {
                setViewAll(false);
                setSelectedGwIndex(prev => Math.min(gws.length - 1, prev + 1));
              }}
              disabled={viewAll || activeGwIndex >= gws.length - 1}
              className="p-0.5 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" 
              title="Previous Gameweek"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <span className="text-[8.5px] font-mono text-emerald-400 font-bold px-1.5 select-none">
              {viewAll ? `GWs ${gws[gws.length - 1]}–${gws[0]}` : `GW ${currentGw}`}
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
          {gws.length > 1 && (
            <div className="hidden md:flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              {gws.map((gw, idx) => (
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
          {gws.length > 1 && (
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
      
      {/* Decisions List for Active Gameweek */}
      <div className="space-y-3">
        {visibleDecisions.map((decision) => (
          <div key={decision.id} className="bg-slate-950 border border-fpl-border rounded-xl p-4 shadow-sm">
            <div className="flex justify-between items-start mb-2.5">
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
                "px-2 py-0.5 rounded text-[9px] font-black uppercase font-mono",
                decision.confidence >= 80 ? 'bg-fpl-green/10 text-fpl-green border border-fpl-green/20' :
                decision.confidence >= 50 ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                'bg-red-500/10 text-red-400 border border-red-500/20'
              )}>
                {decision.confidence}% confidence
              </span>
            </div>
            
            <div className="flex items-center gap-2 mb-2 mt-1">
              <TrendingUp className="w-4 h-4 text-fpl-green shrink-0" />
              <span className="text-sm font-bold text-white leading-tight">{decision.decision}</span>
            </div>
            
            {decision.userPrompt && decision.userPrompt.trim() !== '' && (
              <div className="bg-slate-900/80 rounded-lg p-2.5 border-l-2 border-slate-600 mb-2 flex items-start gap-2">
                <MessageSquareQuote className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-300 italic leading-relaxed">"{decision.userPrompt}"</p>
              </div>
            )}
            
            <div className="bg-slate-900/50 rounded-lg p-3 border-l-2 border-fpl-green">
              <p className="text-xs text-slate-300 leading-relaxed">{decision.reasoning}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
