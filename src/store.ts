import {create} from 'zustand';
import BigNumber from 'bignumber.js';

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

interface TradeStore {
    prices: Record<string, MarketData>;
    alerts: Alert[];
    updatePrice: (data: Partial<MarketData> & { symbol: string }) => void;
    addAlert: (alert: Omit<Alert, 'id' | 'timestamp'>) => void;
    removeAlert: (id: string) => void;
}

// Zustand is preferred over Redux/Context for HFT dashboards due to lower overhead.
export const useTradeStore = create<TradeStore>((set) => ({
    prices: {},
    alerts: [],

    /**
     * Deep-merge incoming partial market data with whatever is already stored
     * for that symbol. This prevents a bbo-only tick from wiping out the last
     * known ohlc bar (and vice-versa) when the backend sends sparse updates.
     */
    updatePrice: (data) =>
        set((state) => {
            const existing = state.prices[data.symbol];
            const merged: MarketData = {
                // Spread existing first so every optional field is preserved
                ...(existing ?? {}),
                // Then overlay only the fields that arrived in this update
                ...data,
                // symbol is always required
                symbol: data.symbol,
                // Required fields must always be present; fall back to previous
                price: data.price ?? existing?.price ?? new BigNumber(0),
                volume: data.volume ?? existing?.volume ?? new BigNumber(0),
            };
            return {
                prices: {
                    ...state.prices,
                    [data.symbol]: merged,
                },
            };
        }),

    addAlert: (alert) =>
        set((state) => ({
            alerts: [
                ...state.alerts,
                {...alert, id: crypto.randomUUID(), timestamp: Date.now()},
            ].slice(-5),
        })),

    removeAlert: (id) =>
        set((state) => ({
            alerts: state.alerts.filter((a) => a.id !== id),
        })),
}));