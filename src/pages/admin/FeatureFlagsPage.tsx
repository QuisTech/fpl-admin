import { useState, useEffect } from 'react';
import { ToggleRight, CheckCircle } from 'lucide-react';
// Assuming you have some firestore/remote-config way of storing flags
// For this simple version, we'll store them in a 'settings/features' document

export function FeatureFlagsPage() {
  const [flags, setFlags] = useState<{ [key: string]: boolean }>({
    enable_v3_engine: true,
    show_grand_cru_upsell: true,
    maintenance_mode: false,
    enable_beta_pilot: true
  });
  const [saving, setSaving] = useState(false);

  const toggleFlag = (key: string) => {
    setFlags(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const saveFlags = async () => {
    setSaving(true);
    try {
      // Dummy timeout since we haven't implemented a backend endpoint for saving flags
      // but the UI is here for future integration.
      await new Promise(r => setTimeout(r, 1000));
      alert('Feature flags saved successfully (Simulated)');
    } catch (e) {
      alert('Error saving flags');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <ToggleRight className="w-6 h-6 text-fpl-purple" />
          Feature Flags
        </h2>
        <p className="text-slate-400">Toggle features globally for all users without redeploying.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="space-y-6">
          {Object.entries(flags).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between p-4 bg-slate-950 rounded-lg border border-slate-800">
              <div className="flex flex-col">
                <span className="font-bold text-white font-mono">{key}</span>
                <span className="text-xs text-slate-500 mt-1">
                  {value ? 'Currently enabled' : 'Currently disabled'}
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={value}
                  onChange={() => toggleFlag(key)}
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-fpl-green"></div>
              </label>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-6 border-t border-slate-800 flex justify-end">
          <button 
            onClick={saveFlags}
            disabled={saving}
            className="bg-fpl-purple text-white font-bold px-6 py-2 rounded-lg hover:bg-purple-600 transition flex items-center gap-2"
          >
            {saving ? 'Saving...' : (
              <>
                <CheckCircle className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
