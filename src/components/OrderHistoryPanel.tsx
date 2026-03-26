import { useState, useEffect } from 'react';
import { authFetch, clearAuth } from '../auth';
import { useNavigate } from 'react-router-dom';

// ── API contract ──────────────────────────────────────────────────────────────
// Backend endpoint: GET /api/v1/orders?limit=100
// Response: OrderRecord[]
// The exchange-sim must return individual filled/rejected orders for the
// authenticated user, ordered by created_at DESC.

interface OrderRecord {
    id: string;
    symbol: string;
    side: 'buy' | 'sell';
    order_type: 'market' | 'limit' | 'stop_limit';
    amount: string;      // quantity field name in exchange-sim
    price: string;       // fill price; "0" until filled for limit/pending orders
    status: 'filled' | 'rejected' | 'pending' | 'canceled';
    created_at: string;  // ISO 8601 timestamp
}

type SideFilter = 'all' | 'buy' | 'sell';

const formatPrice = (val: string) => {
    const n = parseFloat(val);
    if (isNaN(n) || n === 0) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};

const formatQty = (val: string) => {
    const n = parseFloat(val);
    if (isNaN(n)) return '—';
    return n.toFixed(6).replace(/\.?0+$/, '');
};

const formatTime = (iso: string) => {
    try {
        return new Date(iso).toLocaleString(undefined, {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        });
    } catch {
        return iso;
    }
};

export function OrderHistoryPanel() {
    const navigate = useNavigate();
    const [orders, setOrders] = useState<OrderRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sideFilter, setSideFilter] = useState<SideFilter>('all');

    const fetchOrders = async () => {
        try {
            const res = await authFetch('/api/v1/orders?limit=100');
            if (res.status === 401) { clearAuth(); navigate('/login'); return; }
            if (res.ok) {
                const data: unknown = await res.json();
                setOrders(Array.isArray(data) ? (data as OrderRecord[]) : []);
                setError(null);
            } else {
                setError('Could not load order history');
            }
        } catch {
            setError('Could not load order history');
        } finally {
            setLoading(false);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchOrders(); }, []);

    const visible = sideFilter === 'all'
        ? orders
        : orders.filter((o) => o.side === sideFilter);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Loading orders…</span>
                </div>
            </div>
        );
    }

    if (error && orders.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">{error}</span>
                    <button
                        onClick={fetchOrders}
                        className="text-[10px] font-bold text-slate-400 hover:text-slate-200 border border-[#1e1e2e] rounded px-3 py-1.5 transition-colors uppercase tracking-widest"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#0d0d12] text-slate-300 overflow-hidden">
            {/* ── Toolbar ──────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e] bg-[#12121a] shrink-0">
                <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        Order History
                    </span>
                    <button
                        onClick={fetchOrders}
                        title="Refresh"
                        className="text-slate-600 hover:text-slate-300 transition-colors text-[11px] leading-none"
                    >
                        ↻
                    </button>
                    {error && (
                        <span className="text-[9px] font-bold text-red-400 uppercase tracking-widest">
                            Stale data
                        </span>
                    )}
                </div>
                <div className="flex gap-1 bg-white/5 p-1 rounded-md">
                    {(['all', 'buy', 'sell'] as SideFilter[]).map((f) => (
                        <button
                            key={f}
                            onClick={() => setSideFilter(f)}
                            className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter transition-all ${
                                sideFilter === f
                                    ? f === 'buy'  ? 'bg-green-500 text-black'
                                    : f === 'sell' ? 'bg-red-500 text-white'
                                    : 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                                    : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Table ────────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto no-scrollbar">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10">
                        <tr className="bg-[#0d0d12] text-[9px] font-black uppercase tracking-widest text-slate-500 border-b border-[#1e1e2e]">
                            <th className="px-4 py-2">Time</th>
                            <th className="px-4 py-2">Symbol</th>
                            <th className="px-4 py-2">Side</th>
                            <th className="px-4 py-2">Type</th>
                            <th className="px-4 py-2 text-right">Qty</th>
                            <th className="px-4 py-2 text-right">Fill Price</th>
                            <th className="px-4 py-2 text-right">Status</th>
                        </tr>
                    </thead>
                    <tbody className="text-[10px] font-mono divide-y divide-[#1e1e2e]/30">
                        {visible.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-4 py-12 text-center text-slate-600 font-bold uppercase tracking-widest italic">
                                    {orders.length === 0 ? 'No orders yet' : 'No orders match filter'}
                                </td>
                            </tr>
                        ) : (
                            visible.map((o) => (
                                <tr key={o.id} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{formatTime(o.created_at)}</td>
                                    <td className="px-4 py-2.5 text-white font-bold">{o.symbol}</td>
                                    <td className="px-4 py-2.5">
                                        <span className={`font-black uppercase text-[9px] px-1.5 py-0.5 rounded ${
                                            o.side === 'buy'
                                                ? 'bg-green-500/15 text-green-400'
                                                : 'bg-red-500/15 text-red-400'
                                        }`}>
                                            {o.side}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <span className={`font-black uppercase text-[8px] px-1.5 py-0.5 rounded ${
                                            o.order_type === 'market'
                                                ? 'bg-slate-800 text-slate-400'
                                                : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                        }`}>
                                            {o.order_type.replace('_', '-')}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-slate-300">{formatQty(o.amount)}</td>
                                    <td className="px-4 py-2.5 text-right text-slate-200">{formatPrice(o.price)}</td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className={`font-black uppercase text-[8px] px-1.5 py-0.5 rounded ${
                                            o.status === 'filled'    ? 'bg-green-500/15 text-green-400' :
                                            o.status === 'rejected'  ? 'bg-red-500/15 text-red-400' :
                                            o.status === 'pending'   ? 'bg-amber-500/15 text-amber-400' :
                                            'bg-slate-700 text-slate-400'
                                        }`}>
                                            {o.status}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {visible.length > 0 && (
                <div className="px-4 py-2 border-t border-[#1e1e2e] bg-[#12121a] shrink-0 text-[9px] text-slate-600 font-bold uppercase tracking-widest">
                    {visible.length} order{visible.length !== 1 ? 's' : ''}
                    {sideFilter !== 'all' ? ` · ${sideFilter} only` : ''}
                </div>
            )}
        </div>
    );
}
