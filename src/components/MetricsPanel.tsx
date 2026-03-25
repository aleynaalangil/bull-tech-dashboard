import { useTradeStore } from '../store';

export const MetricsPanel = ({ symbol }: { symbol: string }) => {
  const data = useTradeStore((state) => state.prices[symbol]);

  if (!data || !data.telemetry) return null;

  const { latency, throughput_tps, error_rate } = data.telemetry;

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      <div className="bg-[#16161f] p-4 rounded-xl border border-[#1e1e2e] flex flex-col">
        <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-1">Latency</span>
        <span className={`text-xl font-bold tabular-nums ${latency.toNumber() > 50 ? 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.3)]' : 'text-green-400'}`}>
          {latency.toFixed(2)} ms
        </span>
      </div>
      <div className="bg-[#16161f] p-4 rounded-xl border border-[#1e1e2e] flex flex-col">
        <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-1">Throughput</span>
        <span className="text-xl font-bold tabular-nums text-blue-400">
          {throughput_tps.toNumber().toLocaleString()} TPS
        </span>
      </div>
      <div className="bg-[#16161f] p-4 rounded-xl border border-[#1e1e2e] flex flex-col">
        <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-1">Error Rate</span>
        <span className="text-xl font-bold tabular-nums text-purple-400">
          {error_rate.multipliedBy(100).toFixed(3)}%
        </span>
      </div>
    </div>
  );
};
