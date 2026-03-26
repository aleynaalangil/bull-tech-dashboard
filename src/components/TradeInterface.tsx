import { useState, useEffect } from 'react';
import { authFetch, clearAuth } from '../auth';
import { useNavigate } from 'react-router-dom';
import { useTradeStore } from '../store';
import BigNumber from 'bignumber.js';
import { PnlPanel } from './PnlPanel';
import { OrderFormColumn } from './OrderFormColumn';
import { AlertsTab } from './AlertsTab';
import { OrderHistoryPanel } from './OrderHistoryPanel';
import type { AccountData } from '../hooks/useOrderForm';

export const TradeInterface = ({ symbol }: { symbol: string }) => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'spot' | 'alerts' | 'pnl' | 'orders'>('spot');

    // ── Shared order-form state (both columns read/write these) ───────────────
    const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop-limit'>('market');
    const [limitPrice, setLimitPrice] = useState('');
    const [stopPrice, setStopPrice] = useState('');

    // ── Execution state ───────────────────────────────────────────────────────
    const [loading, setLoading] = useState(false);
    const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string; pending?: boolean } | null>(null);

    // ── Account state ─────────────────────────────────────────────────────────
    const [account, setAccount] = useState<AccountData | null>(null);
    const [accountError, setAccountError] = useState<string | null>(null);

    const prices = useTradeStore((state) => state.prices);
    const addPendingOrder = useTradeStore((state) => state.addPendingOrder);

    const parts = symbol.split('/');
    const baseAsset = parts[0] ?? 'BTC';
    const quoteAsset = parts[1] ?? 'USDC';
    const priceAlerts = useTradeStore((state) => state.priceAlerts);
    const symbolAlerts = priceAlerts.filter((a) => a.symbol === symbol);

    // ── Account load ──────────────────────────────────────────────────────────
    const loadAccount = async () => {
        try {
            const res = await authFetch('/api/v1/account');
            if (res.status === 401) { clearAuth(); navigate('/login'); return; }
            if (res.ok) {
                setAccount(await res.json());
                setAccountError(null);
            } else {
                setAccountError('Could not load account — balances may be stale');
            }
        } catch {
            setAccountError('Could not load account — balances may be stale');
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadAccount(); }, [symbol]);

    // ── Trade execution ───────────────────────────────────────────────────────
    const handleExecute = async (side: 'buy' | 'sell', qty: string, validate: () => string | null) => {
        const qtyErr = validate();
        if (qtyErr) { setResultMsg({ ok: false, text: qtyErr }); return; }

        const currentPrice = prices[symbol]?.price ?? new BigNumber(0);

        if (orderType === 'market') {
            setLoading(true);
            // Show optimistic feedback immediately — user knows the order is on its way.
            setResultMsg({ ok: true, text: `Submitting ${side.toUpperCase()} ${qty} ${baseAsset}…`, pending: true });
            try {
                const res = await authFetch('/api/v1/orders', {
                    method: 'POST',
                    body: JSON.stringify({ symbol, side, amount: qty }),
                });
                if (res.status === 401) { clearAuth(); navigate('/login'); return; }
                const data = await res.json();
                if (data.status === 'filled') {
                    setResultMsg({
                        ok: true,
                        text: `${side.toUpperCase()} ${qty} ${baseAsset} @ ${Number(data.price).toFixed(4)} USDC`,
                    });
                    loadAccount();
                } else {
                    setResultMsg({ ok: false, text: data.reject_reason ?? 'Order rejected' });
                }
            } catch (e) {
                setResultMsg({ ok: false, text: e instanceof Error ? e.message : 'Network error' });
            } finally {
                setLoading(false);
            }
        } else if (orderType === 'limit') {
            const lp = new BigNumber(limitPrice);
            if (lp.isNaN() || lp.lte(0)) { setResultMsg({ ok: false, text: 'Invalid limit price' }); return; }
            if (side === 'buy' && !lp.lt(currentPrice)) {
                setResultMsg({ ok: false, text: 'Limit buy price must be BELOW current price' }); return;
            }
            if (side === 'sell' && !lp.gt(currentPrice)) {
                setResultMsg({ ok: false, text: 'Limit sell price must be ABOVE current price' }); return;
            }
            addPendingOrder({ type: 'limit', symbol, side, quantity: qty, limitPrice: lp, status: 'waiting' });
            setResultMsg({ ok: true, text: `Limit ${side.toUpperCase()} order placed` });
        } else {
            const sp = new BigNumber(stopPrice);
            const lp = new BigNumber(limitPrice);
            if (sp.isNaN() || sp.lte(0)) { setResultMsg({ ok: false, text: 'Invalid stop price' }); return; }
            if (lp.isNaN() || lp.lte(0)) { setResultMsg({ ok: false, text: 'Invalid limit price' }); return; }
            if (side === 'buy') {
                if (!sp.gt(currentPrice)) { setResultMsg({ ok: false, text: 'Stop price must be ABOVE current price for buy' }); return; }
                if (!lp.gte(sp)) { setResultMsg({ ok: false, text: 'Limit price must be >= stop price' }); return; }
            } else {
                if (!sp.lt(currentPrice)) { setResultMsg({ ok: false, text: 'Stop price must be BELOW current price for sell' }); return; }
                if (!lp.lte(sp)) { setResultMsg({ ok: false, text: 'Limit price must be <= stop price' }); return; }
            }
            addPendingOrder({ type: 'stop-limit', symbol, side, quantity: qty, limitPrice: lp, stopPrice: sp, status: 'waiting' });
            setResultMsg({ ok: true, text: `Stop-Limit ${side.toUpperCase()} order placed` });
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#0d0d12] text-slate-300">

            {/* ── Tab bar ──────────────────────────────────────────────────────── */}
            <div className="flex items-center px-4 h-12 border-b border-[#1e1e2e] bg-[#0d0d12]">
                <div
                    onClick={() => setActiveTab('spot')}
                    className={`text-xs font-bold uppercase tracking-widest px-4 h-full flex items-center cursor-pointer transition-all border-b-2 ${activeTab === 'spot' ? 'text-blue-500 border-blue-500 bg-blue-500/5' : 'text-slate-500 border-transparent hover:text-slate-300'}`}
                >
                    Spot
                </div>
                <div
                    onClick={() => setActiveTab('alerts')}
                    className={`text-xs font-bold uppercase tracking-widest px-4 h-full flex items-center cursor-pointer transition-all border-b-2 gap-2 ${activeTab === 'alerts' ? 'text-amber-500 border-amber-500 bg-amber-500/5' : 'text-slate-500 border-transparent hover:text-slate-300'}`}
                >
                    Alerts
                    {symbolAlerts.length > 0 && (
                        <span className="text-[9px] bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded px-1.5 py-0.5 font-black">
                            {symbolAlerts.length}
                        </span>
                    )}
                </div>
                <div
                    onClick={() => setActiveTab('pnl')}
                    className={`text-xs font-bold uppercase tracking-widest px-4 h-full flex items-center cursor-pointer transition-all border-b-2 ${activeTab === 'pnl' ? 'text-green-500 border-green-500 bg-green-500/5' : 'text-slate-500 border-transparent hover:text-slate-300'}`}
                >
                    PnL
                </div>
                <div
                    onClick={() => setActiveTab('orders')}
                    className={`text-xs font-bold uppercase tracking-widest px-4 h-full flex items-center cursor-pointer transition-all border-b-2 ${activeTab === 'orders' ? 'text-purple-500 border-purple-500 bg-purple-500/5' : 'text-slate-500 border-transparent hover:text-slate-300'}`}
                >
                    Orders
                </div>
            </div>

            {/* ── Spot tab ─────────────────────────────────────────────────────── */}
            {activeTab === 'spot' && (
                <>
                    <div className="flex px-4 h-10 items-center gap-6 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-[#1e1e2e]/50">
                        {(['limit', 'market', 'stop-limit'] as const).map((type) => (
                            <span
                                key={type}
                                onClick={() => setOrderType(type)}
                                className={`cursor-pointer transition-colors ${orderType === type ? 'text-blue-500 border-b border-blue-500' : 'hover:text-slate-300'}`}
                            >
                                {type.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                            </span>
                        ))}
                    </div>

                    {/* Account error banner */}
                    {accountError && (
                        <div className="flex items-center justify-between px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-[10px] font-bold">
                            <span>{accountError}</span>
                            <button
                                onClick={loadAccount}
                                className="ml-4 underline underline-offset-2 hover:text-amber-300 transition-colors"
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    <div className="flex-1 flex flex-col md:flex-row p-4 gap-6 relative overflow-y-auto">
                        <OrderFormColumn
                            side="buy"
                            symbol={symbol}
                            orderType={orderType}
                            limitPrice={limitPrice}
                            onLimitPriceChange={setLimitPrice}
                            stopPrice={stopPrice}
                            onStopPriceChange={setStopPrice}
                            loading={loading}
                            onExecute={handleExecute}
                            account={account}
                            baseAsset={baseAsset}
                            quoteAsset={quoteAsset}
                        />
                        <OrderFormColumn
                            side="sell"
                            symbol={symbol}
                            orderType={orderType}
                            limitPrice={limitPrice}
                            onLimitPriceChange={setLimitPrice}
                            stopPrice={stopPrice}
                            onStopPriceChange={setStopPrice}
                            loading={loading}
                            onExecute={handleExecute}
                            account={account}
                            baseAsset={baseAsset}
                            quoteAsset={quoteAsset}
                        />

                        {/* ── Result overlay ──────────────────────────────────────── */}
                        {resultMsg && (
                            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] p-5 rounded-xl border text-sm shadow-2xl backdrop-blur-xl z-20 animate-in fade-in zoom-in duration-200 ${resultMsg.pending ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : resultMsg.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                                <div className="flex items-center gap-2 font-black uppercase tracking-widest border-b border-current/10 pb-3 mb-3">
                                    {resultMsg.pending ? (
                                        <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                                    ) : (
                                        <div className={`w-2 h-2 rounded-full ${resultMsg.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                                    )}
                                    {resultMsg.pending ? 'Submitting…' : resultMsg.ok ? 'Order Confirmed' : 'Execution Failed'}
                                </div>
                                <p className="font-mono text-xs opacity-90 leading-relaxed">{resultMsg.text}</p>
                                {!resultMsg.pending && (
                                    <button
                                        className="mt-5 w-full bg-white/5 hover:bg-white/10 border border-white/10 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
                                        onClick={() => setResultMsg(null)}
                                    >
                                        Close
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ── Alerts tab ───────────────────────────────────────────────────── */}
            {activeTab === 'alerts' && (
                <AlertsTab symbol={symbol} baseAsset={baseAsset} quoteAsset={quoteAsset} />
            )}

            {/* ── PnL tab ──────────────────────────────────────────────────────── */}
            {activeTab === 'pnl' && <PnlPanel />}

            {/* ── Orders tab ───────────────────────────────────────────────────── */}
            {activeTab === 'orders' && <OrderHistoryPanel />}
        </div>
    );
};
