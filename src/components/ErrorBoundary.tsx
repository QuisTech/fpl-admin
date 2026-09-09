import React, { ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends (React.Component as any)<Props, State> {
  state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: any) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#020617] text-[#f8fafc] flex flex-col items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-slate-950/90 border border-red-500/40 rounded-3xl p-6 shadow-2xl space-y-4 text-center relative overflow-hidden">
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h2 className="text-lg font-black tracking-wide text-white uppercase">Application Encountered an Error</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                The interface caught an unhandled runtime error. Your squad data and settings remain safe.
              </p>
            </div>

            {this.state.error && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-left">
                <p className="text-[10px] font-mono font-bold text-red-400 truncate">
                  {this.state.error.name}: {this.state.error.message}
                </p>
              </div>
            )}

            <button
              onClick={this.handleReset}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-fpl-green text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl hover:bg-fpl-green/90 transition-all shadow-[0_0_15px_rgba(0,255,133,0.3)] cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }

    return (this.props as any).children;
  }
}
