import { useState } from 'react';
import { useMarketDataStream, WS_URL } from './useMarketDataStream';
import { usePriceAlerts } from './usePriceAlerts';
import { usePendingOrders } from './usePendingOrders';
import { OrderBook } from './components/OrderBook';
import { TradeInterface } from './components/TradeInterface';
import { TopTickerBar } from './components/TopTickerBar';
import { Chart } from './components/Chart';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useTradeStore, type MarketData } from './store';

type MobileTab = 'chart' | 'trade' | 'book' | 'markets';

const MarketsList = ({
  prices,
  selectedSymbol,
  onSelect,
}: {
  prices: Record<string, MarketData | undefined>;
  selectedSymbol: string;
  onSelect: (s: string) => void;
}) => (
  <>
    <div className="px-5 h-12 flex items-center border-b border-[#1e1e2e] bg-[#0d0d12] shrink-0">
      <span className="text-[10px] font-black tracking-[0.2em] text-slate-500 uppercase">Markets</span>
    </div>
    <div className="p-3 flex flex-col gap-1 overflow-y-auto no-scrollbar flex-1">
      {['SOL/USDC', 'BTC/USDC'].map((symbol) => {
        const data = prices[symbol];
        const isUp = (data?.change_24h?.gte(0) ?? true);
        return (
          <div
            key={symbol}
            onClick={() => onSelect(symbol)}
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
  </>
);

export const MarketDashboard = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('SOL/USDC');
  const [mobileTab, setMobileTab] = useState<MobileTab>('chart');
  const prices = useTradeStore((state) => state.prices);

  useMarketDataStream(WS_URL);
  usePriceAlerts();
  usePendingOrders();

  const mobileTabs: { id: MobileTab; label: string }[] = [
    { id: 'chart', label: 'Chart' },
    { id: 'trade', label: 'Trade' },
    { id: 'book', label: 'Book' },
    { id: 'markets', label: 'Markets' },
  ];

  return (
    <>
      {/* ── Desktop layout (md+) — unchanged ─────────────────────────────────── */}
      <div className="hidden md:flex h-full w-full bg-[#0a0a0f]">
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
          <MarketsList prices={prices} selectedSymbol={selectedSymbol} onSelect={setSelectedSymbol} />
        </div>
      </div>

      {/* ── Mobile layout (< md) ─────────────────────────────────────────────── */}
      <div className="flex md:hidden flex-col h-full w-full bg-[#0a0a0f]">
        {/* Active panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {mobileTab === 'chart' && (
            <>
              <TopTickerBar symbol={selectedSymbol} />
              <div className="flex-1 relative bg-[#0a0a0f] overflow-hidden">
                <ErrorBoundary>
                  <Chart symbol={selectedSymbol} />
                </ErrorBoundary>
              </div>
            </>
          )}

          {mobileTab === 'trade' && (
            <div className="flex-1 flex flex-col bg-[#12121a] overflow-hidden">
              <TradeInterface symbol={selectedSymbol} />
            </div>
          )}

          {mobileTab === 'book' && (
            <div className="flex-1 flex flex-col bg-[#12121a] overflow-hidden">
              <OrderBook symbol={selectedSymbol} />
            </div>
          )}

          {mobileTab === 'markets' && (
            <div className="flex-1 flex flex-col bg-[#0d0d12] overflow-hidden">
              <MarketsList prices={prices} selectedSymbol={selectedSymbol} onSelect={(s) => { setSelectedSymbol(s); setMobileTab('chart'); }} />
            </div>
          )}
        </div>

        {/* Bottom tab bar */}
        <div className="h-14 shrink-0 flex items-stretch border-t border-[#1e1e2e] bg-[#0d0d12]">
          {mobileTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMobileTab(tab.id)}
              className={`flex-1 flex items-center justify-center text-[11px] font-bold uppercase tracking-widest transition-colors ${
                mobileTab === tab.id
                  ? 'text-blue-400 bg-blue-500/5 border-t-2 border-blue-500 -mt-px'
                  : 'text-slate-500 border-t-2 border-transparent -mt-px hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};
