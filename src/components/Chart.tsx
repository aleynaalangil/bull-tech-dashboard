import {useEffect, useRef} from 'react';
import {
    createChart,
    CandlestickSeries,
    ColorType,
    type IChartApi,
    type ISeriesApi,
    type CandlestickSeriesOptions,
    type Time,
} from 'lightweight-charts';
import {useTradeStore} from '../store';

// Pull from env so this works without code changes across environments.
// Set VITE_API_URL in your .env files:
//   .env.development → VITE_API_URL=http://localhost:8080
//   .env.production → VITE_API_URL=https://hft-gateway-us-east-1.example.com
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

export const Chart = ({symbol}: { symbol: string }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

    // Listen to live OHLC bars pushed from the Rust generator via the Zustand store
    const ohlcData = useTradeStore((state) => state.prices[symbol]?.ohlc);

    // ── Chart initialisation ────────────────────────────────────────────────
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: {type: ColorType.Solid, color: '#0a0a0f'},
                textColor: '#94a3b8',
            },
            grid: {
                vertLines: {color: '#1e1e2e'},
                horzLines: {color: '#1e1e2e'},
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
                const response = await fetch(`${API_BASE}/api/v1/ohlcv/${slug}`);

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

        return () => {
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

    return <div ref={chartContainerRef} className="absolute inset-0 w-full h-full"/>;
};