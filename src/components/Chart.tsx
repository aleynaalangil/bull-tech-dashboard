import { useEffect, useRef, useState, useCallback } from 'react';
import { logger } from '../logger';
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

// Allow empty string so the Vite dev proxy can intercept /api/* requests
// (set VITE_API_URL= in .env.development). Must be defined; undefined means
// the variable was never added to the .env file.
const rawApiUrl: string | undefined = import.meta.env.VITE_API_URL;
if (rawApiUrl === undefined) {
    throw new Error('[Chart] VITE_API_URL is not set. Add it to your .env file.');
}
const API_BASE: string = rawApiUrl;

// ── Timeframe config ─────────────────────────────────────────────────────────
// Backend API requirement: GET /api/v1/ohlcv/{symbol}?interval={interval}&minutes={minutes}
// interval: '1m' | '5m' | '15m' | '1h' | '1d'
// minutes: total window to fetch (e.g. 1440 = 24h of 1m candles)
// The backend must pre-aggregate into the requested candle size. The 1m
// materialized view already exists; 5m/15m/1h/1d require additional
// AggregatingMergeTree views or on-the-fly GROUP BY in ClickHouse.

type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d';

const TIMEFRAMES: { label: string; value: Timeframe; minutes: number }[] = [
    { label: '1m',  value: '1m',  minutes: 1_440   },   // 24 h
    { label: '5m',  value: '5m',  minutes: 7_200   },   // 5 d
    { label: '15m', value: '15m', minutes: 21_600  },   // 15 d
    { label: '1h',  value: '1h',  minutes: 43_200  },   // 30 d
    { label: '1d',  value: '1d',  minutes: 131_400 },   // 3 months
];

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
    const [timeframe, setTimeframe] = useState<Timeframe>('1m');
    const [tooltip, setTooltip] = useState<TooltipData>({
        time: '', open: 0, high: 0, low: 0, close: 0, x: 0, y: 0, visible: false,
    });

    // Listen to live OHLC bars pushed from the Rust generator via the Zustand store
    const ohlcData = useTradeStore((state) => state.prices[symbol]?.ohlc);

    // Stable ref so the chart init effect can close over it without re-running
    const timeframeRef = useRef<Timeframe>(timeframe);
    useEffect(() => { timeframeRef.current = timeframe; }, [timeframe]);

    const loadHistory = useCallback((candleSeries: ISeriesApi<'Candlestick'>, signal: AbortSignal) => {
        const tf = TIMEFRAMES.find((t) => t.value === timeframeRef.current) ?? TIMEFRAMES[0];
        const slug = symbol.replace('/', '-');
        return fetch(
            `${API_BASE}/api/v1/ohlcv/${slug}?interval=${tf.value}&minutes=${tf.minutes}`,
            { signal },
        ).then(async (response) => {
            if (!response.ok) {
                logger.error('OHLCV history request failed', { status: response.status, statusText: response.statusText });
                return;
            }
            const data: unknown = await response.json();
            if (!Array.isArray(data)) { logger.error('Unexpected OHLCV response shape', { data }); return; }
            const historicalData = data.map((bar: RawOhlcvBar) => ({
                time: Math.floor(new Date(bar.candle_time).getTime() / 1000) as Time,
                open: parseFloat(bar.open),
                high: parseFloat(bar.high),
                low: parseFloat(bar.low),
                close: parseFloat(bar.close),
            }));
            if (historicalData.length > 0) candleSeries.setData(historicalData);
        }).catch((err) => {
            if (err instanceof Error && err.name === 'AbortError') return;
            logger.error('Failed to fetch OHLC history', { error: String(err) });
        });
    }, [symbol]);

    // Re-fetch history when timeframe changes (chart already mounted)
    useEffect(() => {
        if (!seriesRef.current) return;
        const ac = new AbortController();
        loadHistory(seriesRef.current, ac.signal);
        return () => ac.abort();
    }, [timeframe, loadHistory]);

    // ── Chart initialisation ────────────────────────────────────────────────
    useEffect(() => {
        if (!chartContainerRef.current) return;

        // AbortController cancels the in-flight OHLCV fetch when StrictMode
        // unmounts the effect before the response arrives. Without this,
        // StrictMode's double-invoke fires two rapid requests — the first
        // never cancelled — which can trigger backend rate limits (429).
        const abortController = new AbortController();

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
        loadHistory(candleSeries, abortController.signal);

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
            abortController.abort();
            // Null the refs first so the live-update effect sees no series
            // before the chart is disposed. This prevents `seriesRef.current.update()`
            // being called on an already-disposed chart (the "Object is disposed" error).
            chartRef.current = null;
            seriesRef.current = null;
            chart.remove();
        };
    // loadHistory is stable per symbol; including it avoids the lint warning.
    }, [symbol, loadHistory]);

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
            {/* Timeframe selector — overlaid top-left of the chart */}
            <div className="absolute top-2 left-2 z-10 flex gap-1">
                {TIMEFRAMES.map((tf) => (
                    <button
                        key={tf.value}
                        onClick={() => setTimeframe(tf.value)}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded transition-all ${
                            timeframe === tf.value
                                ? 'bg-blue-500 text-black'
                                : 'bg-[#1e1e2e]/80 text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        {tf.label}
                    </button>
                ))}
            </div>
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