import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import BigNumber from 'bignumber.js';

// ── BigNumber-aware JSON serialization ────────────────────────────────────────
// BigNumber instances are not JSON-serialisable by default. We tag them with a
// prefix so the reviver can reconstruct them when reading back from localStorage.

const BN_TAG = '__BN__';

function replacer(_key: string, value: unknown): unknown {
    if (value instanceof BigNumber) return `${BN_TAG}${value.toFixed()}`;
    return value;
}

function reviver(_key: string, value: unknown): unknown {
    if (typeof value === 'string' && value.startsWith(BN_TAG)) {
        return new BigNumber(value.slice(BN_TAG.length));
    }
    return value;
}

// ── Domain types ──────────────────────────────────────────────────────────────

export interface OrderBookLevel {
    price: BigNumber;
    size: BigNumber;
}

export interface BboSnapshot {
    symbol: string;
    best_bid: BigNumber;
    best_ask: BigNumber;
    bid_size: BigNumber;
    ask_size: BigNumber;
    spread: BigNumber;
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    timestamp: string;
}

export interface MarketTick {
    symbol: string;
    side: string;
    price: BigNumber;
    amount: BigNumber;
    timestamp: string;
    order_id: string;
    trader_id: number;
}

export interface SystemTelemetry {
    latency: BigNumber;
    throughput_tps: BigNumber;
    error_rate: BigNumber;
}

export interface OhlcvBar {
    symbol: string;
    candle_time: string;
    open: BigNumber;
    high: BigNumber;
    low: BigNumber;
    close: BigNumber;
    volume: BigNumber;
}

export interface MarketData {
    price: BigNumber;
    volume: BigNumber;
    symbol: string;
    change_1h?: BigNumber;
    change_24h?: BigNumber;
    bbo?: BboSnapshot;
    tick?: MarketTick;
    ohlc?: OhlcvBar;
    telemetry?: SystemTelemetry;
}

export interface Alert {
    id: string;
    message: string;
    type: 'critical' | 'info';
    timestamp: number;
}

export interface PriceAlert {
    id: string;
    symbol: string;
    targetPrice: BigNumber;
    condition: 'above' | 'below';
    side: 'buy' | 'sell';
    quantity: string;
    createdAt: number;
}

export interface PendingOrder {
    id: string;
    type: 'limit' | 'stop-limit';
    symbol: string;
    side: 'buy' | 'sell';
    quantity: string;
    limitPrice: BigNumber;
    stopPrice?: BigNumber;      // stop-limit only: the trigger price
    status: 'waiting'           // stop-limit: watching for stopPrice to be crossed
           | 'triggered';       // stop was hit; now watching limitPrice like a plain limit
    createdAt: number;
}

// ── Store interface ───────────────────────────────────────────────────────────

interface TradeStore {
    // Ephemeral (not persisted)
    prices: Record<string, MarketData>;
    alerts: Alert[];

    // Persisted across page refreshes
    priceAlerts: PriceAlert[];
    pendingOrders: PendingOrder[];

    // Actions
    updatePrice: (data: Partial<MarketData> & { symbol: string }) => void;
    addAlert: (alert: Omit<Alert, 'id' | 'timestamp'>) => void;
    removeAlert: (id: string) => void;
    addPriceAlert: (alert: Omit<PriceAlert, 'id' | 'createdAt'>) => void;
    removePriceAlert: (id: string) => void;
    addPendingOrder: (order: Omit<PendingOrder, 'id' | 'createdAt'>) => void;
    removePendingOrder: (id: string) => void;
    updatePendingOrderStatus: (id: string, status: PendingOrder['status']) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────
// Zustand is preferred over Redux/Context for HFT dashboards due to lower overhead.
// persist middleware hydrates priceAlerts and pendingOrders from localStorage on
// mount and keeps them in sync on every mutation.

export const useTradeStore = create<TradeStore>()(
    persist(
        (set) => ({
            prices: {},
            alerts: [],
            priceAlerts: [],
            pendingOrders: [],

            /**
             * Deep-merge incoming partial market data with whatever is already stored
             * for that symbol. This prevents a bbo-only tick from wiping out the last
             * known ohlc bar (and vice-versa) when the backend sends sparse updates.
             */
            updatePrice: (data) =>
                set((state) => {
                    const existing = state.prices[data.symbol];
                    const merged: MarketData = {
                        ...(existing ?? {}),
                        ...data,
                        symbol: data.symbol,
                        price: data.price ?? existing?.price ?? new BigNumber(0),
                        volume: data.volume ?? existing?.volume ?? new BigNumber(0),
                    };
                    return { prices: { ...state.prices, [data.symbol]: merged } };
                }),

            addAlert: (alert) =>
                set((state) => ({
                    alerts: [
                        ...state.alerts,
                        { ...alert, id: crypto.randomUUID(), timestamp: Date.now() },
                    ].slice(-5),
                })),

            removeAlert: (id) =>
                set((state) => ({
                    alerts: state.alerts.filter((a) => a.id !== id),
                })),

            addPriceAlert: (alert) =>
                set((state) => ({
                    priceAlerts: [
                        ...state.priceAlerts,
                        { ...alert, id: crypto.randomUUID(), createdAt: Date.now() },
                    ],
                })),

            removePriceAlert: (id) =>
                set((state) => ({
                    priceAlerts: state.priceAlerts.filter((a) => a.id !== id),
                })),

            addPendingOrder: (order) =>
                set((state) => ({
                    pendingOrders: [
                        ...state.pendingOrders,
                        { ...order, id: crypto.randomUUID(), createdAt: Date.now() },
                    ],
                })),

            removePendingOrder: (id) =>
                set((state) => ({
                    pendingOrders: state.pendingOrders.filter((o) => o.id !== id),
                })),

            updatePendingOrderStatus: (id, status) =>
                set((state) => ({
                    pendingOrders: state.pendingOrders.map((o) =>
                        o.id === id ? { ...o, status } : o,
                    ),
                })),
        }),
        {
            name: 'bull-tech-store',
            storage: createJSONStorage(() => localStorage, { replacer, reviver }),
            // Only persist user-created state. Live market data and ephemeral
            // toast alerts are always re-derived from the WebSocket feed.
            partialize: (state) => ({
                priceAlerts: state.priceAlerts,
                pendingOrders: state.pendingOrders,
            }),
        },
    ),
);
