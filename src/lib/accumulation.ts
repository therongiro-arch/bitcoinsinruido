// Curated list of the largest known Bitcoin accumulation points worldwide.
//
// Sources (publicly verifiable):
// - On-chain analysis from Arkham Intelligence, Glassnode, CryptoQuant for
//   exchange cold-wallet balances.
// - BitcoinTreasuries.net for public-company and government holdings.
// - Official news / press releases (US DOJ seizures, El Salvador public
//   wallet, Bhutan disclosure).
//
// Figures are approximate snapshots updated quarterly. Visually each point
// is sized by sqrt(amount) so order-of-magnitude differences are legible
// without dwarfing smaller holders.
//
// Last review: 2026-Q2.

import type { ExchangeId } from './exchanges';

export type AccumulationCategory = 'exchange' | 'government' | 'company';

export interface AccumulationPoint {
  id: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  btc: number;
  category: AccumulationCategory;
  /** When a live trade comes from this exchange, pulse this point. */
  matchExchange?: ExchangeId;
}

export const CATEGORY_COLOR: Record<AccumulationCategory, string> = {
  exchange: '#f7931a',   // Bitcoin orange
  government: '#3b82f6', // blue
  company: '#10b981',    // green
};

export const CATEGORY_LABEL: Record<AccumulationCategory, string> = {
  exchange: 'Exchange',
  government: 'Gobierno',
  company: 'Empresa',
};

export const ACCUMULATION: AccumulationPoint[] = [
  // === Exchange cold wallets ===
  { id: 'coinbase', name: 'Coinbase Custody', city: 'San Francisco', country: 'EE.UU.', lat: 37.7749, lng: -122.4194, btc: 1_000_000, category: 'exchange', matchExchange: 'coinbase' },
  { id: 'binance', name: 'Binance', city: 'BVI / Global', country: 'Internacional', lat: 18.4208, lng: -64.6403, btc: 580_000, category: 'exchange', matchExchange: 'binance' },
  { id: 'bitfinex', name: 'Bitfinex', city: 'Hong Kong', country: 'HK', lat: 22.3193, lng: 114.1694, btc: 380_000, category: 'exchange' },
  { id: 'kraken', name: 'Kraken', city: 'San Francisco', country: 'EE.UU.', lat: 37.78, lng: -122.50, btc: 220_000, category: 'exchange', matchExchange: 'kraken' },
  { id: 'okx', name: 'OKX', city: 'Seychelles', country: 'Seychelles', lat: -4.6796, lng: 55.4920, btc: 200_000, category: 'exchange' },
  { id: 'gemini', name: 'Gemini', city: 'Nueva York', country: 'EE.UU.', lat: 40.7128, lng: -74.0060, btc: 90_000, category: 'exchange' },
  { id: 'bitstamp', name: 'Bitstamp', city: 'Luxemburgo', country: 'UE', lat: 49.6116, lng: 6.1319, btc: 30_000, category: 'exchange', matchExchange: 'bitstamp' },
  { id: 'bitso', name: 'Bitso', city: 'CDMX', country: 'México', lat: 19.4326, lng: -99.1332, btc: 3_500, category: 'exchange', matchExchange: 'bitso' },

  // === Government holdings ===
  { id: 'us-gov', name: 'EE.UU. (incautaciones DOJ)', city: 'Washington D.C.', country: 'EE.UU.', lat: 38.9072, lng: -77.0369, btc: 198_000, category: 'government' },
  { id: 'cn-gov', name: 'China (reportado, PlusToken)', city: 'Beijing', country: 'China', lat: 39.9042, lng: 116.4074, btc: 190_000, category: 'government' },
  { id: 'uk-gov', name: 'Reino Unido', city: 'Londres', country: 'Reino Unido', lat: 51.5074, lng: -0.1278, btc: 61_000, category: 'government' },
  { id: 'bt-gov', name: 'Bután (mineria estatal)', city: 'Thimphu', country: 'Bután', lat: 27.4728, lng: 89.6390, btc: 13_500, category: 'government' },
  { id: 'sv-gov', name: 'El Salvador', city: 'San Salvador', country: 'El Salvador', lat: 13.6929, lng: -89.2182, btc: 6_240, category: 'government' },

  // === Public companies (treasury holdings) ===
  { id: 'mstr', name: 'MicroStrategy', city: 'Tysons Corner', country: 'EE.UU.', lat: 38.9189, lng: -77.2231, btc: 471_000, category: 'company' },
  { id: 'mara', name: 'Marathon Digital', city: 'Fort Lauderdale', country: 'EE.UU.', lat: 26.1224, lng: -80.1373, btc: 26_200, category: 'company' },
  { id: 'tsla', name: 'Tesla', city: 'Austin', country: 'EE.UU.', lat: 30.2672, lng: -97.7431, btc: 9_720, category: 'company' },
  { id: 'sq', name: 'Block (Square)', city: 'San Francisco', country: 'EE.UU.', lat: 37.78, lng: -122.43, btc: 8_584, category: 'company' },
  { id: 'metaplanet', name: 'Metaplanet', city: 'Tokio', country: 'Japón', lat: 35.6762, lng: 139.6503, btc: 1_761, category: 'company' },
];

export const TOTAL_TRACKED_BTC = ACCUMULATION.reduce((s, p) => s + p.btc, 0);

/**
 * Globe-radius units. Scales sqrt(btc) so the largest holder is ~3x the
 * smallest tracked one rather than 1000x.
 */
export function sizeForBtc(btc: number): number {
  const minSize = 0.4;
  const maxSize = 1.8;
  const ref = Math.sqrt(1_000_000); // Coinbase Custody as the upper bound
  const normalized = Math.sqrt(Math.max(btc, 100)) / ref;
  return minSize + (maxSize - minSize) * Math.min(1, normalized);
}
