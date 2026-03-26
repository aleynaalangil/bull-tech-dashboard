import {useTradeStore} from '../store';
import BigNumber from 'bignumber.js';

// Fixed-point scaling factor: 10^8 matching the Rust backend
const FIXED_POINT_SCALE = new BigNumber(100_000_000);

export const OrderBook = ({symbol}: { symbol: string }) => {
    const data = useTradeStore((state) => state.prices[symbol]);

    if (!data || !data.bbo) {
        return (
            <div className="bg-[#12121a] flex-1 flex items-center justify-center text-slate-500 text-sm">
                Waiting for Level 2 data...
            </div>
        );
    }

    const {best_bid, best_ask, spread} = data.bbo;

    const bPrice = best_bid.dividedBy(FIXED_POINT_SCALE);
    const aPrice = best_ask.dividedBy(FIXED_POINT_SCALE);
    const actualSpread = spread.dividedBy(FIXED_POINT_SCALE).toFixed(3);

    const asks = data.bbo.asks.map(level => {
        const p = level.price.dividedBy(FIXED_POINT_SCALE);
        const s = level.size.dividedBy(FIXED_POINT_SCALE);
        return {price: p, amount: s, total: p.multipliedBy(s)};
    }).reverse();

    const bids = data.bbo.bids.map(level => {
        const p = level.price.dividedBy(FIXED_POINT_SCALE);
        const s = level.size.dividedBy(FIXED_POINT_SCALE);
        return {price: p, amount: s, total: p.multipliedBy(s)};
    });

    return (
        <div className="flex flex-col h-full bg-[#12121a]">
            {/* Header */}
            <div
                className="flex justify-between items-center px-3 py-2 border-b border-[#1e1e2e] shrink-0 bg-[#0a0a0f]">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider">ORDER BOOK</span>
                <span className="text-[10px] text-slate-500 font-mono">0.01</span>
            </div>

            {/* Columns */}
            <div
                className="flex justify-between px-3 py-1.5 text-[10px] text-slate-500 font-bold tracking-wider shrink-0 border-b border-[#1e1e2e]">
                <span className="w-1/3 text-left">Price</span>
                <span className="w-1/3 text-right">Amount</span>
                <span className="w-1/3 text-right">Total</span>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col font-mono text-[11px] select-none">
                {/* Asks (Red) */}
                <div className="flex flex-col justify-end min-h-[40%] flex-1 py-1">
                    {asks.map((ask, i) => (
                        <div key={`ask-${i}`}
                             className="flex justify-between hover:bg-[#1e1e2e] py-[2px] px-3 cursor-pointer relative group">
                            <div
                                className="absolute right-0 top-0 bottom-0 bg-red-500/10 transition-all pointer-events-none"
                                style={{width: `${Math.min(100, ask.amount.toNumber() / 15)}%`}}
                            />
                            <span className="w-1/3 text-left text-red-500 z-10">{ask.price.toFormat(2)}</span>
                            <span className="w-1/3 text-right text-slate-300 z-10">{ask.amount.toFormat(3)}</span>
                            <span
                                className="w-1/3 text-right text-slate-500 z-10">{ask.total.dividedBy(1000).toFormat(2)}K</span>
                        </div>
                    ))}
                </div>

                {/* Spread / Mark Price Center */}
                <div
                    className="flex items-center justify-between px-3 py-2 bg-[#181824] shrink-0 border-y border-[#1e1e2e]">
                    <span className="text-base font-bold text-green-400 drop-shadow-[0_0_2px_rgba(74,222,128,0.5)] font-mono">
                        {bPrice.toFormat(2)}
                    </span>
                    <div className="flex flex-col items-center">
                        <span className="text-[9px] text-slate-500 uppercase tracking-wider">Spread</span>
                        <span className="text-[11px] text-slate-300 font-mono">{actualSpread}</span>
                    </div>
                    <span className="text-base font-bold text-red-400 drop-shadow-[0_0_2px_rgba(248,113,113,0.5)] font-mono">
                        {aPrice.toFormat(2)}
                    </span>
                </div>

                {/* Bids (Green) */}
                <div className="flex flex-col min-h-[40%] flex-1 py-1">
                    {bids.map((bid, i) => (
                        <div key={`bid-${i}`}
                             className="flex justify-between hover:bg-[#1e1e2e] py-[2px] px-3 cursor-pointer relative group">
                            <div
                                className="absolute right-0 top-0 bottom-0 bg-green-500/10 transition-all pointer-events-none"
                                style={{width: `${Math.min(100, bid.amount.toNumber() / 15)}%`}}
                            />
                            <span className="w-1/3 text-left text-green-500 z-10">{bid.price.toFormat(2)}</span>
                            <span className="w-1/3 text-right text-slate-300 z-10">{bid.amount.toFormat(3)}</span>
                            <span
                                className="w-1/3 text-right text-slate-500 z-10">{bid.total.dividedBy(1000).toFormat(2)}K</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
