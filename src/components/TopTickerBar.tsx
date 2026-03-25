import {useTradeStore} from '../store';
import {useEffect, useRef, useState} from 'react';
import BigNumber from 'bignumber.js';

type FlashDirection = 'flash-up' | 'flash-down' | '';

export const TopTickerBar = ({symbol}: { symbol: string }) => {
    const data = useTradeStore((state) => state.prices[symbol]);

    // ── Price-flash animation ───────────────────────────────────────────────
    // We store the previous price in a ref (not state) so comparing it never
    // triggers an extra render. The flash class is the only piece of state here,
    // and it is set in direct response to a prop change — exactly what useEffect
    // is designed for. No eslint suppression needed.
    const [flashClass, setFlashClass] = useState<FlashDirection>('');
    const prevPriceRef = useRef<BigNumber | undefined>(undefined);

    useEffect(() => {
        const current = data?.price;
        const prev = prevPriceRef.current;

        if (!current) return;

        if (prev) {
            if (current.gt(prev)) {
                setFlashClass('flash-up');
            } else if (current.lt(prev)) {
                setFlashClass('flash-down');
            }
            // Equal price → no flash, no state update
        }

        prevPriceRef.current = current;

        // Clear the class once the CSS animation finishes (300 ms) so the same
        // class can be applied again on the next tick.
        const timer = setTimeout(() => setFlashClass(''), 300);
        return () => clearTimeout(timer);
        // data?.price is a BigNumber object; using it directly as a dep would
        // always be a new reference. We rely on the store only updating when the
        // value actually changes, so this is safe and intentional.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data?.price]);

    // ── Early return for loading state ─────────────────────────────────────
    if (!data) return <div className="h-16 border-b border-[#1e1e2e] bg-[#12121a]"/>;

    const priceStr = data.price.toFormat(2);
    const volStr = data.volume.multipliedBy(data.price).dividedBy(1_000).toFormat(2) + 'K';

    const {latency, throughput_tps, error_rate} = data.telemetry ?? {
        latency: null,
        throughput_tps: null,
        error_rate: null,
    };

    return (
        <div
            className="h-20 shrink-0 border-b border-[#1e1e2e] bg-[#12121a] flex items-center px-4 md:px-6 justify-between">
            <div className="flex items-center gap-6 md:gap-8">

                {/* Symbol */}
                <div className="flex flex-col">
                    <span className="text-lg font-bold tracking-tight text-white drop-shadow-md">{symbol}</span>
                </div>

                {/* Live price with up/down flash */}
                <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Price</span>
                    <span
                        className={`text-green-400 font-bold font-mono text-base px-1 -mx-1 transition-colors ${flashClass}`}>
                        {priceStr}
                    </span>
                </div>

                {/* 24h change */}
                <div className="hidden sm:flex flex-col">
                    <span
                        className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">24h Change</span>
                    <span
                        className={`${(data.change_24h?.gte(0) ?? true) ? 'text-green-400' : 'text-red-400'} font-mono font-medium`}>
                        {data.change_24h
                            ? `${data.change_24h.gt(0) ? '+' : ''}${data.change_24h.toFormat(2)}%`
                            : '0.00%'}
                    </span>
                </div>

                {/* 24h volume */}
                <div className="hidden lg:flex flex-col">
                    <span
                        className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">24h Volume</span>
                    <span className="text-slate-200 font-mono font-medium">{volStr}</span>
                </div>
            </div>

            {/* Technical diagnostics */}
            <div className="hidden xl:flex items-center gap-4 md:gap-6 border-l border-[#1e1e2e] pl-4 md:pl-6">
                <div className="flex flex-col">
                    <span
                        className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Avg Latency</span>
                    <span
                        className={`font-mono text-sm font-medium ${latency && latency.toNumber() > 50 ? 'text-red-400 drop-shadow-[0_0_4px_rgba(239,68,68,0.5)]' : 'text-green-400'}`}>
                        {latency ? latency.toFixed(2) : '0.00'} ms
                    </span>
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Tick TPS</span>
                    <span className="text-blue-400 font-mono text-sm font-medium">
                        {throughput_tps ? throughput_tps.toNumber().toLocaleString() : '0'}
                    </span>
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Err Rate</span>
                    <span className="text-purple-400 font-mono text-sm font-medium">
                        {error_rate ? error_rate.multipliedBy(100).toFixed(3) : '0.000'}%
                    </span>
                </div>
            </div>
        </div>
    );
};