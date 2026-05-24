import { useEffect, useState } from 'react';
import { useExchangeStream, useAveragePrice, EXCHANGES } from './useExchangeStream';

function formatUsd(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function PriceTicker() {
  const { prices, connected } = useExchangeStream();
  const { avg, sources } = useAveragePrice();
  const [pulse, setPulse] = useState(0);

  // Pulse the average when it changes (visual heartbeat).
  useEffect(() => {
    setPulse((p) => p + 1);
  }, [avg]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 sm:gap-6 items-center p-4 sm:p-5 rounded-xl border border-line bg-bg-card/60 backdrop-blur">
      <div>
        <div className="text-[10px] uppercase tracking-wider font-mono text-ink-dim">
          BTC · promedio en vivo ({sources}/{Object.keys(EXCHANGES).length})
        </div>
        <div
          key={pulse}
          className="font-mono text-3xl sm:text-4xl font-semibold text-ink leading-none mt-1 animate-fade-in"
        >
          {formatUsd(avg)}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
        {Object.values(EXCHANGES).map((e) => {
          const p = prices[e.id];
          const isConnected = connected[e.id];
          return (
            <div key={e.id} className="flex items-center gap-1.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-btc' : 'bg-ink-dim/60'}`}
                aria-hidden="true"
              />
              <span className="text-ink-dim w-16 sm:w-20 truncate">{e.name}</span>
              <span className="text-ink-muted tabular-nums">{p ? formatUsd(p) : '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
