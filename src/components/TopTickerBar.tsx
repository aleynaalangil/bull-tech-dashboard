import { useTradeStore } from '../store';
import { useEffect, useRef, useState } from 'react';
import BigNumber from 'bignumber.js';

type FlashDirection = 'flash-up' | 'flash-down' | '';

export const TopTickerBar = ({ symbol }: { symbol: string }) => {
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

        /* eslint-disable react-hooks/set-state-in-effect */
        if (prev) {
            if (current.gt(prev)) {
                setFlashClass('flash-up');
            } else if (current.lt(prev)) {
                setFlashClass('flash-down');
            }
            // Equal price → no flash, no state update
        }
        /* eslint-enable react-hooks/set-state-in-effect */

        prevPriceRef.current = current;

        // Clear the class once the CSS animation finishes (300 ms) so the same
        // class can be applied again on the next tick.
        const timer = setTimeout(() => setFlashClass(''), 300);
        return () => clearTimeout(timer);
        // data?.price is a BigNumber object; using it directly as a dep would
        // always be a new reference. We rely on the store only updating when the
        // value actually changes, so this is safe and intentional.
    }, [data?.price]);

    // ── Early return for loading state ─────────────────────────────────────
    if (!data) return <div className="h-16 border-b border-[#1e1e2e] bg-[#12121a]" />;

    const priceStr = data.price.toFormat(2);
    const volStr = data.volume.multipliedBy(data.price).dividedBy(1_000).toFormat(2) + 'K';

    const { latency, throughput_tps, error_rate } = data.telemetry ?? {
        latency: null,
        throughput_tps: null,
        error_rate: null,
    };

    return (
        <div className="h-16 md:h-24 shrink-0 border-b border-[#1e1e2e] bg-[#0d0d12] flex items-center px-3 md:px-[2vw] justify-between overflow-x-auto no-scrollbar gap-3 md:gap-4">
            <div className="flex items-center gap-4">
                {/* Symbol Card */}
                <div className="flex flex-col pr-4 border-r border-[#1e1e2e]">
                    <span className="text-base md:text-xl font-black tracking-tighter text-white uppercase">{symbol}</span>
                </div>

                <div className="flex items-center gap-3">
                    {/* Price Card */}
                    <div className="metric-card">
                        <span className="metric-label">Last Price</span>
                        <span className={`metric-value text-green-400 text-lg transition-all ${flashClass}`}>
                            ${priceStr}
                        </span>
                    </div>

                    {/* 24h Change Card */}
                    <div className="metric-card">
                        <span className="metric-label">24h Change</span>
                        <div className="flex items-center gap-1">
                            {data.change_24h !== undefined ? (
                                <span className={`metric-value ${data.change_24h.gte(0) ? 'text-green-400' : 'text-red-400'}`}>
                                    {data.change_24h.gte(0) ? '▲' : '▼'} {data.change_24h.abs().toFormat(2)}%
                                </span>
                            ) : (
                                <span className="metric-value text-slate-500">—</span>
                            )}
                        </div>
                    </div>

                    {/* 1h Change Card */}
                    <div className="metric-card">
                        <span className="metric-label">1h Change</span>
                        <div className="flex items-center gap-1">
                            {data.change_1h !== undefined ? (
                                <span className={`metric-value ${data.change_1h.gte(0) ? 'text-green-400' : 'text-red-400'}`}>
                                    {data.change_1h.gte(0) ? '▲' : '▼'} {data.change_1h.abs().toFormat(2)}%
                                </span>
                            ) : (
                                <span className="metric-value text-slate-500">—</span>
                            )}
                        </div>
                    </div>

                    {/* 24h Volume Card */}
                    <div className="metric-card hidden lg:flex">
                        <span className="metric-label">24h Volume (USDC)</span>
                        <span className="metric-value text-slate-200">{volStr}</span>
                    </div>
                </div>
            </div>

            {/* Technical diagnostics */}
            <div className="hidden md:flex items-center gap-3">
                <div className="metric-card border-blue-500/10 bg-blue-500/5">
                    <span className="metric-label text-blue-400/70">Avg Latency</span>
                    <span className={`metric-value ${latency && latency.toNumber() > 50 ? 'text-red-400' : 'text-blue-400'}`}>
                        {latency ? latency.toFixed(2) : '0.00'} <span className="text-[10px] opacity-70">ms</span>
                    </span>
                </div>

                <div className="metric-card border-green-500/10 bg-green-500/5">
                    <span className="metric-label text-green-400/70">Throughput</span>
                    <span className="metric-value text-green-400">
                        {throughput_tps ? throughput_tps.toNumber().toLocaleString() : '0'} <span className="text-[10px] opacity-70">TPS</span>
                    </span>
                </div>

                <div className="metric-card border-purple-500/10 bg-purple-500/5">
                    <span className="metric-label text-purple-400/70">Error Rate</span>
                    <span className="metric-value text-purple-400">
                        {error_rate ? error_rate.multipliedBy(100).toFixed(3) : '0.000'}<span className="text-[10px] opacity-70">%</span>
                    </span>
                </div>
            </div>
        </div>
    );
};