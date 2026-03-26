import {useEffect, useRef} from 'react';
import {useTradeStore, type MarketData} from './store';
import BigNumber from 'bignumber.js';
import { logger } from './logger';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely converts any value to a BigNumber.
 * Uses a type guard instead of a cast so strict mode is satisfied.
 */
const toBN = (val: unknown, fallback = new BigNumber(0)): BigNumber => {
    if (val === null || val === undefined) return fallback;
    if (typeof val !== 'string' && typeof val !== 'number') return fallback;
    const bn = new BigNumber(val);
    return bn.isNaN() ? fallback : bn;
};

// ─── WebSocket message types ─────────────────────────────────────────────────

interface RawOrderBookLevel {
    price: unknown;
    size: unknown;
}

interface RawBbo {
    best_bid: unknown;
    best_ask: unknown;
    bid_size: unknown;
    ask_size: unknown;
    spread: unknown;
    bids?: RawOrderBookLevel[];
    asks?: RawOrderBookLevel[];
    timestamp?: string;
    symbol?: string;
}

interface RawTick {
    price: unknown;
    amount: unknown;
    symbol?: string;
    side?: string;
    timestamp?: string;
    order_id?: string;
    trader_id?: number;
}

interface RawTelemetry {
    latency: unknown;
    throughput_tps: unknown;
    error_rate: unknown;
}

interface RawOhlc {
    candle_time: string;
    open: unknown;
    high: unknown;
    low: unknown;
    close: unknown;
    volume: unknown;
    symbol?: string;
}

interface WsMessage {
    symbol: string;
    price?: unknown;
    volume?: unknown;
    change_1h?: unknown;
    change_24h?: unknown;
    bbo?: RawBbo;
    tick?: RawTick;
    telemetry?: RawTelemetry;
    ohlc?: RawOhlc;
}

// ─── Config ──────────────────────────────────────────────────────────────────

// Pull from Vite env so this works in dev, staging, and prod without code changes.
// Set VITE_WS_URL in your .env files:
//   .env.development  →  VITE_WS_URL=ws://localhost:8080/v1/feed
//   .env.production   →  VITE_WS_URL=wss://hft-gateway-us-east-1.example.com/v1/feed
const rawWsUrl: string | undefined = import.meta.env.VITE_WS_URL;
if (!rawWsUrl) {
    throw new Error('[useMarketDataStream] VITE_WS_URL is not set. Add it to your .env file.');
}
export const WS_URL: string = rawWsUrl;

const FLUSH_INTERVAL_MS = 100;       // 10 FPS render throttle
const ALERT_COOLDOWN_MS = 5_000;    // min gap between same-symbol alerts
const LATENCY_ALERT_THRESHOLD = 120; // ms

// Reconnect backoff: 500 ms → 1 s → 2 s → … → 30 s ceiling
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;

// ─── Hook ────────────────────────────────────────────────────────────────────

export const useMarketDataStream = (url: string) => {
    const updatePrice = useTradeStore((state) => state.updatePrice);
    const addAlert = useTradeStore((state) => state.addAlert);
    const setWsStatus = useTradeStore((state) => state.setWsStatus);

    // Buffer holds the *latest* tick per symbol between flush cycles.
    // Only partial updates arrive here; we merge with existing store state
    // inside the flush so no field is accidentally wiped.
    const bufferRef = useRef<Record<string, Partial<MarketData>>>({});
    const lastAlertTime = useRef<Record<string, number>>({});
    const reconnectDelay = useRef(RECONNECT_BASE_MS);

    useEffect(() => {
        // Local closure variable — each effect instance owns its own flag.
        // Using a ref here is wrong because React 19 StrictMode runs the effect
        // twice: cleanup of the first run sets unmounted=true, but by the time
        // the first socket's async onclose fires the second run has already
        // reset the ref to false, making scheduleReconnect think it should
        // reconnect on behalf of the (already-dead) first instance.
        let isMounted = true;
        reconnectDelay.current = RECONNECT_BASE_MS; // reset backoff on remount

        let socket: WebSocket;
        let flushInterval: ReturnType<typeof setInterval>;
        let reconnectTimer: ReturnType<typeof setTimeout>;

        // ── connect ────────────────────────────────────────────────────────
        const connect = () => {
            if (!isMounted) return;

            setWsStatus('connecting');
            socket = new WebSocket(url);

            // ── flush: drain buffer atomically, merge into store ──────────
            flushInterval = setInterval(() => {
                // Snapshot and immediately clear so we never re-dispatch stale data.
                const snapshot = bufferRef.current;
                bufferRef.current = {};

                const symbols = Object.keys(snapshot);
                if (symbols.length === 0) return;

                const currentPrices = useTradeStore.getState().prices;

                symbols.forEach((sym) => {
                    const incoming = snapshot[sym];
                    const existing = currentPrices[sym];

                    // Deep-merge: only overwrite fields that were actually present
                    // in this tick. Fields absent from the partial update are
                    // preserved from the previous store state.
                    const merged: MarketData = {
                        ...(existing ?? {}),
                        ...incoming,
                        symbol: sym,
                        // Ensure required fields always exist
                        price: incoming.price ?? existing?.price ?? new BigNumber(0),
                        volume: incoming.volume ?? existing?.volume ?? new BigNumber(0),
                    } as MarketData;

                    updatePrice(merged);
                });
            }, FLUSH_INTERVAL_MS);

            // ── message handler ───────────────────────────────────────────
            socket.onmessage = (event) => {
                try {
                    if (typeof event.data !== 'string') return;
                    const raw = JSON.parse(event.data) as WsMessage;
                    const sym: string = raw.symbol;
                    if (!sym) return;

                    // Only include change fields when the backend actually sent them.
                    // Setting change_1h: undefined in a spread overwrites the previously
                    // stored value with undefined on the next non-change tick.
                    const data: Partial<MarketData> = {
                        symbol: sym,
                        price: toBN(raw.price),
                        volume: toBN(raw.volume),
                    };
                    if (raw.change_1h  !== undefined) data.change_1h  = toBN(raw.change_1h);
                    if (raw.change_24h !== undefined) data.change_24h = toBN(raw.change_24h);

                    // BBO / order-book levels
                    if (raw.bbo) {
                        data.bbo = {
                            symbol: sym,
                            timestamp: raw.bbo.timestamp ?? '',
                            best_bid: toBN(raw.bbo.best_bid),
                            best_ask: toBN(raw.bbo.best_ask),
                            bid_size: toBN(raw.bbo.bid_size),
                            ask_size: toBN(raw.bbo.ask_size),
                            spread: toBN(raw.bbo.spread),
                            bids: (raw.bbo.bids ?? []).map((b: RawOrderBookLevel) => ({
                                price: toBN(b.price),
                                size: toBN(b.size),
                            })),
                            asks: (raw.bbo.asks ?? []).map((a: RawOrderBookLevel) => ({
                                price: toBN(a.price),
                                size: toBN(a.size),
                            })),
                        };
                    }

                    // Last trade tick
                    if (raw.tick) {
                        data.tick = {
                            symbol: sym,
                            side: raw.tick.side ?? '',
                            timestamp: raw.tick.timestamp ?? '',
                            order_id: raw.tick.order_id ?? '',
                            trader_id: raw.tick.trader_id ?? 0,
                            price: toBN(raw.tick.price),
                            amount: toBN(raw.tick.amount),
                        };
                    }

                    // Telemetry with EMA smoothing (α = 0.05 ≈ 20-tick rolling avg)
                    if (raw.telemetry) {
                        let lat = toBN(raw.telemetry.latency);
                        let tps = toBN(raw.telemetry.throughput_tps);
                        let err = toBN(raw.telemetry.error_rate);

                        // Read previous smoothed values from the buffer first,
                        // then fall back to the last committed store state.
                        const prevTelemetry =
                            bufferRef.current[sym]?.telemetry ??
                            useTradeStore.getState().prices[sym]?.telemetry;

                        if (prevTelemetry) {
                            const α = new BigNumber(0.05);
                            const α1 = new BigNumber(0.95);
                            lat = lat.multipliedBy(α).plus(prevTelemetry.latency.multipliedBy(α1));
                            tps = tps.multipliedBy(α).plus(prevTelemetry.throughput_tps.multipliedBy(α1));
                            err = err.multipliedBy(α).plus(prevTelemetry.error_rate.multipliedBy(α1));
                        }

                        data.telemetry = {latency: lat, throughput_tps: tps, error_rate: err};
                    }

                    // OHLCV bar
                    if (raw.ohlc) {
                        data.ohlc = {
                            ...raw.ohlc,
                            symbol: sym,
                            open: toBN(raw.ohlc.open),
                            high: toBN(raw.ohlc.high),
                            low: toBN(raw.ohlc.low),
                            close: toBN(raw.ohlc.close),
                            volume: toBN(raw.ohlc.volume),
                        };
                    }

                    // Merge with any already-buffered partial for this symbol
                    // so we don't lose a bbo update that arrived one tick ago
                    // when an ohlc-only tick arrives right after.
                    bufferRef.current[sym] = {...bufferRef.current[sym], ...data};

                    // ── unthrottled latency alert (needs raw value) ────────
                    const rawLat = raw.telemetry?.latency;
                    if (typeof rawLat === 'number' && rawLat > LATENCY_ALERT_THRESHOLD) {
                        const now = Date.now();
                        if (now - (lastAlertTime.current[sym] ?? 0) > ALERT_COOLDOWN_MS) {
                            addAlert({
                                message: `High latency on ${sym}: ${rawLat.toFixed(2)} ms`,
                                type: 'critical',
                            });
                            lastAlertTime.current[sym] = now;
                        }
                    }
                } catch (e) {
                    logger.error('WS message parse error', { error: String(e), data: event.data });
                }
            };

            // ── reconnect on close / error ────────────────────────────────
            const scheduleReconnect = () => {
                if (!isMounted) return;
                clearInterval(flushInterval);
                setWsStatus('reconnecting');
                reconnectTimer = setTimeout(() => {
                    reconnectDelay.current = Math.min(
                        reconnectDelay.current * 2,
                        RECONNECT_MAX_MS,
                    );
                    connect();
                }, reconnectDelay.current);
            };

            socket.onopen = () => {
                reconnectDelay.current = RECONNECT_BASE_MS;
                setWsStatus('connected');
            };
            socket.onerror = (err) => logger.error('WebSocket error', { error: String(err) });
            socket.onclose = (evt) => {
                if (!isMounted) return; // StrictMode cleanup — don't reconnect
                logger.warn('WebSocket closed — scheduling reconnect', { code: evt.code, delay: reconnectDelay.current });
                scheduleReconnect();
            };
        };

        connect();

        return () => {
            isMounted = false;
            clearInterval(flushInterval);
            clearTimeout(reconnectTimer);
            socket?.close();
        };
    }, [url, updatePrice, addAlert, setWsStatus]);
};
