import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { authFetch, clearAuth } from '../auth';
import { useNavigate } from 'react-router-dom';
import { useTradeStore } from '../store';
import BigNumber from 'bignumber.js';
import { PnlPanel } from './PnlPanel';

const MAX_ORDER_QTY = 1_000_000;

interface Position {
  symbol: string;
  quantity: string;
  avg_buy_price: string;
}

interface AccountData {
  balance_usdc: string;
  positions: Position[];
}

export const TradeInterface = ({ symbol }: { symbol: string }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'spot' | 'alerts' | 'pnl'>('spot');

  // ── Spot trade state ──────────────────────────────────────────────────────
  const [buyQty, setBuyQty] = useState('');
  const [sellQty, setSellQty] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop-limit'>('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');

  // ── Alert form state ──────────────────────────────────────────────────────
  const [alertPrice, setAlertPrice] = useState('');
  const [alertSide, setAlertSide] = useState<'buy' | 'sell'>('buy');
  const [alertQty, setAlertQty] = useState('');
  const [alertErr, setAlertErr] = useState<string | null>(null);

  const prices = useTradeStore((state) => state.prices);
  const priceAlerts = useTradeStore((state) => state.priceAlerts);
  const addPriceAlert = useTradeStore((state) => state.addPriceAlert);
  const removePriceAlert = useTradeStore((state) => state.removePriceAlert);
  const addPendingOrder = useTradeStore((state) => state.addPendingOrder);
  const pendingOrders = useTradeStore((state) => state.pendingOrders);
  const removePendingOrder = useTradeStore((state) => state.removePendingOrder);

  const parts = symbol.split('/');
  const baseAsset = parts[0] ?? 'BTC';
  const quoteAsset = parts[1] ?? 'USDC';

  // ── Account load ──────────────────────────────────────────────────────────
  const loadAccount = async () => {
    try {
      const res = await authFetch('/api/v1/account');
      if (res.status === 401) { clearAuth(); navigate('/login'); return; }
      if (res.ok) setAccount(await res.json());
    } catch (err) {
      console.error('[TradeInterface] Failed to load account:', err);
    }
  };

  useEffect(() => { loadAccount(); }, [symbol]);

  const usdcBalance = account
    ? Number(account.balance_usdc).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
  const heldPosition = account?.positions.find((p) => p.symbol === symbol);
  const heldQty = heldPosition ? Number(heldPosition.quantity).toFixed(6) : '0.000000';

  // ── Spot trade execution ──────────────────────────────────────────────────
  const validateQty = (qty: string): string | null => {
    const n = Number(qty);
    if (!qty || isNaN(n)) return 'Invalid quantity';
    if (n <= 0) return 'Quantity must be > 0';
    if (n > MAX_ORDER_QTY) return `Max ${MAX_ORDER_QTY.toLocaleString()}`;
    return null;
  };

  const executeTrade = async (side: 'buy' | 'sell') => {
    const qty = side === 'buy' ? buyQty : sellQty;
    const qtyErr = validateQty(qty);
    if (qtyErr) { setResultMsg({ ok: false, text: qtyErr }); return; }

    const currentPrice = prices[symbol]?.price ?? new BigNumber(0);

    if (orderType === 'market') {
      setLoading(true);
      setResultMsg(null);
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
        setResultMsg({ ok: false, text: 'Limit buy price must be BELOW current price' });
        return;
      }
      if (side === 'sell' && !lp.gt(currentPrice)) {
        setResultMsg({ ok: false, text: 'Limit sell price must be ABOVE current price' });
        return;
      }

      addPendingOrder({ type: 'limit', symbol, side, quantity: qty, limitPrice: lp, status: 'waiting' });
      setResultMsg({ ok: true, text: `Limit ${side.toUpperCase()} order placed` });
    } else if (orderType === 'stop-limit') {
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

  // ── Alert creation ────────────────────────────────────────────────────────
  const handleCreateAlert = (e: FormEvent) => {
    e.preventDefault();
    setAlertErr(null);

    const priceN = Number(alertPrice);
    if (!alertPrice || isNaN(priceN) || priceN <= 0) {
      setAlertErr('Enter a valid target price');
      return;
    }
    const qtyErr = validateQty(alertQty);
    if (qtyErr) { setAlertErr(qtyErr); return; }

    const currentPrice = prices[symbol]?.price ?? new BigNumber(0);
    const targetPrice = new BigNumber(alertPrice);

    // Determine direction: if target is above current price → fires when price rises to it
    const condition: 'above' | 'below' = targetPrice.gt(currentPrice) ? 'above' : 'below';

    addPriceAlert({ symbol, targetPrice, condition, side: alertSide, quantity: alertQty });

    setAlertPrice('');
    setAlertQty('');
  };

  // Alerts for the currently viewed symbol
  const symbolAlerts = priceAlerts.filter((a) => a.symbol === symbol);

  const setQuickAmount = (side: 'buy' | 'sell', percent: number) => {
    if (side === 'buy') {
      if (!account) return;
      const total = Number(account.balance_usdc);
      const currentPrice = prices[symbol]?.price.toNumber() ?? 0;
      if (currentPrice > 0) {
        setBuyQty(((total * percent) / currentPrice).toFixed(4));
      }
    } else {
      const heldPosition = account?.positions.find((p) => p.symbol === symbol);
      if (heldPosition) {
        const total = Number(heldPosition.quantity);
        setSellQty((total * percent).toFixed(6));
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d12] text-slate-300">

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center px-4 h-12 border-b border-[#1e1e2e] bg-[#0d0d12]">
        <div
          onClick={() => setActiveTab('spot')}
          className={`text-xs font-bold uppercase tracking-widest px-4 h-full flex items-center cursor-pointer transition-all border-b-2 ${activeTab === 'spot' ? 'text-blue-500 border-blue-500 bg-blue-500/5' : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
        >
          Spot
        </div>
        <div
          onClick={() => setActiveTab('alerts')}
          className={`text-xs font-bold uppercase tracking-widest px-4 h-full flex items-center cursor-pointer transition-all border-b-2 gap-2 ${activeTab === 'alerts' ? 'text-amber-500 border-amber-500 bg-amber-500/5' : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
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
          className={`text-xs font-bold uppercase tracking-widest px-4 h-full flex items-center cursor-pointer transition-all border-b-2 ${activeTab === 'pnl' ? 'text-green-500 border-green-500 bg-green-500/5' : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
        >
          PnL
        </div>
      </div>

      {/* ── Spot tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'spot' && (
        <>
          <div className="flex px-4 h-10 items-center gap-6 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-[#1e1e2e]/50">
            <span onClick={() => setOrderType('limit')}
              className={`cursor-pointer transition-colors ${orderType === 'limit' ? 'text-blue-500 border-b border-blue-500' : 'hover:text-slate-300'}`}>Limit</span>
            <span onClick={() => setOrderType('market')}
              className={`cursor-pointer transition-colors ${orderType === 'market' ? 'text-blue-500 border-b border-blue-500' : 'hover:text-slate-300'}`}>Market</span>
            <span onClick={() => setOrderType('stop-limit')}
              className={`cursor-pointer transition-colors ${orderType === 'stop-limit' ? 'text-blue-500 border-b border-blue-500' : 'hover:text-slate-300'}`}>Stop-limit</span>
          </div>

          <div className="flex-1 flex flex-col md:flex-row p-4 gap-6 relative overflow-y-auto">

            {/* ── Buy column ─────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex justify-between items-end mb-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Available</span>
                <span className="text-xs text-white font-mono font-bold">{usdcBalance} <span className="text-slate-500 text-[10px]">{quoteAsset}</span></span>
              </div>

              {orderType === 'market' ? (
                <div className="trade-input-group opacity-60">
                  <span className="trade-input-label">Price</span>
                  <input readOnly disabled value={prices[symbol] ? (prices[symbol].price.times(buyQty || 0)).toFormat(2) : "0.00"}
                    //add usd as symbol next to the value
                    className="trade-input cursor-not-allowed bg-transparent tabular-nums text-right pr-4" />
                  <span className="trade-input-suffix">{quoteAsset}</span>
                </div>
              ) : (
                <>
                  {orderType === 'stop-limit' && (
                    <div className="trade-input-group">
                      <span className="trade-input-label">Stop</span>
                      <input type="number" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)}
                        className="trade-input buy-focus tabular-nums" placeholder="0.00" />
                      <span className="trade-input-suffix">{quoteAsset}</span>
                    </div>
                  )}
                  <div className="trade-input-group">
                    <span className="trade-input-label">Limit</span>
                    <input type="number" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)}
                      className="trade-input buy-focus tabular-nums" placeholder="0.00" />
                    <span className="trade-input-suffix">{quoteAsset}</span>
                  </div>
                </>
              )}

              <div className="trade-input-group">
                <span className="trade-input-label">Amount</span>
                <input type="number" value={buyQty} onChange={(e) => setBuyQty(e.target.value)}
                  className="trade-input buy-focus tabular-nums" placeholder="0.00" />
                <span className="trade-input-suffix">{baseAsset}</span>
              </div>

              <div className="flex gap-1.5">
                {[0.25, 0.5, 0.75, 1].map((p) => (
                  <button key={p} onClick={() => setQuickAmount('buy', p)} className="quick-amount-btn">
                    {p * 100}%
                  </button>
                ))}
              </div>

              <button disabled={loading} onClick={() => executeTrade('buy')}
                className="w-full h-11 bg-green-500 hover:bg-green-600 text-black rounded-lg text-xs font-black uppercase tracking-widest transition-all transform active:scale-[0.98] shadow-lg shadow-green-500/10 disabled:opacity-50 mt-2">
                {loading ? 'Processing…' : `Buy ${baseAsset}`}
              </button>
            </div>

            {/* ── Sell column ────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex justify-between items-end mb-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Available</span>
                <span className="text-xs text-white font-mono font-bold">{heldQty} <span className="text-slate-500 text-[10px]">{baseAsset}</span></span>
              </div>

              {orderType === 'market' ? (
                <div className="trade-input-group opacity-60">
                  <span className="trade-input-label">Price</span>
                  <input readOnly disabled value={prices[symbol] ? (prices[symbol].price.times(sellQty || 0)).toFormat(2) : "0.00"}
                    className="trade-input cursor-not-allowed bg-transparent tabular-nums text-right pr-4" />
                  <span className="trade-input-suffix">{quoteAsset}</span>
                </div>
              ) : (
                <>
                  {orderType === 'stop-limit' && (
                    <div className="trade-input-group">
                      <span className="trade-input-label">Stop</span>
                      <input type="number" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)}
                        className="trade-input sell-focus tabular-nums" placeholder="0.00" />
                      <span className="trade-input-suffix">{quoteAsset}</span>
                    </div>
                  )}
                  <div className="trade-input-group">
                    <span className="trade-input-label">Limit</span>
                    <input type="number" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)}
                      className="trade-input sell-focus tabular-nums" placeholder="0.00" />
                    <span className="trade-input-suffix">{quoteAsset}</span>
                  </div>
                </>
              )}

              <div className="trade-input-group">
                <span className="trade-input-label">Amount</span>
                <input type="number" value={sellQty} onChange={(e) => setSellQty(e.target.value)}
                  className="trade-input sell-focus tabular-nums" placeholder="0.00" />
                <span className="trade-input-suffix">{baseAsset}</span>
              </div>

              <div className="flex gap-1.5">
                {[0.25, 0.5, 0.75, 1].map((p) => (
                  <button key={p} onClick={() => setQuickAmount('sell', p)} className="quick-amount-btn">
                    {p * 100}%
                  </button>
                ))}
              </div>

              <button disabled={loading} onClick={() => executeTrade('sell')}
                className="w-full h-11 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-black uppercase tracking-widest transition-all transform active:scale-[0.98] shadow-lg shadow-red-500/10 disabled:opacity-50 mt-2">
                {loading ? 'Processing…' : `Sell ${baseAsset}`}
              </button>
            </div>

            {/* ── Result overlay ──────────────────────────────────────────── */}
            {resultMsg && (
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] p-5 rounded-xl border text-sm shadow-2xl backdrop-blur-xl z-20 animate-in fade-in zoom-in duration-200 ${resultMsg.ok
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                <div className="flex items-center gap-2 font-black uppercase tracking-widest border-b border-current/10 pb-3 mb-3">
                  <div className={`w-2 h-2 rounded-full ${resultMsg.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                  {resultMsg.ok ? 'Order Confirmed' : 'Execution Failed'}
                </div>
                <p className="font-mono text-xs opacity-90 leading-relaxed">{resultMsg.text}</p>
                <button className="mt-5 w-full bg-white/5 hover:bg-white/10 border border-white/10 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
                  onClick={() => setResultMsg(null)}>
                  Close
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Alerts tab ───────────────────────────────────────────────────── */}
      {activeTab === 'alerts' && (
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
                  <button type="button" onClick={() => setAlertSide('buy')}
                    className={`text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-widest transition-all ${alertSide === 'buy' ? 'bg-green-500 text-black' : 'bg-white/5 text-slate-500'}`}>
                    Condition: Above
                  </button>
                  <button type="button" onClick={() => setAlertSide('sell')}
                    className={`text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-widest transition-all ${alertSide === 'sell' ? 'bg-red-500 text-white' : 'bg-white/5 text-slate-500'}`}>
                    Condition: Below
                  </button>
                </div>
              </div>

              <div className="trade-input-group">
                <span className="trade-input-label">Target</span>
                <input type="number" value={alertPrice} onChange={(e) => setAlertPrice(e.target.value)}
                  className="trade-input buy-focus tabular-nums" placeholder="0.00" />
                <span className="trade-input-suffix">{quoteAsset}</span>
              </div>

              <div className="trade-input-group">
                <span className="trade-input-label">Amount</span>
                <input type="number" value={alertQty} onChange={(e) => setAlertQty(e.target.value)}
                  className="trade-input buy-focus tabular-nums" placeholder="0.00" />
                <span className="trade-input-suffix">{baseAsset}</span>
              </div>

              {alertErr && (
                <div className="text-red-400 text-[10px] font-bold uppercase tracking-widest bg-red-500/10 border border-red-500/20 rounded p-2">
                  {alertErr}
                </div>
              )}

              <button onClick={handleCreateAlert}
                className="w-full h-9 bg-amber-500 hover:bg-amber-600 text-black rounded-lg text-xs font-black uppercase tracking-widest transition-all transform active:scale-[0.98] shadow-lg shadow-amber-500/10 mt-2">
                Create Alert
              </button>
            </div>

            {/* Active alerts & Pending orders list */}
            <div className="flex-1 flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight mb-1">Active Notifications</span>
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
                        <button onClick={() => removePriceAlert(alert.id)} className="text-slate-600 hover:text-red-500 transition-colors p-1">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight mb-1">Pending Orders</span>
                {pendingOrders.filter(o => o.symbol === symbol).length === 0 ? (
                  <div className="h-20 flex items-center justify-center border border-dashed border-[#1e1e2e] rounded-lg">
                    <p className="text-slate-600 text-[10px] font-bold uppercase tracking-widest">No pending orders</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 max-h-[200px] overflow-y-auto no-scrollbar">
                    {pendingOrders.filter(o => o.symbol === symbol).map((order) => (
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
                        <button onClick={() => removePendingOrder(order.id)} className="text-slate-600 hover:text-red-500 transition-colors p-1">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PnL tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'pnl' && <PnlPanel />}
    </div>
  );
};
