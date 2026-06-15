import { Check, Crown, Lock, MessageSquareCode, Rocket, ShieldCheck, Sparkles } from 'lucide-react';
import { optimizerPlans, tierFeatureMatrix } from '../lib/plans';
import { cn } from '../lib/utils';
import { StripeCheckout } from './StripeCheckout';

const productLadder = [
  {
    name: 'Horizon Strategist',
    label: 'Original app',
    icon: ShieldCheck,
    description: 'A weekly LP optimizer for managers who want a clean answer fast: optimal squad, risk modes, team sync, and practical transfer tips.',
    metrics: ['1 GW lookahead', 'LP squad solver', 'Rules-based chips']
  },
  {
    name: 'AI Optimizer Agent',
    label: 'Flagship AI',
    icon: MessageSquareCode,
    description: 'The ultimate hybrid assistant: conversational team analysis, automated press conference/injury parsing, and interactive path simulations.',
    metrics: ['8 GW lookahead', 'Conversational UI', 'News-aware solver']
  }
];

export const OptimizerPositioning = ({ userId, currentTier }: { userId: string; currentTier: string }) => {
  return (
    <div className="space-y-6 overflow-y-auto pr-2 custom-scrollbar">
      <section className="rounded-2xl border border-fpl-border bg-slate-950/50 p-5 sm:p-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-fpl-green/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-fpl-green border border-fpl-green/20">
                Product ladder
              </span>
              <span className="rounded bg-slate-900 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-300 border border-cyan-500/20">
                FPL Optimizer
              </span>
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                The future of decision support: The Hybrid AI Agent.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
                FPL Optimizer bridges the gap between raw mathematical solvers and real-time manager news. Our roadmap transforms this simulator into the flagship conversational assistant.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {productLadder.map((product) => {
              const Icon = product.icon;
              return (
                <div key={product.name} className="rounded-2xl border border-fpl-border bg-card-bg p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 border border-fpl-border">
                        <Icon className="h-5 w-5 text-fpl-green" />
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{product.label}</p>
                        <h3 className="text-base font-black text-white">{product.name}</h3>
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-xs leading-relaxed text-slate-400">{product.description}</p>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {product.metrics.map((metric) => (
                      <div key={metric} className="rounded-lg border border-fpl-border bg-slate-950/60 px-2 py-2 text-center text-[9px] font-bold uppercase text-slate-300">
                        {metric}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {optimizerPlans.map((plan) => {
          const normalizedCurrentTier = currentTier === 'aiAgent' || currentTier === 'admin' ? 'betaPilot' : currentTier;
          const tierHierarchy: Record<string, number> = { free: 0, strategist: 1, grandCru: 2, betaPilot: 3 };
          const currentTierValue = tierHierarchy[normalizedCurrentTier] || 0;
          const planTierValue = tierHierarchy[plan.id] || 0;
          const isIncluded = planTierValue < currentTierValue && normalizedCurrentTier !== 'free';

          return (
          <div
            key={plan.id}
            className={cn(
              'relative rounded-2xl border bg-card-bg p-5 flex flex-col min-h-[360px]',
              plan.featured ? 'border-fpl-green shadow-[0_0_24px_rgba(0,255,133,0.08)]' : 'border-fpl-border'
            )}
          >
            {plan.featured && (
              <div className="absolute right-4 top-4 rounded bg-fpl-green px-2 py-1 text-[8px] font-black uppercase tracking-widest text-slate-950">
                Flagship Tier
              </div>
            )}
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{plan.audience}</p>
              <h3 className="mt-2 text-lg font-black text-white">{plan.name}</h3>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-2xl font-black text-fpl-green">{plan.price}</span>
                <span className="pb-1 text-[10px] font-bold uppercase text-slate-500">{plan.cadence}</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-400">{plan.summary}</p>
            </div>

            <div className="mt-5 space-y-2 flex-grow">
              {plan.features.map((feature) => (
                <div key={feature} className="flex gap-2 text-[11px] leading-snug text-slate-300">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fpl-green" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>

            {plan.id === normalizedCurrentTier ? (
              <button
                disabled
                className="mt-5 w-full rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors bg-slate-800 text-slate-400 cursor-not-allowed"
              >
                CURRENT PLAN
              </button>
            ) : isIncluded ? (
              <button
                disabled
                className="mt-5 w-full rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors bg-fpl-green/10 text-fpl-green border border-fpl-green/20 cursor-default"
              >
                INCLUDED IN PLAN
              </button>
            ) : plan.id === 'free' ? (
              <button
                className={cn(
                  'mt-5 w-full rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors',
                  plan.featured ? 'bg-fpl-green text-slate-950 hover:bg-fpl-green/90' : 'bg-slate-950 text-white border border-fpl-border hover:bg-slate-900'
                )}
              >
                {plan.cta}
              </button>
            ) : (
              <StripeCheckout 
                userId={userId} 
                tier={plan.id as any} 
                buttonText={plan.cta}
                className={cn(
                  'mt-5 w-full rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors',
                  plan.featured ? 'bg-fpl-green text-slate-950 hover:bg-fpl-green/90' : 'bg-slate-950 text-white border border-fpl-border hover:bg-slate-900'
                )}
              />
            )}
          </div>
        )})}
      </section>

      <section className="rounded-2xl border border-fpl-border bg-card-bg overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-fpl-border p-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-white">Feature gating map</h3>
            <p className="mt-1 text-[11px] text-slate-500">Configure Stripe subscription states and database roles here next.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-fpl-border bg-slate-950 px-3 py-2 text-[10px] font-bold uppercase text-slate-400">
            <Lock className="h-3.5 w-3.5 text-fpl-green" />
            Stripe-ready tiers
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="bg-slate-950/70 text-[9px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-3">Feature</th>
                <th className="px-4 py-3">Free</th>
                <th className="px-4 py-3">Strategist</th>
                <th className="px-4 py-3">Grand Cru</th>
                <th className="px-4 py-3 font-black text-fpl-green">AI Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fpl-border text-[11px] text-slate-300">
              {tierFeatureMatrix.map((row) => (
                <tr key={row.feature} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-bold text-white">{row.feature}</td>
                  <td className="px-4 py-3">{row.free}</td>
                  <td className="px-4 py-3">{row.strategist}</td>
                  <td className="px-4 py-3">{row.grandCru}</td>
                  <td className="px-4 py-3 text-fpl-green font-bold">{row.betaPilot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-fpl-border bg-slate-950/50 p-5">
          <Rocket className="h-5 w-5 text-fpl-green" />
          <h3 className="mt-3 text-sm font-black uppercase tracking-widest text-white">Launch copy</h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Bypass standard mathematical grids. Talk to your personal FPL assistant that evaluates manager statements and executes multi-horizon paths for you.
          </p>
        </div>
        <div className="rounded-2xl border border-fpl-border bg-slate-950/50 p-5">
          <Sparkles className="h-5 w-5 text-fpl-green" />
          <h3 className="mt-3 text-sm font-black uppercase tracking-widest text-white">Upgrade trigger</h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Users see locked AI Agent functions (like live chat scenarios or press conference scraping feeds) when they request complex custom path explanations.
          </p>
        </div>
        <div className="rounded-2xl border border-fpl-border bg-slate-950/50 p-5">
          <ShieldCheck className="h-5 w-5 text-fpl-green" />
          <h3 className="mt-3 text-sm font-black uppercase tracking-widest text-white">Trust notes</h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Make sure to keep public disclaimers transparent: no official relationship to Premier League, entertainment-only focus, and data limits.
          </p>
        </div>
      </section>
    </div>
  );
};
