import { useState, useEffect } from 'react';
import { Activity, Users, DollarSign, ArrowUpRight } from 'lucide-react';
import { auth } from '../../lib/firebase';

export function AnalyticsPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/analytics/stats', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error("Failed to fetch stats:", e);
      setStats({
        error: true,
        totalUsers: 0,
        betaTesters: 0,
        payingUsers: 0,
        mrr: 0,
        recentPayments: [],
        tierDistribution: []
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading || !stats) {
    return <div className="text-slate-500 animate-pulse">Loading analytics...</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2">Platform Analytics</h2>
        <p className="text-slate-400">Overview of users, revenue, and tier distribution.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-500 uppercase">Total Users</h3>
            <Users className="w-5 h-5 text-fpl-purple" />
          </div>
          <div className="text-3xl font-black">{stats.totalUsers || 0}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-500 uppercase">Paying Subs</h3>
            <Activity className="w-5 h-5 text-fpl-green" />
          </div>
          <div className="text-3xl font-black text-fpl-green">{stats.payingUsers || 0}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-500 uppercase">Beta Testers</h3>
            <Activity className="w-5 h-5 text-yellow-500" />
          </div>
          <div className="text-3xl font-black text-yellow-500">{stats.betaTesters || 0}</div>
        </div>

        <div className="bg-slate-900 border border-fpl-green/30 rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-fpl-green/5"></div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-emerald-400 uppercase">Est. MRR</h3>
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="text-3xl font-black text-white">${(stats.mrr || 0).toFixed(2)}</div>
            <p className="text-xs text-emerald-500/70 mt-2 font-mono">Via Dodo Payments</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Tier Distribution */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h3 className="font-bold mb-6">Tier Distribution</h3>
          <div className="space-y-4">
            {stats.tierDistribution?.map((tier: any) => {
              const max = Math.max(...stats.tierDistribution.map((t: any) => t.value || 0), 1);
              const percentage = Math.round(((tier.value || 0) / max) * 100);
              return (
                <div key={tier.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-bold text-slate-300">{tier.name}</span>
                    <span className="text-slate-500">{tier.value || 0}</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-2">
                    <div className="bg-fpl-green h-2 rounded-full" style={{ width: `${percentage}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Dodo Payments */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h3 className="font-bold mb-6 flex items-center justify-between">
            Recent Payments
            <a href="https://app.dodopayments.com" target="_blank" rel="noreferrer" className="text-xs text-fpl-green flex items-center gap-1 hover:underline">
              Dodo Dashboard <ArrowUpRight className="w-3 h-3" />
            </a>
          </h3>
          {stats.recentPayments?.length > 0 ? (
            <div className="space-y-3">
              {stats.recentPayments.slice(0, 5).map((payment: any) => (
                <div key={payment.payment_id} className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-white">{payment.customer?.email || 'Unknown'}</span>
                    <span className="text-xs text-slate-500">{new Date(payment.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="text-right flex flex-col">
                    <span className="text-sm font-black text-fpl-green">
                      {payment.currency === 'USD' ? '$' : payment.currency}{(payment.total_amount / 100).toFixed(2)}
                    </span>
                    <span className="text-[10px] uppercase text-slate-500">{payment.status}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500 py-8 text-center bg-slate-950 rounded-lg border border-slate-800 border-dashed">
              No recent payments found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
