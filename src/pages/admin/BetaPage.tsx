import { useState, useEffect } from 'react';
import { ShieldAlert, Upload, Clock, Activity } from 'lucide-react';
import Papa from 'papaparse';
import { auth } from '../../lib/firebase';

export function BetaPage() {
  const [testers, setTesters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extending, setExtending] = useState(false);

  useEffect(() => {
    fetchTesters();
  }, []);

  const fetchTesters = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/beta-testers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setTesters(data.testers || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!csvFile) return;
    setUploading(true);
    
    Papa.parse(csvFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const token = await auth.currentUser?.getIdToken();
          const res = await fetch('/api/admin/bulk-grant-beta', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}` 
            },
            body: JSON.stringify({ rows: results.data })
          });
          const data = await res.json();
          alert(`Successfully granted beta to ${data.count} users!`);
          setCsvFile(null);
          fetchTesters();
        } catch (e) {
          alert('Error processing CSV');
        } finally {
          setUploading(false);
        }
      }
    });
  };

  const handleExtendAll = async () => {
    if (!confirm('Extend ALL beta testers by 7 days?')) return;
    setExtending(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/extend-all-beta', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ days: 7 })
      });
      const data = await res.json();
      alert(`Extended ${data.count} testers.`);
      fetchTesters();
    } catch (e) {
      alert('Error extending beta');
    } finally {
      setExtending(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 text-yellow-500" />
          Beta Program Management
        </h2>
        <p className="text-slate-400">Manage early access, time-limited trials, and pilot programs.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Bulk Upload Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h3 className="font-bold mb-4 flex items-center gap-2">
            <Upload className="w-4 h-4 text-fpl-green" />
            Bulk Invite (CSV)
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            Upload a CSV with <code className="bg-slate-950 px-1 py-0.5 rounded text-fpl-green">email</code>, <code className="bg-slate-950 px-1 py-0.5 rounded text-fpl-green">tier</code>, and <code className="bg-slate-950 px-1 py-0.5 rounded text-fpl-green">expiryDays</code> headers.
          </p>
          
          <div className="flex items-center gap-4">
            <input 
              type="file" 
              accept=".csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              className="text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-slate-800 file:text-white hover:file:bg-slate-700"
            />
            <button 
              onClick={handleUpload}
              disabled={!csvFile || uploading}
              className="bg-fpl-green text-slate-900 font-bold px-4 py-2 rounded-lg hover:bg-emerald-400 disabled:opacity-50 transition"
            >
              {uploading ? 'Processing...' : 'Upload & Process'}
            </button>
          </div>
        </div>

        {/* Global Controls */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h3 className="font-bold mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-fpl-green" />
            Global Controls
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            Extend all current active beta testers' expiry dates globally.
          </p>
          <button 
            onClick={handleExtendAll}
            disabled={extending || testers.length === 0}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 rounded-lg border border-slate-700 transition"
          >
            {extending ? 'Extending...' : `Extend All ${testers.length} Testers (+7 Days)`}
          </button>
        </div>
      </div>

      {/* Tester List */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h3 className="font-bold mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-fpl-green" />
          Active Beta Testers ({testers.length})
        </h3>
        
        {loading ? (
          <div className="text-slate-500 text-sm">Loading testers...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500 uppercase bg-slate-950/50">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">User Email</th>
                  <th className="px-4 py-3">Granted Tier</th>
                  <th className="px-4 py-3 rounded-tr-lg">Expiry Date</th>
                </tr>
              </thead>
              <tbody>
                {testers.map((t, i) => {
                  const expiry = t.beta_expires_at?._seconds ? new Date(t.beta_expires_at._seconds * 1000) : null;
                  const isExpired = expiry && expiry < new Date();
                  
                  return (
                    <tr key={t.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20">
                      <td className="px-4 py-3 font-semibold text-slate-200">{t.email}</td>
                      <td className="px-4 py-3">
                        <span className="bg-slate-800 px-2 py-1 rounded text-xs uppercase font-bold text-slate-400">
                          {t.beta_tier || t.tier || 'free'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {expiry ? (
                          <span className={isExpired ? "text-red-400" : "text-slate-300"}>
                            {expiry.toLocaleDateString()} {isExpired && '(Expired)'}
                          </span>
                        ) : 'Never'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
