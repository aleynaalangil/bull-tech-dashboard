import {useState} from 'react';

// Set VITE_API_URL in your .env files so this never needs to change per environment:
//   .env.development  →  VITE_API_URL=http://localhost:8080
//   .env.production   →  VITE_API_URL=https://hft-gateway-us-east-1.example.com
const rawApiUrl: string | undefined = import.meta.env.VITE_API_URL;
if (!rawApiUrl) {
    throw new Error('[TradeInterface] VITE_API_URL is not set. Add it to your .env file.');
}
const API_BASE: string = rawApiUrl;

const MAX_ORDER_QTY = 1_000_000;

interface TradeResult {
    success: boolean;
    message?: string;
    details?: unknown;
    status_code?: number;
    error_code?: string;
}

export const TradeInterface = ({symbol}: { symbol: string }) => {
    const [buyQty, setBuyQty] = useState('100');
    const [sellQty, setSellQty] = useState('100');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<TradeResult | null>(null);

    const parts = symbol.split('/');
    const baseAsset = parts[0] ?? 'BTC';
    const quoteAsset = parts[1] ?? 'USDT';

    const validateQty = (qty: string): string | null => {
        const n = Number(qty);
        if (!qty || isNaN(n)) return 'Invalid quantity';
        if (n <= 0) return 'Quantity must be greater than zero';
        if (n > MAX_ORDER_QTY) return `Quantity exceeds maximum (${MAX_ORDER_QTY.toLocaleString()})`;
        return null;
    };

    const executeTrade = async (side: 'buy' | 'sell') => {
        const qty = side === 'buy' ? buyQty : sellQty;
        const validationError = validateQty(qty);
        if (validationError) {
            setResult({success: false, message: validationError});
            return;
        }

        setLoading(true);
        setResult(null);
        try {
            const response = await fetch(`${API_BASE}/api/execute-trade`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({symbol, side, qty: Number(qty)}),
            });
            const data: TradeResult = await response.json();
            setResult(data);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Network error';
            setResult({success: false, message});
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#12121a] text-slate-300">

            {/* ── Tab bar ─────────────────────────────────────────────────────
                TODO: Margin and Futures tabs are not yet implemented.
                They are present for layout/design purposes only.          */}
            <div className="flex items-center px-4 py-2 border-b border-[#1e1e2e]">
                <div className="text-sm font-semibold text-white border-b-2 border-blue-500 pb-1 cursor-pointer mr-6">
                    Spot
                </div>
                <div className="text-sm font-semibold text-slate-500 cursor-not-allowed mr-6 opacity-40"
                     title="Not yet implemented">
                    Margin
                </div>
                <div className="text-sm font-semibold text-slate-500 cursor-not-allowed opacity-40"
                     title="Not yet implemented">
                    Futures
                </div>
            </div>

            {/* ── Order-type selector ─────────────────────────────────────────
                TODO: Limit and Stop-limit order types are not yet implemented. */}
            <div className="flex px-4 py-2 gap-4 text-xs font-semibold text-slate-400">
                <span className="cursor-not-allowed opacity-40" title="Not yet implemented">Limit</span>
                <span className="text-blue-500 border-b border-blue-500 cursor-pointer">Market</span>
                <span className="cursor-not-allowed opacity-40" title="Not yet implemented">Stop-limit</span>
            </div>

            <div className="flex-1 flex px-4 pb-4 gap-6 relative">

                {/* ── Buy column ──────────────────────────────────────────── */}
                <div className="flex-1 flex flex-col gap-3">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Available</span>
                        {/* TODO: wire to real wallet balance */}
                        <span className="text-white font-mono">1,500.00 {quoteAsset}</span>
                    </div>

                    <div className="relative">
                        <input
                            readOnly disabled value="Market"
                            className="w-full bg-[#1e1e2e]/50 border border-[#1e1e2e] rounded leading-relaxed px-3 py-1.5 text-xs text-slate-500 cursor-not-allowed"
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">Price</span>
                    </div>

                    <div className="relative">
                        <input
                            type="number"
                            value={buyQty}
                            onChange={(e) => setBuyQty(e.target.value)}
                            className="w-full bg-[#1e1e2e]/50 border border-[#1e1e2e] rounded leading-relaxed px-3 py-1.5 text-xs outline-none focus:border-green-500 transition-colors tabular-nums text-white text-right"
                            placeholder="0"
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">Amount</span>
                        <span
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">{baseAsset}</span>
                    </div>

                    {/* TODO: wire percentage slider to quantity input */}
                    <div className="h-1 w-full bg-[#1e1e2e] rounded-full my-2 relative"
                         title="Slider not yet implemented">
                        <div
                            className="absolute w-3 h-3 bg-green-500 rounded-full top-1/2 -translate-y-1/2 shadow-[0_0_8px_rgba(74,222,128,0.5)]"/>
                    </div>

                    <button
                        disabled={loading}
                        onClick={() => executeTrade('buy')}
                        className="w-full bg-green-500 hover:bg-green-600 text-white rounded py-2 text-sm font-bold tracking-wider transition-colors disabled:opacity-50 mt-auto"
                    >
                        {loading ? 'Processing…' : `Buy ${baseAsset}`}
                    </button>
                </div>

                {/* ── Sell column ─────────────────────────────────────────── */}
                <div className="flex-1 flex flex-col gap-3">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Available</span>
                        {/* TODO: wire to real wallet balance */}
                        <span className="text-white font-mono">24.50 {baseAsset}</span>
                    </div>

                    <div className="relative">
                        <input
                            readOnly disabled value="Market"
                            className="w-full bg-[#1e1e2e]/50 border border-[#1e1e2e] rounded leading-relaxed px-3 py-1.5 text-xs text-slate-500 cursor-not-allowed"
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">Price</span>
                    </div>

                    <div className="relative">
                        <input
                            type="number"
                            value={sellQty}
                            onChange={(e) => setSellQty(e.target.value)}
                            className="w-full bg-[#1e1e2e]/50 border border-[#1e1e2e] rounded leading-relaxed px-3 py-1.5 text-xs outline-none focus:border-red-500 transition-colors tabular-nums text-white text-right"
                            placeholder="0"
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">Amount</span>
                        <span
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">{baseAsset}</span>
                    </div>

                    {/* TODO: wire percentage slider to quantity input */}
                    <div className="h-1 w-full bg-[#1e1e2e] rounded-full my-2 relative"
                         title="Slider not yet implemented">
                        <div
                            className="absolute w-3 h-3 bg-red-500 rounded-full top-1/2 -translate-y-1/2 left-1/4 shadow-[0_0_8px_rgba(239,68,68,0.5)]"/>
                    </div>

                    <button
                        disabled={loading}
                        onClick={() => executeTrade('sell')}
                        className="w-full bg-red-500 hover:bg-red-600 text-white rounded py-2 text-sm font-bold tracking-wider transition-colors disabled:opacity-50 mt-auto"
                    >
                        {loading ? 'Processing…' : `Sell ${baseAsset}`}
                    </button>
                </div>

                {/* ── Result toast ─────────────────────────────────────────── */}
                {result && (
                    <div
                        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] p-4 rounded-lg border text-sm shadow-2xl backdrop-blur-md z-10 ${result.success ? 'bg-green-500/90 border-green-400 text-white' : 'bg-red-500/90 border-red-400 text-white'}`}>
                        <div className="font-bold border-b border-white/20 pb-2 mb-2">
                            {result.success ? 'Execution Success' : 'Execution Failed'}
                        </div>
                        <pre className="text-xs break-all whitespace-pre-wrap">
                            {JSON.stringify(result.details ?? result.message, null, 2)}
                        </pre>
                        <button
                            className="mt-4 w-full bg-black/20 hover:bg-black/30 py-1 rounded transition-colors"
                            onClick={() => setResult(null)}
                        >
                            Dismiss
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};