import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Users, ShieldAlert, Activity, LayoutDashboard, Settings } from 'lucide-react';
import { auth, onAuthStateChanged } from '../lib/firebase';
import { cn } from '../lib/utils';

export function AdminLayout() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setIsAdmin(false);
        return;
      }

      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/check', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        
        if (res.ok) {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
        }
      } catch (err) {
        setIsAdmin(false);
      }
    });

    return () => unsubscribe();
  }, []);

  if (isAdmin === null) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-fpl-green"></div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center text-white">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-slate-400 mb-6">You do not have permission to view the admin dashboard.</p>
        <button 
          onClick={() => navigate('/')}
          className="bg-fpl-green text-slate-900 px-6 py-2 rounded-lg font-bold hover:bg-emerald-400 transition"
        >
          Return to App
        </button>
      </div>
    );
  }

  const navItems = [
    { path: '/admin/users', label: 'Users', icon: Users },
    { path: '/admin/beta', label: 'Beta Program', icon: ShieldAlert },
    { path: '/admin/analytics', label: 'Analytics', icon: Activity },
    { path: '/admin/features', label: 'Features', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#020617] text-white flex">
      {/* Sidebar */}
      <div className="w-64 border-r border-slate-800 bg-slate-950 p-4 flex flex-col">
        <div className="flex items-center gap-2 px-2 py-4 mb-6">
          <LayoutDashboard className="w-6 h-6 text-fpl-green" />
          <span className="font-bold text-lg tracking-wider uppercase text-fpl-green">Admin</span>
        </div>

        <nav className="flex-1 space-y-2">
          {navItems.map(item => {
            const active = location.pathname.startsWith(item.path);
            return (
              <Link 
                key={item.path} 
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm font-semibold",
                  active ? "bg-fpl-green/10 text-fpl-green" : "text-slate-400 hover:text-white hover:bg-slate-900"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        
        <div className="mt-auto pt-4 border-t border-slate-800">
          <Link to="/" className="text-sm text-slate-500 hover:text-white transition flex items-center gap-2 px-2 py-2">
            ← Back to main app
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-[#020617] p-8 relative">
        <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.1) 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.1) 40px)` }}></div>
        <div className="relative z-10 max-w-6xl mx-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
