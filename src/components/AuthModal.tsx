import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Mail, Lock, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from '../lib/firebase';
import { cn } from '../lib/utils';
import axios from 'axios';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  anonymousId: string;
}

const getAuthErrorMessage = (err: any, isGoogle: boolean = false): string => {
  const code = err?.code || '';
  const message = err?.message || '';

  if (isGoogle) {
    if (code === 'auth/popup-closed-by-user') {
      return 'Google sign-in popup was closed before completing. Please try again.';
    }
    if (code === 'auth/popup-blocked') {
      return 'Google sign-in popup was blocked by your browser. Please allow popups for this site and try again.';
    }
    if (code === 'auth/cancelled-popup-request') {
      return 'Google sign-in was cancelled. Please try again.';
    }
    if (code === 'auth/invalid-credential' || message.includes('userinfo') || message.includes('401')) {
      return 'Google authentication session expired or was blocked by browser cross-site tracking protections. Please try again with "Continue with Google", or reset your password to log in with email.';
    }
    return 'Google authentication could not be completed. Please try again or log in with email.';
  }

  // Email / Password flow
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Invalid email or password. If you originally registered with Google, please click "Continue with Google" below, or use "Forgot password?" to set a password.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'An account with this email already exists. Please log in or click "Continue with Google".';
  }
  if (code === 'auth/weak-password') {
    return 'Password must be at least 6 characters.';
  }
  if (code === 'auth/invalid-email') {
    return 'Please enter a valid email address.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many failed login attempts. Please reset your password or try again in a few minutes.';
  }
  return message || 'Authentication failed. Please try again.';
};

export const AuthModal = ({ isOpen, onClose, anonymousId }: AuthModalProps) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  // Helper to merge anonymous tier after successful auth
  const handleMerge = async (user: any) => {
    try {
      const idToken = await user.getIdToken();
      // Pass the new user ID, old anonymous ID, and bearer token to backend to merge
      await axios.post('/api/auth/merge', {
        newUserId: user.uid,
        anonymousId: anonymousId
      }, {
        headers: {
          Authorization: `Bearer ${idToken}`
        }
      });
      onClose();
    } catch (err) {
      console.error("Merge error:", err);
      // We still close because auth succeeded
      onClose();
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResetSent(false);
    try {
      let result;
      if (isLogin) {
        result = await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        result = await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
      await handleMerge(result.user);
    } catch (err: any) {
      setError(getAuthErrorMessage(err, false));
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError(null);
    setResetSent(false);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await handleMerge(result.user);
    } catch (err: any) {
      setError(getAuthErrorMessage(err, true));
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      setError("Please enter your email address above first to receive a password reset link.");
      return;
    }
    setResetLoading(true);
    setError(null);
    setResetSent(false);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
    } catch (err: any) {
      setError(getAuthErrorMessage(err, false));
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-slate-950 border border-fpl-border rounded-2xl shadow-2xl z-50 overflow-hidden"
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-xl font-black text-white uppercase tracking-wider">
                    {isLogin ? 'Welcome Back' : 'Claim Account'}
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    {isLogin ? 'Log in to sync your tiers.' : 'Save your anonymous tier permanently.'}
                  </p>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-slate-900 rounded-lg transition-colors text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-400 leading-relaxed">{error}</p>
                </div>
              )}

              {resetSent && (
                <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-300 leading-relaxed">
                    Password reset link sent to <strong>{email}</strong>! Check your inbox to create or reset your password.
                  </p>
                </div>
              )}

              <form onSubmit={handleEmailAuth} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-slate-400">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input 
                      type="email" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full bg-slate-900 border border-fpl-border rounded-lg py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-fpl-green transition-colors"
                      placeholder="manager@example.com"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase text-slate-400">Password</label>
                    {isLogin && (
                      <button
                        type="button"
                        onClick={handleResetPassword}
                        disabled={resetLoading}
                        className="text-[10px] text-fpl-green/80 hover:text-fpl-green hover:underline font-bold transition-colors disabled:opacity-50"
                      >
                        {resetLoading ? 'Sending...' : 'Forgot password?'}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input 
                      type="password" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="w-full bg-slate-900 border border-fpl-border rounded-lg py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-fpl-green transition-colors"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full bg-fpl-green hover:bg-fpl-green/90 text-slate-950 font-black uppercase tracking-widest text-sm py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                  {isLogin ? 'Log In' : 'Sign Up'}
                </button>
              </form>

              <div className="my-6 flex items-center gap-4">
                <div className="h-px bg-fpl-border flex-grow"></div>
                <span className="text-[10px] uppercase font-bold text-slate-500">OR</span>
                <div className="h-px bg-fpl-border flex-grow"></div>
              </div>

              <button 
                onClick={handleGoogleAuth}
                disabled={loading}
                className="w-full bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm py-2.5 rounded-lg transition-colors flex items-center justify-center gap-3 disabled:opacity-50 cursor-pointer"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <div className="mt-6 text-center">
                <button 
                  onClick={() => {
                    setIsLogin(!isLogin);
                    setError(null);
                    setResetSent(false);
                  }}
                  className="text-xs text-slate-400 hover:text-fpl-green transition-colors font-bold cursor-pointer"
                >
                  {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Log In"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

