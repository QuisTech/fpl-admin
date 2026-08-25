import { cn } from '../lib/utils';
import { RecommendationResponse, ScoredPlayer } from '../types';
import { Calendar } from 'lucide-react';

interface FixtureListProps {
  data: RecommendationResponse | null;
}

export const FixtureList = ({ data }: FixtureListProps) => {
  if (!data?.squad || data.squad.length === 0) return null;

  // Group by unique team to avoid duplicate rows
  const uniqueTeamMap = new Map<string, ScoredPlayer>();
  data.squad.forEach(p => {
    if (p.team_short_name && !uniqueTeamMap.has(p.team_short_name)) {
      uniqueTeamMap.set(p.team_short_name, p);
    }
  });

  const uniqueTeams = Array.from(uniqueTeamMap.values()).slice(0, 6);

  return (
    <div className="bg-card-bg border border-fpl-border rounded-3xl p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-fpl-green" /> Fixture Ticker
        </h2>
        <span className="text-[9px] font-mono text-slate-500 font-bold">Next 3 GWs</span>
      </div>

      <div className="space-y-2">
        {uniqueTeams.map(p => {
          const fixtures = p.next_fixtures || [];
          return (
            <div key={p.id} className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-950/60 border border-fpl-border/30">
              <div className="flex items-center gap-1.5 min-w-[45px]">
                <span className="text-[11px] font-black text-white">{p.team_short_name}</span>
              </div>
              <div className="flex items-center gap-1 flex-1 justify-end">
                {fixtures.length > 0 ? (
                  fixtures.slice(0, 3).map((f, i) => (
                    <div 
                      key={i} 
                      title={`${f.opponent} (${f.is_home ? 'Home' : 'Away'}) - FDR ${f.difficulty}`}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-bold font-mono text-center min-w-[42px]",
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
                  <span className="text-[8px] text-slate-600 font-mono italic">Schedule pending</span>
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
