import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MarketDashboard } from './MarketDashboard';
import { useTradeStore } from './store';
import { isLoggedIn, getUser, clearAuth } from './auth';
import { useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';

// ── Protected route wrapper ───────────────────────────────────────────────────

function ProtectedApp() {
  const navigate = useNavigate();
  const alerts = useTradeStore(state => state.alerts);
  const removeAlert = useTradeStore(state => state.removeAlert);
  const user = getUser();

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  return (
    <div className="app relative text-slate-200">
      <header className="app-header h-14 shrink-0">
        <div className="logo">
          <span className="logo-icon">🐂</span>
          <span className="logo-text text-white">Bull Tech</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-slate-400 font-mono hidden sm:block">hft-gateway-us-east-1</div>
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 hidden sm:block">
                <span className="text-slate-500">@</span>{user.username}
                {user.role === 'admin' && (
                  <span className="ml-1.5 text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5 uppercase tracking-wider">
                    Admin
                  </span>
                )}
              </span>
              <button
                onClick={handleLogout}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors border border-[#1e1e2e] rounded px-2 py-1"
              >
                Sign out
              </button>
            </div>
          )}
          <span className="status-badge">
            <span className="pulse"></span>
            Live
          </span>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <MarketDashboard />
      </main>

      {/* Toast Container */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {alerts.map(alert => (
          <div
            key={alert.id}
            className={`p-4 rounded-lg shadow-lg border backdrop-blur-md w-80 flex justify-between items-start cursor-pointer transition-all animate-in slide-in-from-right-8 opacity-100 ${
              alert.type === 'critical'
                ? 'bg-red-950/80 border-red-500/50 text-red-100'
                : 'bg-blue-950/80 border-blue-500/50 text-blue-100'
            }`}
            onClick={() => removeAlert(alert.id)}
          >
            <div className="flex flex-col gap-1">
              <span className="font-bold text-sm tracking-wide">
                {alert.type === 'critical' ? 'CRITICAL ALERT' : 'INFO'}
              </span>
              <span className="text-xs opacity-90 leading-relaxed">{alert.message}</span>
            </div>
            <button
              className="text-white/50 hover:text-white"
              onClick={e => { e.stopPropagation(); removeAlert(alert.id); }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Auth guard (must live inside BrowserRouter to re-render on navigation) ────

function RequireAuth() {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <ProtectedApp />;
}

// ── Root: router + auth guard ─────────────────────────────────────────────────

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/*"        element={<RequireAuth />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
