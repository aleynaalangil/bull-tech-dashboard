import { useState } from 'react';
import { useMarketDataStream, WS_URL } from './useMarketDataStream';
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

  return (
    <div className="flex h-full w-full bg-[#0a0a0f]">
      {/* Left Sidebar: Order Book */}
      <div className="w-[320px] shrink-0 flex flex-col border-r border-[#1e1e2e] bg-[#12121a]">
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
        <div className="h-[280px] shrink-0 flex flex-col bg-[#12121a]">
           <TradeInterface symbol={selectedSymbol} />
        </div>
      </div>

      {/* Right Sidebar: Markets / Activity */}
      <div className="w-[280px] shrink-0 border-l border-[#1e1e2e] flex flex-col bg-[#12121a]">
        <div className="px-4 py-3 border-b border-[#1e1e2e]">
          <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Markets</span>
        </div>
        <div className="p-2 flex flex-col gap-1">
          {['SOL/USDC', 'BTC/USDC'].map((symbol) => (
             <div 
               key={symbol}
               onClick={() => setSelectedSymbol(symbol)}
               className={`flex justify-between items-center text-sm py-2 px-2 rounded cursor-pointer transition-colors ${
                 selectedSymbol === symbol ? 'bg-[#1e1e2e]/50' : 'hover:bg-[#1e1e2e]'
               }`}
             >
               <div className="flex items-center gap-2">
                 <span className={`tracking-wide font-bold ${selectedSymbol === symbol ? 'text-white' : 'text-slate-400'}`}>
                   {symbol}
                 </span>
                 {symbol === 'SOL/USDC' && <span className="text-[10px] bg-slate-800 text-slate-400 px-1 py-0.5 rounded font-bold">10x</span>}
               </div>
               <span className={`${(prices[symbol]?.change_24h?.gte(0) ?? true) ? 'text-green-400' : 'text-red-400'} font-mono tracking-tighter`}>
                  {prices[symbol]?.change_24h 
                    ? `${prices[symbol].change_24h!.gt(0) ? '+' : ''}${prices[symbol].change_24h!.toFixed(2)}%` 
                    : '0.00%'}
                </span>
             </div>
          ))}
        </div>
      </div>
    </div>
  );
};
