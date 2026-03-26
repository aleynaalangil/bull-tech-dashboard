import { useEffect, useRef } from 'react';
import { useTradeStore } from './store';
import { authFetch, clearAuth } from './auth';
import { useNavigate } from 'react-router-dom';

/**
 * Watches live prices against user-defined price alerts.
 * When a target is crossed, fires a market order automatically and removes the alert.
 */
export const usePriceAlerts = () => {
    const navigate = useNavigate();
    const prices = useTradeStore((state) => state.prices);
    const priceAlerts = useTradeStore((state) => state.priceAlerts);
    const removePriceAlert = useTradeStore((state) => state.removePriceAlert);
    const addAlert = useTradeStore((state) => state.addAlert);

    // Track in-flight orders so we don't double-fire the same alert
    const firingRef = useRef<Set<string>>(new Set());
    // Serializes execution per-symbol: prevents concurrent API calls for the same symbol.
    const submittingSymbolsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        priceAlerts.forEach((alert) => {
            if (firingRef.current.has(alert.id)) return;
            if (submittingSymbolsRef.current.has(alert.symbol)) return;

            const currentData = prices[alert.symbol];
            if (!currentData) return;

            const price = currentData.price;
            const hit =
                (alert.condition === 'above' && price.gte(alert.targetPrice)) ||
                (alert.condition === 'below' && price.lte(alert.targetPrice));

            if (!hit) return;

            firingRef.current.add(alert.id);
            submittingSymbolsRef.current.add(alert.symbol);

            authFetch('/api/v1/orders', {
                method: 'POST',
                body: JSON.stringify({
                    symbol: alert.symbol,
                    side: alert.side,
                    amount: alert.quantity,
                }),
            })
                .then(async (res) => {
                    if (res.status === 401) {
                        clearAuth();
                        navigate('/login');
                        return;
                    }
                    const data = await res.json();
                    const base = alert.symbol.split('/')[0] ?? alert.symbol;

                    if (data.status === 'filled') {
                        addAlert({
                            message: `Alert filled: ${alert.side.toUpperCase()} ${alert.quantity} ${base} @ ${Number(data.price).toFixed(4)} USDC`,
                            type: 'info',
                        });
                    } else {
                        addAlert({
                            message: `Alert order rejected: ${data.reject_reason ?? 'unknown'}`,
                            type: 'critical',
                        });
                    }
                    removePriceAlert(alert.id);
                })
                .catch((err: unknown) => {
                    console.error(`[usePriceAlerts] Network error for alert ${alert.id} (${alert.condition} ${alert.symbol} @ ${alert.targetPrice}):`, err);
                    addAlert({ message: `Alert order network error`, type: 'critical' });
                    firingRef.current.delete(alert.id); // allow retry on next tick
                })
                .finally(() => {
                    submittingSymbolsRef.current.delete(alert.symbol);
                });
        });
    }, [prices, priceAlerts, addAlert, removePriceAlert, navigate]);
};
