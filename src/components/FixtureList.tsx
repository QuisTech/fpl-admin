import { useState } from 'react';
import { cn } from '../lib/utils';
import { RecommendationResponse, ScoredPlayer } from '../types';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface FixtureListProps {
  data: RecommendationResponse | null;
}

export const FixtureList = ({ data }: FixtureListProps) => {
  const [windowOffset, setWindowOffset] = useState(0);
  const WINDOW_SIZE = 3;

  if (!data?.squad || data.squad.length === 0) return null;

  // Group by unique team to avoid duplicate rows
  const uniqueTeamMap = new Map<string, ScoredPlayer>();
  data.squad.forEach(p => {
    if (p.team_short_name && !uniqueTeamMap.has(p.team_short_name)) {
      uniqueTeamMap.set(p.team_short_name, p);
    }
  });

  const uniqueTeams = Array.from(uniqueTeamMap.values()).slice(0, 8);
  
  // Find maximum available fixtures across all teams
  const maxAvailableFixtures = Math.max(...uniqueTeams.map(t => t.next_fixtures?.length || 0), 1);
  const maxOffset = Math.max(0, maxAvailableFixtures - WINDOW_SIZE);

  const handlePrev = () => setWindowOffset(prev => Math.max(0, prev - WINDOW_SIZE));
  const handleNext = () => setWindowOffset(prev => Math.min(maxOffset, prev + WINDOW_SIZE));

  const currentWindowStart = windowOffset + 1;
  const currentWindowEnd = Math.min(windowOffset + WINDOW_SIZE, maxAvailableFixtures);

  return (
    <div className="bg-card-bg border border-fpl-border rounded-3xl p-4 sm:p-5 shadow-sm">
      {/* Header with Navigation Controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-fpl-green" />
          <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fixture Ticker</h2>
        </div>

        {/* Pager controls */}
        <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-fpl-border/50">
          <button
            onClick={handlePrev}
            disabled={windowOffset === 0}
            className="p-0.5 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Previous fixtures"
          >
            <ChevronLeft className="w-3 h-3" />
          </button>
          
          <span className="text-[8.5px] font-mono text-emerald-400 font-bold px-1 select-none">
            GWs {currentWindowStart}–{currentWindowEnd}
          </span>

          <button
            onClick={handleNext}
            disabled={windowOffset >= maxOffset}
            className="p-0.5 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Next fixtures"
          >
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Fixture Rows */}
      <div className="space-y-2">
        {uniqueTeams.map(p => {
          const allFixtures = p.next_fixtures || [];
          const visibleFixtures = allFixtures.slice(windowOffset, windowOffset + WINDOW_SIZE);

          return (
            <div key={p.id} className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-950/60 border border-fpl-border/30 hover:border-slate-700 transition-colors">
              <div className="flex items-center gap-1.5 min-w-[45px]">
                <span className="text-[11px] font-black text-white">{p.team_short_name}</span>
              </div>
              <div className="flex items-center gap-1 flex-1 justify-end">
                {visibleFixtures.length > 0 ? (
                  visibleFixtures.map((f, i) => (
                    <div 
                      key={i} 
                      title={`${f.opponent} (${f.is_home ? 'Home' : 'Away'}) - FDR ${f.difficulty}${f.event ? ` (GW${f.event})` : ''}`}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-bold font-mono text-center min-w-[42px] transition-transform hover:scale-105",
                        f.difficulty <= 2 ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" :
                        f.difficulty === 3 ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" :
                        f.difficulty === 4 ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" :
                        "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                      )}
                    >
                      {f.opponent} <span className="text-[7px] text-slate-400 font-normal">{f.is_home ? 'H' : 'A'}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-[8px] text-slate-600 font-mono italic">No more fixtures</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Color Legend */}
      <div className="mt-4 p-2 bg-slate-950 rounded-xl border border-fpl-border/40 flex items-center justify-between text-[8px] text-slate-400 font-mono">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> Easy (2)</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" /> Med (3)</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" /> Hard (4+)</span>
      </div>
    </div>
  );
};
