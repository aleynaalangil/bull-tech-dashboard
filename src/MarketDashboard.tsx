import React from 'react';
import { useTradeStore } from './store';
import { useMarketDataStream } from './useMarketDataStream';

// Memoized to ensure only the changing price updates in the DOM
const PriceRow = React.memo(({ symbol }: { symbol: string }) => {
  const data = useTradeStore((state) => state.prices[symbol]);

  if (!data) return <div className="price-row loading">Loading {symbol}...</div>;

  return (
    <div className="price-row">
      <span className="symbol">{symbol}</span>
      <span className={data.price > 0 ? 'price up' : 'price down'}>
        {data.price.toFixed(2)}
      </span>
      <span className="volume">{data.volume} vol</span>
    </div>
  );
});

export const MarketDashboard = () => {
  useMarketDataStream('ws://localhost:8080/v1/feed'); // Custom Hook

  return (
    <div className="dashboard">
      <h2 className="dashboard-title">Live Market Data</h2>
      <div className="price-header">
        <span>Symbol</span>
        <span>Price</span>
        <span>Volume</span>
      </div>
      <PriceRow symbol="SOL/USDC" />
      <PriceRow symbol="BTC/USDC" />
    </div>
  );
};
