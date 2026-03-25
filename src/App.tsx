import { MarketDashboard } from './MarketDashboard';
import { useTradeStore } from './store';

function App() {
  const alerts = useTradeStore(state => state.alerts);
  const removeAlert = useTradeStore(state => state.removeAlert);

  return (
    <div className="app relative text-slate-200">
      <header className="app-header h-14 shrink-0">
        <div className="logo">
          <span className="logo-icon">🐂</span>
          <span className="logo-text text-white">Bull Tech</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-slate-400 font-mono hidden sm:block">hft-gateway-us-east-1</div>
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
          <div key={alert.id} className={`p-4 rounded-lg shadow-lg border backdrop-blur-md w-80 flex justify-between items-start cursor-pointer transition-all animate-in slide-in-from-right-8 opacity-100 ${alert.type === 'critical' ? 'bg-red-950/80 border-red-500/50 text-red-100' : 'bg-blue-950/80 border-blue-500/50 text-blue-100'}`} onClick={() => removeAlert(alert.id)}>
            <div className="flex flex-col gap-1">
              <span className="font-bold text-sm tracking-wide">{alert.type === 'critical' ? 'CRITICAL ALERT' : 'INFO'}</span>
              <span className="text-xs opacity-90 leading-relaxed">{alert.message}</span>
            </div>
            <button className="text-white/50 hover:text-white" onClick={(e) => { e.stopPropagation(); removeAlert(alert.id); }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
