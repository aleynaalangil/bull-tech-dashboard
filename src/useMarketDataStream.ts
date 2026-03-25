import {useEffect, useRef} from 'react';
import {useTradeStore, type MarketData} from './store';
import BigNumber from 'bignumber.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely converts any value to a BigNumber.
 * Returns a BigNumber(0) fallback instead of undefined so callers don't need
 * to OR-guard every single usage site.
 */
const toBN = (val: unknown, fallback = new BigNumber(0)): BigNumber => {
    if (val === null || val === undefined) return fallback;
    const bn = new BigNumber(val as string | number);
    return bn.isNaN() ? fallback : bn;
};

interface RawOrderBookLevel {
    price: unknown;
    size: unknown;
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

    // Buffer holds the *latest* tick per symbol between flush cycles.
    // Only partial updates arrive here; we merge with existing store state
    // inside the flush so no field is accidentally wiped.
    const bufferRef = useRef<Record<string, Partial<MarketData>>>({});
    const lastAlertTime = useRef<Record<string, number>>({});
    const reconnectDelay = useRef(RECONNECT_BASE_MS);
    const unmounted = useRef(false);

    useEffect(() => {
        unmounted.current = false;

        let socket: WebSocket;
        let flushInterval: ReturnType<typeof setInterval>;
        let reconnectTimer: ReturnType<typeof setTimeout>;

        // ── connect ────────────────────────────────────────────────────────
        const connect = () => {
            if (unmounted.current) return;

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
                    const raw = JSON.parse(event.data as string);
                    const sym: string = raw.symbol;
                    if (!sym) return;

                    const data: Partial<MarketData> = {
                        symbol: sym,
                        price: toBN(raw.price),
                        volume: toBN(raw.volume),
                        change_24h: raw.change_24h !== undefined ? toBN(raw.change_24h) : undefined,
                    };

                    // BBO / order-book levels
                    if (raw.bbo) {
                        data.bbo = {
                            ...raw.bbo,
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
                            ...raw.tick,
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
                    const rawLat: number | undefined = raw.telemetry?.latency;
                    if (rawLat !== undefined && rawLat > LATENCY_ALERT_THRESHOLD) {
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
                    console.error('WS message parse error:', e, event.data);
                }
            };

            // ── reconnect on close / error ────────────────────────────────
            const scheduleReconnect = () => {
                if (unmounted.current) return;
                clearInterval(flushInterval);
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
            };
            socket.onerror = (err) => console.error('WebSocket error:', err);
            socket.onclose = (evt) => {
                console.warn(`WebSocket closed (code ${evt.code}). Reconnecting in ${reconnectDelay.current} ms…`);
                scheduleReconnect();
            };
        };

        connect();

        return () => {
            unmounted.current = true;
            clearInterval(flushInterval);
            clearTimeout(reconnectTimer);
            socket?.close();
        };
    }, [url, updatePrice, addAlert]);
};