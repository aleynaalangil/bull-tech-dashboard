import { useEffect, useRef } from 'react';
import { useTradeStore } from './store';
import { authFetch, clearAuth } from './auth';
import { useNavigate } from 'react-router-dom';

/**
 * Monitors live prices against resting limit and stop-limit orders stored in
 * Zustand (and persisted to localStorage).
 *
 * Limit order execution:
 *   buy  → fires when currentPrice <= limitPrice
 *   sell → fires when currentPrice >= limitPrice
 *
 * Stop-limit execution (two phases):
 *   Phase 1 — status 'waiting': watch for stopPrice to be crossed
 *     buy  stop-limit: currentPrice >= stopPrice triggers phase 2
 *     sell stop-limit: currentPrice <= stopPrice triggers phase 2
 *   Phase 2 — status 'triggered': behaves like a plain limit order on limitPrice
 *
 * When execution fires the hook submits a market order to the exchange API (the
 * backend only accepts market orders; limit behaviour is enforced client-side).
 */
export const usePendingOrders = () => {
    const navigate = useNavigate();
    const prices = useTradeStore((state) => state.prices);
    const pendingOrders = useTradeStore((state) => state.pendingOrders);
    const removePendingOrder = useTradeStore((state) => state.removePendingOrder);
    const updatePendingOrderStatus = useTradeStore((state) => state.updatePendingOrderStatus);
    const addAlert = useTradeStore((state) => state.addAlert);

    // Tracks orders currently being submitted so we never double-fire.
    const firingRef = useRef<Set<string>>(new Set());
    // Serializes execution per-symbol: prevents concurrent API calls for the same symbol.
    const submittingSymbolsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        pendingOrders.forEach((order) => {
            if (firingRef.current.has(order.id)) return;
            if (submittingSymbolsRef.current.has(order.symbol)) return;

            const currentData = prices[order.symbol];
            if (!currentData) return;
            const price = currentData.price;

            // ── Phase 1: stop-limit waiting for its trigger ───────────────
            if (order.type === 'stop-limit' && order.status === 'waiting' && order.stopPrice) {
                const stopHit =
                    (order.side === 'buy'  && price.gte(order.stopPrice)) ||
                    (order.side === 'sell' && price.lte(order.stopPrice));

                if (stopHit) updatePendingOrderStatus(order.id, 'triggered');
                // Don't evaluate limit in the same tick; let the next render do it.
                return;
            }

            // ── Phase 2 (or plain limit): check limit price ───────────────
            const limitHit =
                (order.side === 'buy'  && price.lte(order.limitPrice)) ||
                (order.side === 'sell' && price.gte(order.limitPrice));

            if (!limitHit) return;

            firingRef.current.add(order.id);
            submittingSymbolsRef.current.add(order.symbol);

            const base      = order.symbol.split('/')[0] ?? order.symbol;
            const typeLabel = order.type === 'stop-limit' ? 'Stop-Limit' : 'Limit';

            authFetch('/api/v1/orders', {
                method: 'POST',
                body: JSON.stringify({
                    symbol:     order.symbol,
                    side:       order.side,
                    amount:     order.quantity,
                    order_type: order.type === 'stop-limit' ? 'stop_limit' : 'limit',
                }),
            })
                .then(async (res) => {
                    if (res.status === 401) { clearAuth(); navigate('/login'); return; }
                    const data = await res.json();

                    if (data.status === 'filled') {
                        addAlert({
                            message: `${typeLabel} filled: ${order.side.toUpperCase()} ${order.quantity} ${base} @ ${Number(data.price).toFixed(4)} USDC`,
                            type: 'info',
                        });
                    } else {
                        addAlert({
                            message: `${typeLabel} rejected: ${data.reject_reason ?? 'unknown'}`,
                            type: 'critical',
                        });
                    }
                    removePendingOrder(order.id);
                })
                .catch((err: unknown) => {
                    console.error(`[usePendingOrders] Network error for order ${order.id} (${order.type} ${order.side} ${order.symbol}):`, err);
                    addAlert({ message: `Order network error — will retry`, type: 'critical' });
                    firingRef.current.delete(order.id); // allow retry on next tick
                })
                .finally(() => {
                    submittingSymbolsRef.current.delete(order.symbol);
                });
        });
    }, [prices, pendingOrders, addAlert, removePendingOrder, updatePendingOrderStatus, navigate]);
};
