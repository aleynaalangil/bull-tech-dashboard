import { useState } from 'react';
import { useMarketDataStream, WS_URL } from './useMarketDataStream';
import { usePriceAlerts } from './usePriceAlerts';
import { usePendingOrders } from './usePendingOrders';
import { OrderBook } from './components/OrderBook';
import { TradeInterface } from './components/TradeInterface';
import { TopTickerBar } from './components/TopTickerBar';
import { Chart } from './components/Chart';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useTradeStore } from './store';

export const MarketDashboard = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('SOL/USDC');
  const prices = useTradeStore((state) => state.prices);

  useMarketDataStream(WS_URL);
  usePriceAlerts();
  usePendingOrders();

  return (
    <div className="flex h-full w-full bg-[#0a0a0f]">
      {/* Left Sidebar: Order Book */}
      <div className="w-[290px] shrink-0 flex flex-col border-r border-[#1e1e2e] bg-[#12121a]">
        <OrderBook symbol={selectedSymbol} />
      </div>

      {/* Center Column: Chart & Trade Execution */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Ticker Bar */}
        <TopTickerBar symbol={selectedSymbol} />

        {/* Chart Area */}
        <div className="flex-1 border-b border-[#1e1e2e] relative bg-[#0a0a0f] overflow-hidden">
          <ErrorBoundary>
            <Chart symbol={selectedSymbol} />
          </ErrorBoundary>
        </div>

        {/* Trade Execution */}
        <div className="h-[320px] shrink-0 flex flex-col bg-[#12121a]">
          <TradeInterface symbol={selectedSymbol} />
        </div>
      </div>

      {/* Right Sidebar: Markets / Activity */}
      <div className="w-[300px] shrink-0 border-l border-[#1e1e2e] flex flex-col bg-[#0d0d12]">
        <div className="px-5 h-12 flex items-center border-b border-[#1e1e2e] bg-[#0d0d12]">
          <span className="text-[10px] font-black tracking-[0.2em] text-slate-500 uppercase">Markets</span>
        </div>

        <div className="p-3 flex flex-col gap-1 overflow-y-auto no-scrollbar">
          {['SOL/USDC', 'BTC/USDC'].map((symbol) => {
            const data = prices[symbol];
            const isUp = (data?.change_24h?.gte(0) ?? true);

            return (
              <div
                key={symbol}
                onClick={() => setSelectedSymbol(symbol)}
                className={`market-item ${selectedSymbol === symbol ? 'active' : ''}`}
              >
                <div className="flex flex-col">
                  <span className={`market-symbol-text ${selectedSymbol === symbol ? 'text-blue-400' : 'text-slate-200'}`}>
                    {symbol}
                  </span>
                  <span className="text-[9px] font-bold text-slate-600 uppercase tracking-tighter">Spot</span>
                </div>

                <div className="market-price-text text-slate-300">
                  {data?.price ? data.price.toFormat(2) : '—'}
                </div>

                <div className={`market-change-badge ${isUp ? 'up' : 'down'}`}>
                  {data?.change_24h
                    ? `${isUp ? '+' : ''}${data.change_24h.toFixed(2)}%`
                    : '0.00%'}
                </div>
              </div>
            );
          })}
        </div>

        {/* <div className="mt-auto border-t border-[#1e1e2e] p-4 bg-blue-500/5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold text-slate-500 uppercase">System Status</span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"></div>
              <span className="text-[10px] font-bold text-green-500 uppercase">Optimal</span>
            </div>
          </div> */}
        {/* <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/5 rounded p-2 border border-white/5">
              <div className="text-[8px] text-slate-500 font-bold uppercase mb-1">Network</div>
              <div className="text-[10px] text-slate-300 font-mono">Mainnet-Beta</div>
            </div>
            <div className="bg-white/5 rounded p-2 border border-white/5">
              <div className="text-[8px] text-slate-500 font-bold uppercase mb-1">API Tier</div>
              <div className="text-[10px] text-blue-400 font-mono">Enterprise</div>
            </div>
          </div> */}
        {/* </div> */}
      </div>
    </div>
  );
};
