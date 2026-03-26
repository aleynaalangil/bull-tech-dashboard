import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTradeStore } from '../store';
import BigNumber from 'bignumber.js';
import { MAX_ORDER_QTY } from '../hooks/useOrderForm';

interface AlertsTabProps {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
}

export function AlertsTab({ symbol, baseAsset, quoteAsset }: AlertsTabProps) {
    const [alertPrice, setAlertPrice] = useState('');
    const [alertSide, setAlertSide] = useState<'buy' | 'sell'>('buy');
    const [alertQty, setAlertQty] = useState('');
    const [alertErr, setAlertErr] = useState<string | null>(null);

    const prices = useTradeStore((state) => state.prices);
    const priceAlerts = useTradeStore((state) => state.priceAlerts);
    const addPriceAlert = useTradeStore((state) => state.addPriceAlert);
    const removePriceAlert = useTradeStore((state) => state.removePriceAlert);
    const clearPriceAlerts = useTradeStore((state) => state.clearPriceAlerts);
    const pendingOrders = useTradeStore((state) => state.pendingOrders);
    const removePendingOrder = useTradeStore((state) => state.removePendingOrder);
    const clearPendingOrders = useTradeStore((state) => state.clearPendingOrders);

    const symbolAlerts = priceAlerts.filter((a) => a.symbol === symbol);
    const symbolOrders = pendingOrders.filter((o) => o.symbol === symbol);

    const handleCreateAlert = (e: FormEvent) => {
        e.preventDefault();
        setAlertErr(null);

        const priceN = Number(alertPrice);
        if (!alertPrice || isNaN(priceN) || priceN <= 0) {
            setAlertErr('Enter a valid target price');
            return;
        }
        const n = Number(alertQty);
        if (!alertQty || isNaN(n) || n <= 0) { setAlertErr('Invalid quantity'); return; }
        if (n > MAX_ORDER_QTY) { setAlertErr(`Max ${MAX_ORDER_QTY.toLocaleString()}`); return; }

        const currentPrice = prices[symbol]?.price ?? new BigNumber(0);
        const targetPrice = new BigNumber(alertPrice);
        const condition: 'above' | 'below' = targetPrice.gt(currentPrice) ? 'above' : 'below';

        addPriceAlert({ symbol, targetPrice, condition, side: alertSide, quantity: alertQty });
        setAlertPrice('');
        setAlertQty('');
    };

    return (
        <div className="flex-1 flex flex-col p-4 gap-6 relative overflow-y-auto">
            <div className="flex px-0 h-10 items-center gap-6 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-[#1e1e2e]/50 mb-4">
                <span className="text-amber-500 border-b border-amber-500 pb-0.5 cursor-pointer">Price Alert</span>
            </div>

            <div className="flex flex-col md:flex-row gap-6">
                {/* Create alert form */}
                <div className="flex-1 flex flex-col gap-4">
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Condition</span>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setAlertSide('buy')}
                                className={`text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-widest transition-all ${alertSide === 'buy' ? 'bg-green-500 text-black' : 'bg-white/5 text-slate-500'}`}
                            >
                                Condition: Above
                            </button>
                            <button
                                type="button"
                                onClick={() => setAlertSide('sell')}
                                className={`text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-widest transition-all ${alertSide === 'sell' ? 'bg-red-500 text-white' : 'bg-white/5 text-slate-500'}`}
                            >
                                Condition: Below
                            </button>
                        </div>
                    </div>

                    <div className="trade-input-group">
                        <span className="trade-input-label">Target</span>
                        <input
                            type="number"
                            value={alertPrice}
                            onChange={(e) => setAlertPrice(e.target.value)}
                            className="trade-input buy-focus tabular-nums"
                            placeholder="0.00"
                        />
                        <span className="trade-input-suffix">{quoteAsset}</span>
                    </div>

                    <div className="trade-input-group">
                        <span className="trade-input-label">Amount</span>
                        <input
                            type="number"
                            value={alertQty}
                            onChange={(e) => setAlertQty(e.target.value)}
                            className="trade-input buy-focus tabular-nums"
                            placeholder="0.00"
                        />
                        <span className="trade-input-suffix">{baseAsset}</span>
                    </div>

                    {alertErr && (
                        <div className="text-red-400 text-[10px] font-bold uppercase tracking-widest bg-red-500/10 border border-red-500/20 rounded p-2">
                            {alertErr}
                        </div>
                    )}

                    <button
                        onClick={handleCreateAlert}
                        className="w-full h-9 bg-amber-500 hover:bg-amber-600 text-black rounded-lg text-xs font-black uppercase tracking-widest transition-all transform active:scale-[0.98] shadow-lg shadow-amber-500/10 mt-2"
                    >
                        Create Alert
                    </button>
                </div>

                {/* Active alerts & Pending orders list */}
                <div className="flex-1 flex flex-col gap-6">
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Active Notifications</span>
                            {symbolAlerts.length > 1 && (
                                <button
                                    onClick={() => clearPriceAlerts(symbol)}
                                    className="text-[9px] font-bold uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors px-2 py-0.5 rounded border border-red-500/20 hover:border-red-500/40 bg-red-500/5"
                                >
                                    Cancel All
                                </button>
                            )}
                        </div>
                        {symbolAlerts.length === 0 ? (
                            <div className="h-20 flex items-center justify-center border border-dashed border-[#1e1e2e] rounded-lg">
                                <p className="text-slate-600 text-[10px] font-bold uppercase tracking-widest">No active alerts</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto no-scrollbar">
                                {symbolAlerts.map((alert) => (
                                    <div key={alert.id} className="flex items-center justify-between bg-white/5 border border-white/5 rounded-lg p-3 group hover:border-white/10 transition-all">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[9px] font-black uppercase tracking-tighter ${alert.condition === 'above' ? 'text-green-400' : 'text-red-400'}`}>
                                                    {alert.condition.toUpperCase()} {new BigNumber(alert.targetPrice).toFixed(2)}
                                                </span>
                                                <span className="w-1 h-1 rounded-full bg-slate-700" />
                                                <span className="text-[9px] text-slate-400 font-bold uppercase">{alert.side}</span>
                                            </div>
                                            <span className="text-[10px] text-white font-mono">{alert.quantity} {baseAsset}</span>
                                        </div>
                                        <button onClick={() => removePriceAlert(alert.id)} className="text-slate-600 hover:text-red-500 transition-colors p-1">✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Pending Orders</span>
                            {symbolOrders.length > 1 && (
                                <button
                                    onClick={() => clearPendingOrders(symbol)}
                                    className="text-[9px] font-bold uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors px-2 py-0.5 rounded border border-red-500/20 hover:border-red-500/40 bg-red-500/5"
                                >
                                    Cancel All
                                </button>
                            )}
                        </div>
                        {symbolOrders.length === 0 ? (
                            <div className="h-20 flex items-center justify-center border border-dashed border-[#1e1e2e] rounded-lg">
                                <p className="text-slate-600 text-[10px] font-bold uppercase tracking-widest">No pending orders</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2 max-h-[200px] overflow-y-auto no-scrollbar">
                                {symbolOrders.map((order) => (
                                    <div key={order.id} className="flex items-center justify-between bg-white/5 border border-white/5 rounded-lg p-3 group hover:border-white/10 transition-all">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[9px] font-black bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20">
                                                    {order.type.toUpperCase()}
                                                </span>
                                                <span className={`text-[9px] font-black uppercase ${order.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                                                    {order.side}
                                                </span>
                                                <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${order.status === 'triggered' ? 'bg-green-500 text-black' : 'bg-white/10 text-slate-400'}`}>
                                                    {order.status}
                                                </span>
                                            </div>
                                            <div className="flex flex-col text-[10px] font-mono text-white gap-0.5">
                                                <span>{order.quantity} {baseAsset}</span>
                                                <div className="flex gap-2 text-slate-500">
                                                    {order.stopPrice && <span>Stop: {new BigNumber(order.stopPrice).toFixed(2)}</span>}
                                                    <span>Limit: {new BigNumber(order.limitPrice).toFixed(2)}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <button onClick={() => removePendingOrder(order.id)} className="text-slate-600 hover:text-red-500 transition-colors p-1">✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
