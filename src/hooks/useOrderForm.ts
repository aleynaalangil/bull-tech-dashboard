import { useState } from 'react';
import { useTradeStore } from '../store';

const MAX_ORDER_QTY = 1_000_000;

interface AccountData {
    balance_usdc: string;
    positions: Array<{ symbol: string; quantity: string; avg_buy_price: string }>;
}

export function useOrderForm(side: 'buy' | 'sell', symbol: string) {
    const [qty, setQty] = useState('');
    const prices = useTradeStore((state) => state.prices);

    const validate = (): string | null => {
        const n = Number(qty);
        if (!qty || isNaN(n)) return 'Invalid quantity';
        if (n <= 0) return 'Quantity must be > 0';
        if (n > MAX_ORDER_QTY) return `Max ${MAX_ORDER_QTY.toLocaleString()}`;
        return null;
    };

    const setQuickAmount = (percent: number, account: AccountData | null) => {
        if (side === 'buy') {
            if (!account) return;
            const total = Number(account.balance_usdc);
            const currentPrice = prices[symbol]?.price.toNumber() ?? 0;
            if (currentPrice > 0) {
                setQty(((total * percent) / currentPrice).toFixed(4));
            }
        } else {
            const heldPosition = account?.positions.find((p) => p.symbol === symbol);
            if (heldPosition) {
                const total = Number(heldPosition.quantity);
                setQty((total * percent).toFixed(6));
            }
        }
    };

    const reset = () => setQty('');

    return { qty, setQty, validate, setQuickAmount, reset };
}

export type { AccountData };
export { MAX_ORDER_QTY };
