// Single source of truth for live exchange streams used by the globe + ticker.
// All endpoints are public; no API keys required.

export type ExchangeId = 'binance' | 'coinbase' | 'kraken' | 'bitstamp' | 'bitso';

export interface ExchangeConfig {
  id: ExchangeId;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  quote: string;     // quote currency exposed in the UI
  color: string;
}

export interface Trade {
  id: string;
  exchange: ExchangeId;
  exchangeName: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  priceUsd: number;  // approximated to USD (1:1 for USDT/USD, FX-adjusted for MXN)
  priceQuote: number;
  quote: string;
  amountBtc: number;
  side?: 'buy' | 'sell';
  ts: number;        // epoch ms
  color: string;
}

export const EXCHANGES: Record<ExchangeId, ExchangeConfig> = {
  binance: {
    id: 'binance',
    name: 'Binance',
    city: 'Global',
    country: 'Internacional',
    lat: 35.6762,
    lon: 139.6503,
    quote: 'USDT',
    color: '#f3ba2f',
  },
  coinbase: {
    id: 'coinbase',
    name: 'Coinbase',
    city: 'San Francisco',
    country: 'EE.UU.',
    lat: 37.7749,
    lon: -122.4194,
    quote: 'USD',
    color: '#0052ff',
  },
  kraken: {
    id: 'kraken',
    name: 'Kraken',
    city: 'San Francisco',
    country: 'EE.UU.',
    lat: 37.7749,
    lon: -122.4194,
    quote: 'USD',
    color: '#5848d6',
  },
  bitstamp: {
    id: 'bitstamp',
    name: 'Bitstamp',
    city: 'Luxemburgo',
    country: 'UE',
    lat: 49.6116,
    lon: 6.1319,
    quote: 'USD',
    color: '#5dc62d',
  },
  bitso: {
    id: 'bitso',
    name: 'Bitso',
    city: 'CDMX',
    country: 'México',
    lat: 19.4326,
    lon: -99.1332,
    quote: 'MXN',
    color: '#e94e1b',
  },
};

// Light FX cache for converting Bitso MXN prices to USD for display.
// Refreshed by the stream module on first MXN trade and every 10 min.
export interface FxCache {
  mxnPerUsd: number;
  fetchedAt: number;
}

export async function fetchMxnUsdRate(): Promise<number> {
  try {
    const res = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=MXN', {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('FX rate fetch failed');
    const data = (await res.json()) as { rates?: { MXN?: number } };
    const rate = data.rates?.MXN;
    if (typeof rate === 'number' && rate > 0) return rate;
  } catch {
    // ignore — caller keeps last good value
  }
  return 17; // last-resort fallback
}
