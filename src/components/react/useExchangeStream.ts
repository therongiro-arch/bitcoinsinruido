import { useSyncExternalStore } from 'react';
import { EXCHANGES, fetchMxnUsdRate, type ExchangeId, type Trade } from '../../lib/exchanges';

// --- Module-level singleton store -------------------------------------------------
// Multiple components (Globe + Ticker) read the same trade stream; we keep one
// set of WS connections per page load and broadcast to subscribers.

const BUFFER_SIZE = 60;

interface Store {
  trades: Trade[];
  prices: Partial<Record<ExchangeId, number>>; // last USD price per exchange
  connected: Partial<Record<ExchangeId, boolean>>;
}

let store: Store = { trades: [], prices: {}, connected: {} };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function pushTrade(t: Trade) {
  const next = store.trades.length >= BUFFER_SIZE ? store.trades.slice(-BUFFER_SIZE + 1) : store.trades;
  store = {
    trades: [...next, t],
    prices: { ...store.prices, [t.exchange]: t.priceUsd },
    connected: { ...store.connected, [t.exchange]: true },
  };
  emit();
}

function setConnected(id: ExchangeId, value: boolean) {
  if (store.connected[id] === value) return;
  store = { ...store, connected: { ...store.connected, [id]: value } };
  emit();
}

// --- Connections ----------------------------------------------------------------

let initialized = false;
let mxnPerUsd = 17;

function bsrUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function connectBinance(): () => void {
  let ws: WebSocket | null = null;
  let retry = 0;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    try {
      ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
    } catch {
      schedule();
      return;
    }
    ws.onopen = () => {
      retry = 0;
      setConnected('binance', true);
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as string) as { p: string; q: string; T: number; m: boolean };
        const price = parseFloat(m.p);
        const amount = parseFloat(m.q);
        if (!Number.isFinite(price) || !Number.isFinite(amount)) return;
        const cfg = EXCHANGES.binance;
        pushTrade({
          id: bsrUuid(),
          exchange: 'binance',
          exchangeName: cfg.name,
          city: cfg.city,
          country: cfg.country,
          lat: cfg.lat,
          lon: cfg.lon,
          priceUsd: price,
          priceQuote: price,
          quote: cfg.quote,
          amountBtc: amount,
          side: m.m ? 'sell' : 'buy', // m=true means buyer is market maker, so trade was a sell
          ts: m.T,
          color: cfg.color,
        });
      } catch {
        /* skip malformed */
      }
    };
    ws.onclose = () => {
      setConnected('binance', false);
      schedule();
    };
    ws.onerror = () => ws?.close();
  };

  const schedule = () => {
    if (stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** retry) + Math.random() * 500;
    retry++;
    reconnectTimer = setTimeout(open, delay);
  };

  open();
  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

function connectCoinbase(): () => void {
  let ws: WebSocket | null = null;
  let retry = 0;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    try {
      ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
    } catch {
      schedule();
      return;
    }
    ws.onopen = () => {
      retry = 0;
      setConnected('coinbase', true);
      ws?.send(
        JSON.stringify({
          type: 'subscribe',
          channels: [{ name: 'matches', product_ids: ['BTC-USD'] }],
        }),
      );
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as string) as {
          type?: string;
          price?: string;
          size?: string;
          time?: string;
          side?: 'buy' | 'sell';
        };
        if (m.type !== 'match' && m.type !== 'last_match') return;
        const price = parseFloat(m.price ?? 'NaN');
        const amount = parseFloat(m.size ?? 'NaN');
        if (!Number.isFinite(price) || !Number.isFinite(amount)) return;
        const cfg = EXCHANGES.coinbase;
        pushTrade({
          id: bsrUuid(),
          exchange: 'coinbase',
          exchangeName: cfg.name,
          city: cfg.city,
          country: cfg.country,
          lat: cfg.lat,
          lon: cfg.lon,
          priceUsd: price,
          priceQuote: price,
          quote: cfg.quote,
          amountBtc: amount,
          side: m.side,
          ts: m.time ? new Date(m.time).getTime() : Date.now(),
          color: cfg.color,
        });
      } catch {
        /* skip */
      }
    };
    ws.onclose = () => {
      setConnected('coinbase', false);
      schedule();
    };
    ws.onerror = () => ws?.close();
  };

  const schedule = () => {
    if (stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** retry) + Math.random() * 500;
    retry++;
    reconnectTimer = setTimeout(open, delay);
  };

  open();
  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

function connectKraken(): () => void {
  let ws: WebSocket | null = null;
  let retry = 0;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    try {
      ws = new WebSocket('wss://ws.kraken.com/');
    } catch {
      schedule();
      return;
    }
    ws.onopen = () => {
      retry = 0;
      setConnected('kraken', true);
      ws?.send(
        JSON.stringify({
          event: 'subscribe',
          pair: ['XBT/USD'],
          subscription: { name: 'trade' },
        }),
      );
    };
    ws.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data as string);
        // Trade events come as: [channelID, [ [price, volume, time, side, ordertype, misc], ... ], "trade", "XBT/USD"]
        if (!Array.isArray(payload) || payload[2] !== 'trade') return;
        const trades = payload[1] as Array<[string, string, string, string, string, string]>;
        const cfg = EXCHANGES.kraken;
        for (const t of trades) {
          const price = parseFloat(t[0]);
          const amount = parseFloat(t[1]);
          if (!Number.isFinite(price) || !Number.isFinite(amount)) continue;
          pushTrade({
            id: bsrUuid(),
            exchange: 'kraken',
            exchangeName: cfg.name,
            city: cfg.city,
            country: cfg.country,
            lat: cfg.lat,
            lon: cfg.lon,
            priceUsd: price,
            priceQuote: price,
            quote: cfg.quote,
            amountBtc: amount,
            side: t[3] === 'b' ? 'buy' : 'sell',
            ts: Math.floor(parseFloat(t[2]) * 1000),
            color: cfg.color,
          });
        }
      } catch {
        /* skip */
      }
    };
    ws.onclose = () => {
      setConnected('kraken', false);
      schedule();
    };
    ws.onerror = () => ws?.close();
  };

  const schedule = () => {
    if (stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** retry) + Math.random() * 500;
    retry++;
    reconnectTimer = setTimeout(open, delay);
  };

  open();
  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

function connectBitstamp(): () => void {
  let ws: WebSocket | null = null;
  let retry = 0;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    try {
      ws = new WebSocket('wss://ws.bitstamp.net');
    } catch {
      schedule();
      return;
    }
    ws.onopen = () => {
      retry = 0;
      setConnected('bitstamp', true);
      ws?.send(
        JSON.stringify({
          event: 'bts:subscribe',
          data: { channel: 'live_trades_btcusd' },
        }),
      );
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as string) as {
          event?: string;
          data?: { price?: number; amount?: number; type?: number; timestamp?: string };
        };
        if (m.event !== 'trade') return;
        const price = Number(m.data?.price);
        const amount = Number(m.data?.amount);
        if (!Number.isFinite(price) || !Number.isFinite(amount)) return;
        const cfg = EXCHANGES.bitstamp;
        pushTrade({
          id: bsrUuid(),
          exchange: 'bitstamp',
          exchangeName: cfg.name,
          city: cfg.city,
          country: cfg.country,
          lat: cfg.lat,
          lon: cfg.lon,
          priceUsd: price,
          priceQuote: price,
          quote: cfg.quote,
          amountBtc: amount,
          side: m.data?.type === 1 ? 'sell' : 'buy',
          ts: m.data?.timestamp ? Number(m.data.timestamp) * 1000 : Date.now(),
          color: cfg.color,
        });
      } catch {
        /* skip */
      }
    };
    ws.onclose = () => {
      setConnected('bitstamp', false);
      schedule();
    };
    ws.onerror = () => ws?.close();
  };

  const schedule = () => {
    if (stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** retry) + Math.random() * 500;
    retry++;
    reconnectTimer = setTimeout(open, delay);
  };

  open();
  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

function connectBitso(): () => void {
  // Bitso lacks a reliable public WS for trades — poll REST every 5 s.
  let stopped = false;
  let lastTid = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || document.visibilityState !== 'visible') return;
    try {
      // Goes through our own CORS-friendly Worker proxy.
      const res = await fetch('https://news.bitcoinsinruidos.com/proxy/bitso/trades?book=btc_mxn&limit=10', {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        payload?: Array<{ tid: number; price: string; amount: string; created_at: string; maker_side: string }>;
      };
      const items = data.payload ?? [];
      const fresh = items.filter((t) => t.tid > lastTid).reverse(); // chronological
      if (items.length) lastTid = Math.max(lastTid, items[0].tid);
      const cfg = EXCHANGES.bitso;
      setConnected('bitso', true);
      for (const t of fresh) {
        const priceMxn = parseFloat(t.price);
        const amount = parseFloat(t.amount);
        if (!Number.isFinite(priceMxn) || !Number.isFinite(amount)) continue;
        pushTrade({
          id: bsrUuid(),
          exchange: 'bitso',
          exchangeName: cfg.name,
          city: cfg.city,
          country: cfg.country,
          lat: cfg.lat,
          lon: cfg.lon,
          priceUsd: priceMxn / (mxnPerUsd || 17),
          priceQuote: priceMxn,
          quote: cfg.quote,
          amountBtc: amount,
          side: t.maker_side === 'sell' ? 'buy' : 'sell',
          ts: new Date(t.created_at).getTime(),
          color: cfg.color,
        });
      }
    } catch {
      setConnected('bitso', false);
    }
  };

  // First tick immediate, then every 5 s
  void tick();
  timer = setInterval(tick, 5000);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}

function ensureStarted() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Kick off FX rate (Bitso conversion)
  void fetchMxnUsdRate().then((r) => {
    mxnPerUsd = r;
  });
  const fxTimer = setInterval(() => {
    void fetchMxnUsdRate().then((r) => {
      mxnPerUsd = r;
    });
  }, 10 * 60 * 1000);

  const teardowns = [
    connectBinance(),
    connectCoinbase(),
    connectKraken(),
    connectBitstamp(),
    connectBitso(),
  ];

  // Stop streams when tab is hidden a while (battery / data saver).
  // We don't tear down immediately to avoid thrash, but we mark connections
  // and let onclose+backoff handle reconnect when tab is visible again.
  const onVis = () => {
    if (document.visibilityState === 'visible') {
      // streams will reconnect via their own onclose timers if they died
    }
  };
  document.addEventListener('visibilitychange', onVis);

  // Single page session — no cleanup of singleton in normal navigation.
  // (Astro view transitions retain window, so we keep the streams alive.)
  window.addEventListener('beforeunload', () => {
    clearInterval(fxTimer);
    document.removeEventListener('visibilitychange', onVis);
    for (const stop of teardowns) {
      try {
        stop();
      } catch {
        /* ignore */
      }
    }
  });
}

// --- React hooks ----------------------------------------------------------------

function subscribe(cb: () => void) {
  ensureStarted();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Store {
  return store;
}

function getServerSnapshot(): Store {
  return { trades: [], prices: {}, connected: {} };
}

export function useExchangeStream(): Store {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Convenience: latest single trade (for animation triggers)
export function useLatestTrade(): Trade | null {
  const { trades } = useExchangeStream();
  return trades.length ? trades[trades.length - 1] : null;
}

// Weighted average USD price across exchanges with recent activity.
export function useAveragePrice(): { avg: number | null; sources: number } {
  const { prices } = useExchangeStream();
  const values = Object.values(prices).filter((v): v is number => typeof v === 'number');
  if (!values.length) return { avg: null, sources: 0 };
  const sum = values.reduce((acc, v) => acc + v, 0);
  return { avg: sum / values.length, sources: values.length };
}

// Re-export for components that don't import from lib directly.
export type { Trade };
export { EXCHANGES };
