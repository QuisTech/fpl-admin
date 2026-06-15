import { useState, useEffect } from 'react';
import { Search, Edit2, ShieldAlert, CheckCircle, XCircle, Users } from 'lucide-react';
import { auth } from '../../lib/firebase';

export function UsersPage() {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length >= 3) {
        searchUsers(query);
      } else if (query.trim().length === 0) {
        setUsers([]);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [query]);

  const searchUsers = async (q: string) => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/search-users?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div className="md:col-span-1 border-r border-slate-800 pr-8 min-h-[500px]">
        <h2 className="text-xl font-bold mb-6">User Management</h2>
        <div className="relative mb-6">
          <input 
            type="text" 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search email or ID..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm focus:border-fpl-green focus:outline-none"
          />
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
        </div>

        {loading && <div className="text-sm text-slate-500">Searching...</div>}

        <div className="space-y-2">
          {users.map(u => (
            <button 
              key={u.id}
              onClick={() => setSelectedUser(u)}
              className={`w-full text-left p-3 rounded-lg border ${selectedUser?.id === u.id ? 'border-fpl-green bg-fpl-green/10' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}
            >
              <div className="font-semibold text-sm truncate">{u.email}</div>
              <div className="text-xs text-slate-500 mt-1 flex justify-between">
                <span className="uppercase">{u.tier || 'free'}</span>
                {u.beta_tester && <span className="text-yellow-500">Beta</span>}
              </div>
            </button>
          ))}
          {users.length === 0 && query.length >= 3 && !loading && (
            <div className="text-sm text-slate-500">No users found.</div>
          )}
        </div>
      </div>

      <div className="md:col-span-2">
        {selectedUser ? (
          <UserDetails user={selectedUser} onUpdate={() => searchUsers(query)} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <Users className="w-12 h-12 mb-4 opacity-50" />
            <p>Select a user to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function UserDetails({ user, onUpdate }: { user: any, onUpdate: () => void }) {
  const [tier, setTier] = useState(user.tier || 'free');
  const [isBeta, setIsBeta] = useState(!!user.beta_tester);
  const [expiryDays, setExpiryDays] = useState(14);
  const [notes, setNotes] = useState(user.admin_notes || '');
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    setTier(user.tier || 'free');
    setIsBeta(!!user.beta_tester);
    setNotes(user.admin_notes || '');
    fetchLogs();
  }, [user]);

  const fetchLogs = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/audit-log?userId=${user.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setLogs(data.logs || []);
    } catch(e) {}
  };

  const handleGrant = async () => {
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      
      const payload: any = { userId: user.id, tier, notes };
      if (isBeta) {
        const d = new Date();
        d.setDate(d.getDate() + expiryDays);
        payload.beta_expires_at = d.toISOString();
      }

      await fetch('/api/admin/grant-tier-access', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(payload)
      });
      onUpdate();
      fetchLogs();
      alert('Success!');
    } catch (e) {
      alert('Error updating user');
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async () => {
    if (!confirm('Revoke access and set to free?')) return;
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      await fetch('/api/admin/revoke-access', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ userId: user.id })
      });
      onUpdate();
      fetchLogs();
      alert('Access revoked');
    } catch (e) {
      alert('Error revoking');
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePortal = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/customer-portal', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ userId: user.id })
      });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank');
      } else {
        alert(data.error || 'Failed to generate link');
      }
    } catch (e) {
      alert('Error generating portal link');
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-xl font-bold">{user.email}</h3>
          <p className="text-slate-400 text-sm font-mono mt-1">{user.id}</p>
        </div>
        <div className="flex gap-2">
          {user.dodoCustomerId && (
            <button onClick={handleGeneratePortal} className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg transition border border-slate-700">
              Dodo Portal
            </button>
          )}
          <button onClick={handleRevoke} className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-bold rounded-lg transition border border-red-500/30">
            Revoke Access
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Subscription Tier</label>
          <select 
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm focus:border-fpl-green focus:outline-none"
          >
            <option value="free">Free</option>
            <option value="strategist">Strategist</option>
            <option value="grandCru">Grand Cru</option>
            <option value="aiAgent">AI Agent</option>
          </select>
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase mb-2 cursor-pointer">
            <input type="checkbox" checked={isBeta} onChange={(e) => setIsBeta(e.target.checked)} className="accent-fpl-green" />
            Mark as Beta Tester
          </label>
          {isBeta && (
            <div className="flex items-center gap-2">
              <input 
                type="number" 
                value={expiryDays}
                onChange={(e) => setExpiryDays(parseInt(e.target.value))}
                className="w-20 bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm focus:border-fpl-green"
              />
              <span className="text-sm text-slate-400">days from now</span>
            </div>
          )}
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Admin Notes</label>
        <textarea 
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes about this user..."
          className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm min-h-[100px] focus:border-fpl-green focus:outline-none"
        ></textarea>
      </div>

      <button 
        onClick={handleGrant}
        disabled={saving}
        className="w-full bg-fpl-green text-slate-900 font-bold py-3 rounded-xl hover:bg-emerald-400 transition flex items-center justify-center gap-2"
      >
        {saving ? 'Saving...' : (
          <>
            <CheckCircle className="w-5 h-5" />
            Update User Access
          </>
        )}
      </button>

      {/* Audit Logs */}
      {logs.length > 0 && (
        <div className="mt-8 pt-8 border-t border-slate-800">
          <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Audit Log</h4>
          <div className="space-y-3">
            {logs.map(log => (
              <div key={log.id} className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs flex justify-between items-start">
                <div>
                  <span className="font-bold text-white">{log.action}</span>
                  <div className="text-slate-500 mt-1 font-mono">{JSON.stringify(log.changes)}</div>
                </div>
                <div className="text-slate-600">
                  {log.timestamp?._seconds ? new Date(log.timestamp._seconds * 1000).toLocaleDateString() : 'Just now'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
