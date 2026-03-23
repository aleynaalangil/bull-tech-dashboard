import { create } from 'zustand';

interface MarketData {
  price: number;
  volume: number;
  symbol: string;
}

interface TradeStore {
  prices: Record<string, MarketData>;
  updatePrice: (data: MarketData) => void;
}

// Zustand is preferred over Redux/Context for HFT dashboards due to lower overhead
export const useTradeStore = create<TradeStore>((set) => ({
  prices: {},
  updatePrice: (data) =>
    set((state) => ({
      prices: {
        ...state.prices,
        [data.symbol]: data,
      },
    })),
}));
