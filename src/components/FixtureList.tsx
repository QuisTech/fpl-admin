import { cn } from '../lib/utils';
import { RecommendationResponse } from '../types';

interface FixtureListProps {
  data: RecommendationResponse | null;
}

export const FixtureList = ({ data }: FixtureListProps) => {
  return (
    <div className="bg-card-bg border border-fpl-border rounded-3xl p-5 shadow-sm">
      <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Fixture Ticker</h2>
      <div className="space-y-4">
        {data?.squad?.slice(0, 5).map(p => (
          <div key={p.id} className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[10px] font-bold">
              <span className="text-slate-200">{p.team_short_name}</span>
              <span className="text-slate-500">({p.next_fixtures?.map(f => f.opponent).join(', ')})</span>
            </div>
            <div className="flex gap-1 h-2.5">
              {p.next_fixtures?.map((f, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "flex-grow rounded-sm transition-opacity hover:opacity-100 opacity-80",
                    f.difficulty === 2 ? "bg-fpl-green" :
                    f.difficulty === 3 ? "bg-amber-500" :
                    f.difficulty === 4 ? "bg-rose-500" : "bg-fpl-pink"
                  )}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* Optimization Note */}
      <div className="mt-6 p-2 bg-slate-950 rounded-xl border border-fpl-border">
        <div className="text-[9px] text-slate-500 uppercase mb-1 font-black tracking-widest">Logic Engine</div>
        <p className="text-[10px] leading-tight text-slate-400 italic">Expected points modeled and optimized using AI simulations.</p>
      </div>
    </div>
  );
};
