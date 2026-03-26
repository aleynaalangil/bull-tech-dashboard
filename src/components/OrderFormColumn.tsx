import { useTradeStore } from '../store';
import { useOrderForm, type AccountData } from '../hooks/useOrderForm';

interface OrderFormColumnProps {
    side: 'buy' | 'sell';
    symbol: string;
    orderType: 'market' | 'limit' | 'stop-limit';
    limitPrice: string;
    onLimitPriceChange: (v: string) => void;
    stopPrice: string;
    onStopPriceChange: (v: string) => void;
    loading: boolean;
    onExecute: (side: 'buy' | 'sell', qty: string, validate: () => string | null) => void;
    account: AccountData | null;
    baseAsset: string;
    quoteAsset: string;
}

export function OrderFormColumn({
    side,
    symbol,
    orderType,
    limitPrice,
    onLimitPriceChange,
    stopPrice,
    onStopPriceChange,
    loading,
    onExecute,
    account,
    baseAsset,
    quoteAsset,
}: OrderFormColumnProps) {
    const { qty, setQty, validate, setQuickAmount } = useOrderForm(side, symbol);
    const prices = useTradeStore((state) => state.prices);

    const isBuy = side === 'buy';
    const focusClass = isBuy ? 'buy-focus' : 'sell-focus';
    const btnClass = isBuy
        ? 'bg-green-500 hover:bg-green-600 text-black shadow-green-500/10'
        : 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/10';

    const availableLabel = isBuy
        ? `${account ? Number(account.balance_usdc).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} ${quoteAsset}`
        : `${account?.positions.find(p => p.symbol === symbol) ? Number(account.positions.find(p => p.symbol === symbol)!.quantity).toFixed(6) : '0.000000'} ${baseAsset}`;

    return (
        <div className="flex-1 flex flex-col gap-4">
            <div className="flex justify-between items-end mb-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Available</span>
                <span className="text-xs text-white font-mono font-bold">{availableLabel}</span>
            </div>

            {orderType === 'market' ? (
                <div className="trade-input-group opacity-60">
                    <span className="trade-input-label">Price</span>
                    <input
                        readOnly
                        disabled
                        value={prices[symbol] ? prices[symbol].price.times(qty || 0).toFormat(2) : '0.00'}
                        className="trade-input cursor-not-allowed bg-transparent tabular-nums text-right pr-4"
                    />
                    <span className="trade-input-suffix">{quoteAsset}</span>
                </div>
            ) : (
                <>
                    {orderType === 'stop-limit' && (
                        <div className="trade-input-group">
                            <span className="trade-input-label">Stop</span>
                            <input
                                type="number"
                                value={stopPrice}
                                onChange={(e) => onStopPriceChange(e.target.value)}
                                className={`trade-input ${focusClass} tabular-nums`}
                                placeholder="0.00"
                            />
                            <span className="trade-input-suffix">{quoteAsset}</span>
                        </div>
                    )}
                    <div className="trade-input-group">
                        <span className="trade-input-label">Limit</span>
                        <input
                            type="number"
                            value={limitPrice}
                            onChange={(e) => onLimitPriceChange(e.target.value)}
                            className={`trade-input ${focusClass} tabular-nums`}
                            placeholder="0.00"
                        />
                        <span className="trade-input-suffix">{quoteAsset}</span>
                    </div>
                </>
            )}

            <div className="trade-input-group">
                <span className="trade-input-label">Amount</span>
                <input
                    type="number"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className={`trade-input ${focusClass} tabular-nums`}
                    placeholder="0.00"
                />
                <span className="trade-input-suffix">{baseAsset}</span>
            </div>

            <div className="flex gap-1.5">
                {[0.25, 0.5, 0.75, 1].map((p) => (
                    <button key={p} onClick={() => setQuickAmount(p, account)} className="quick-amount-btn">
                        {p * 100}%
                    </button>
                ))}
            </div>

            <button
                disabled={loading}
                onClick={() => onExecute(side, qty, validate)}
                className={`w-full h-11 ${btnClass} rounded-lg text-xs font-black uppercase tracking-widest transition-all transform active:scale-[0.98] shadow-lg disabled:opacity-50 mt-2`}
            >
                {loading ? 'Processing…' : `${isBuy ? 'Buy' : 'Sell'} ${baseAsset}`}
            </button>
        </div>
    );
}
