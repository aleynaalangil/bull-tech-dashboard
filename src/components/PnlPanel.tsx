import { useState, useEffect } from 'react';
import { authFetch, clearAuth } from '../auth';
import { useNavigate } from 'react-router-dom';

interface RealizedPnlDetail {
  symbol: string;
  order_type: 'market' | 'limit' | 'stop_limit';
  pnl: string;
}

interface UnrealizedPositionPnl {
  pnl: string;
  quantity: string;
  avg_buy_price: string;
  current_price: string;
}

interface PnlByOrderType {
  market: string;
  limit: string;
  stop_limit: string;
}

interface PnlStats {
  realized_total: string;
  realized_by_symbol: Record<string, string>;
  realized_by_order_type: PnlByOrderType;
  realized_details: RealizedPnlDetail[];
  unrealized_total: string;
  unrealized_by_symbol: Record<string, UnrealizedPositionPnl>;
}

type OrderTypeFilter = 'all' | 'market' | 'limit' | 'stop_limit';

const formatValue = (val: string | number) => {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return '0.00';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const getPnlColor = (val: string | number) => {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (num > 0) return 'text-green-400';
  if (num < 0) return 'text-red-400';
  return 'text-slate-400';
};

export const PnlPanel = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<PnlStats | null>(null);
  const [filter, setFilter] = useState<OrderTypeFilter>('all');
  const [loading, setLoading] = useState(true);

  const fetchPnl = async () => {
    try {
      const res = await authFetch('/api/v1/account/pnl');
      if (res.status === 401) {
        clearAuth();
        navigate('/login');
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('[PnlPanel] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPnl();
    const interval = setInterval(fetchPnl, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Loading P&L...</span>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const totalPnl = parseFloat(stats.realized_total) + parseFloat(stats.unrealized_total);

  const filteredRealized = filter === 'all' 
    ? stats.realized_details 
    : stats.realized_details.filter(d => d.order_type === filter);

  return (
    <div className="flex flex-col h-full bg-[#0d0d12] text-slate-300 overflow-hidden">
      {/* ── Summary Row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 divide-x divide-[#1e1e2e] border-b border-[#1e1e2e] bg-[#12121a]">
        <div className="p-4 flex flex-col gap-1">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Realized P&L</span>
          <div className={`text-lg font-mono font-bold ${getPnlColor(stats.realized_total)}`}>
            {formatValue(stats.realized_total)} <span className="text-[10px] text-slate-500">USDC</span>
          </div>
        </div>
        <div className="p-4 flex flex-col gap-1">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Unrealized P&L</span>
          <div className={`text-lg font-mono font-bold ${getPnlColor(stats.unrealized_total)}`}>
            {formatValue(stats.unrealized_total)} <span className="text-[10px] text-slate-500">USDC</span>
          </div>
        </div>
        <div className="p-4 flex flex-col gap-1">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total P&L</span>
          <div className={`text-lg font-mono font-bold ${getPnlColor(totalPnl)}`}>
            {formatValue(totalPnl)} <span className="text-[10px] text-slate-500">USDC</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 flex flex-col gap-6">
        {/* ── Realized P&L Breakdown ─────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Realized Breakdown</span>
            <div className="flex gap-1 bg-white/5 p-1 rounded-md">
              {(['all', 'market', 'limit', 'stop_limit'] as OrderTypeFilter[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter transition-all ${
                    filter === t ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t.replace('_', '-')}
                </button>
              ))}
            </div>
          </div>

          <div className="border border-[#1e1e2e] rounded-lg overflow-hidden bg-white/2">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5 text-[9px] font-black uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2 border-b border-[#1e1e2e]">Symbol</th>
                  <th className="px-4 py-2 border-b border-[#1e1e2e]">Order Type</th>
                  <th className="px-4 py-2 border-b border-[#1e1e2e] text-right">Realized P&L</th>
                </tr>
              </thead>
              <tbody className="text-[10px] font-mono">
                {filteredRealized.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-600 font-bold uppercase tracking-widest italic">
                      No matching realized data
                    </td>
                  </tr>
                ) : (
                  filteredRealized.map((row, idx) => (
                    <tr key={`${row.symbol}-${row.order_type}-${idx}`} className="hover:bg-white/5 transition-colors border-b border-[#1e1e2e]/30 last:border-0">
                      <td className="px-4 py-2.5 text-white font-bold">{row.symbol}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded-[4px] font-black uppercase text-[8px] ${
                          row.order_type === 'market' 
                            ? 'bg-slate-800 text-slate-400' 
                            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.1)]'
                        }`}>
                          {row.order_type.replace('_', '-')}
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 text-right font-bold ${getPnlColor(row.pnl)}`}>
                        {formatValue(row.pnl)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Open Positions / Unrealized P&L ────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Open Positions</span>
          <div className="border border-[#1e1e2e] rounded-lg overflow-hidden bg-white/2">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5 text-[9px] font-black uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2 border-b border-[#1e1e2e]">Symbol</th>
                  <th className="px-4 py-2 border-b border-[#1e1e2e]">Qty</th>
                  <th className="px-4 py-2 border-b border-[#1e1e2e]">Avg Entry</th>
                  <th className="px-4 py-2 border-b border-[#1e1e2e]">Mark Price</th>
                  <th className="px-4 py-2 border-b border-[#1e1e2e] text-right">Unrealized</th>
                  <th className="px-4 py-2 border-b border-[#1e1e2e] text-right">P&L %</th>
                </tr>
              </thead>
              <tbody className="text-[10px] font-mono">
                {Object.entries(stats.unrealized_by_symbol).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-600 font-bold uppercase tracking-widest italic">
                      No open positions
                    </td>
                  </tr>
                ) : (
                  Object.entries(stats.unrealized_by_symbol).map(([symbol, pos]) => {
                    const avg = parseFloat(pos.avg_buy_price);
                    const mark = parseFloat(pos.current_price);
                    const pnlPct = avg > 0 ? ((mark / avg) - 1) * 100 : 0;
                    
                    return (
                      <tr key={symbol} className="hover:bg-white/5 transition-colors border-b border-[#1e1e2e]/30 last:border-0">
                        <td className="px-4 py-2.5 text-white font-bold">{symbol}</td>
                        <td className="px-4 py-2.5 text-slate-300">{parseFloat(pos.quantity).toFixed(4)}</td>
                        <td className="px-4 py-2.5 text-slate-400">{formatValue(pos.avg_buy_price)}</td>
                        <td className="px-4 py-2.5 text-blue-400">{formatValue(pos.current_price)}</td>
                        <td className={`px-4 py-2.5 text-right font-bold ${getPnlColor(pos.pnl)}`}>
                          {formatValue(pos.pnl)}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-black ${getPnlColor(pnlPct)}`}>
                          {pnlPct > 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
