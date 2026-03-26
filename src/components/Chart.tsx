import { useEffect, useRef, useState } from 'react';
import {
    createChart,
    CandlestickSeries,
    ColorType,
    type IChartApi,
    type ISeriesApi,
    type CandlestickSeriesOptions,
    type CandlestickData,
    type Time,
} from 'lightweight-charts';
import { useTradeStore } from '../store';

const rawApiUrl: string | undefined = import.meta.env.VITE_API_URL;
if (!rawApiUrl) {
    throw new Error('[Chart] VITE_API_URL is not set. Add it to your .env file.');
}
const API_BASE: string = rawApiUrl;

interface RawOhlcvBar {
    candle_time: string;
    open: string;
    high: string;
    low: string;
    close: string;
}

interface TooltipData {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    x: number;
    y: number;
    visible: boolean;
}

export const Chart = ({ symbol }: { symbol: string }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const [tooltip, setTooltip] = useState<TooltipData>({
        time: '', open: 0, high: 0, low: 0, close: 0, x: 0, y: 0, visible: false,
    });

    // Listen to live OHLC bars pushed from the Rust generator via the Zustand store
    const ohlcData = useTradeStore((state) => state.prices[symbol]?.ohlc);

    // ── Chart initialisation ────────────────────────────────────────────────
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#0a0a0f' },
                textColor: '#94a3b8',
            },
            grid: {
                vertLines: { color: '#1e1e2e' },
                horzLines: { color: '#1e1e2e' },
            },
            autoSize: true,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderVisible: false,
            },
            rightPriceScale: {
                borderVisible: false,
            },
        });

        // lightweight-charts v4+: use the typed addSeries overload directly.
        // Passing CandlestickSeries as the first argument is the correct v4 API;
        // casting to `any` was masking a stale import pattern from v3.
        const seriesOptions: Partial<CandlestickSeriesOptions> = {
            upColor: '#4ade80',
            downColor: '#f87171',
            borderVisible: false,
            wickUpColor: '#4ade80',
            wickDownColor: '#f87171',
        };
        const candleSeries = chart.addSeries(CandlestickSeries, seriesOptions);

        chartRef.current = chart;
        seriesRef.current = candleSeries;

        // ── Fetch historical OHLCV from the Rust / ClickHouse backend ──────
        const fetchHistory = async () => {
            try {
                const slug = symbol.replace('/', '-');
                const response = await fetch(`${API_BASE}/api/v1/ohlcv/${slug}?minutes=1440`);

                if (!response.ok) {
                    console.error(`OHLCV history request failed: ${response.status} ${response.statusText}`);
                    return;
                }

                const data: unknown = await response.json();

                if (!Array.isArray(data)) {
                    console.error('Unexpected OHLCV response shape:', data);
                    return;
                }

                const historicalData = data.map((bar: RawOhlcvBar) => ({
                    time: Math.floor(new Date(bar.candle_time).getTime() / 1000) as Time,
                    open: parseFloat(bar.open),
                    high: parseFloat(bar.high),
                    low: parseFloat(bar.low),
                    close: parseFloat(bar.close),
                }));

                if (historicalData.length > 0) {
                    candleSeries.setData(historicalData);
                }
            } catch (err) {
                console.error('Failed to fetch OHLC history:', err);
            }
        };

        fetchHistory();

        // ── Crosshair tooltip ───────────────────────────────────────────────
        chart.subscribeCrosshairMove((param) => {
            if (
                !param.point ||
                !param.time ||
                param.point.x < 0 ||
                param.point.y < 0
            ) {
                setTooltip((t) => ({ ...t, visible: false }));
                return;
            }

            const bar = param.seriesData.get(candleSeries) as CandlestickData | undefined;
            if (!bar) {
                setTooltip((t) => ({ ...t, visible: false }));
                return;
            }

            const timeNum = typeof param.time === 'number' ? param.time : 0;
            const date = new Date(timeNum * 1000);
            const timeStr = date.toLocaleString(undefined, {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
                hour12: false,
            });

            const containerWidth = chartContainerRef.current?.clientWidth ?? 0;
            const tooltipWidth = 160;
            const x = param.point.x + 12 + tooltipWidth > containerWidth
                ? param.point.x - tooltipWidth - 12
                : param.point.x + 12;

            setTooltip({
                time: timeStr,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                x,
                y: param.point.y,
                visible: true,
            });
        });

        return () => {
            // Null the refs first so the live-update effect sees no series
            // before the chart is disposed. This prevents `seriesRef.current.update()`
            // being called on an already-disposed chart (the "Object is disposed" error).
            chartRef.current = null;
            seriesRef.current = null;
            chart.remove();
        };
    }, [symbol]);

    // ── Live bar updates from the WebSocket stream ──────────────────────────
    useEffect(() => {
        if (!seriesRef.current || !ohlcData) return;

        seriesRef.current.update({
            time: Math.floor(new Date(ohlcData.candle_time).getTime() / 1000) as Time,
            open: ohlcData.open.toNumber(),
            high: ohlcData.high.toNumber(),
            low: ohlcData.low.toNumber(),
            close: ohlcData.close.toNumber(),
        });
    }, [ohlcData]);

    const isUp = tooltip.close >= tooltip.open;

    return (
        <div className="relative w-full h-full">
            <div ref={chartContainerRef} className="absolute inset-0 w-full h-full" />
            {tooltip.visible && (
                <div
                    className="pointer-events-none absolute z-10 rounded border border-[#1e1e2e] bg-[#12121a]/95 px-3 py-2 text-xs shadow-lg"
                    style={{ left: tooltip.x, top: tooltip.y, transform: 'translateY(-50%)' }}
                >
                    <div className="mb-1 text-[#94a3b8]">{tooltip.time}</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                        <span className="text-[#94a3b8]">O</span>
                        <span className="text-right font-mono text-white">{tooltip.open.toFixed(2)}</span>
                        <span className="text-[#94a3b8]">H</span>
                        <span className="text-right font-mono text-[#4ade80]">{tooltip.high.toFixed(2)}</span>
                        <span className="text-[#94a3b8]">L</span>
                        <span className="text-right font-mono text-[#f87171]">{tooltip.low.toFixed(2)}</span>
                        <span className="text-[#94a3b8]">C</span>
                        <span className={`text-right font-mono ${isUp ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                            {tooltip.close.toFixed(2)}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};