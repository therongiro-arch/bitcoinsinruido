// Mapping of well-known Bitcoin addresses to entity IDs from ACCUMULATION.
//
// This file is the data source for the globe's "real transaction" arcs:
// when a mempool transaction has an input or output that matches one of
// these addresses, we know which entity is involved and can draw an arc
// to/from that entity's lat/lng. Without a match, no arc is drawn.
//
// === HOW TO EXTEND ===
//
// Add an entry: { address, entityId } where `entityId` matches one of the
// `id` values in `src/lib/accumulation.ts` (e.g. 'coinbase', 'binance',
// 'us-gov', 'mstr', 'sv-gov').
//
// Always cite the source of attribution in a `// source:` comment above
// the entry so future maintainers can re-verify. Wrong attribution will
// produce wrong arcs.
//
// === SUGGESTED VERIFICATION SOURCES ===
//
// - Arkham Intelligence — https://arkhamintelligence.com/
// - WalletExplorer  — https://www.walletexplorer.com/
// - OXT Research    — https://oxt.me/
// - SEC filings & press releases (institutional treasuries)
// - On-chain analysts publishing labelled clusters (Glassnode, CryptoQuant)
//
// === SEED LIST ===
//
// The entries below are sourced from publicly-cited on-chain analyses.
// They are STARTING POINTS — verify each one against an authoritative
// source before deploying. Exchange hot wallets rotate frequently; an
// address that was canonical 12 months ago may no longer be active.

export interface KnownAddress {
  address: string;
  entityId: string;
}

export const KNOWN_ADDRESSES: KnownAddress[] = [
  // === US Government — Bitfinex 2016 hack seizure ===
  // source: U.S. DOJ press release 2022-02-08, court filings 1:22-mj-00022 (DDC).
  // Custody address widely cited as holding part of the ~94 643 BTC seizure.
  { address: 'bc1qa5wkgaew2dkv56kfvj49j0av5nml45x9ek9hz6', entityId: 'us-gov' },

  // === Bitfinex — multisig cold storage ===
  // source: on-chain analysis since 2020; address widely associated with
  // Bitfinex's cold custody cluster.
  { address: 'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97', entityId: 'bitfinex' },

  // === Binance — historical hot wallet ===
  // source: WalletExplorer cluster "Binance.com" (verify if still active).
  { address: '3FaA4dJuuvJEKBhRyMSXJSXKwsi5N6pZJU', entityId: 'binance' },

  // === Coinbase — historical cold wallet ===
  // source: on-chain analysts have flagged this address as part of the
  // Coinbase Custody cluster (verify if still active).
  { address: '1FzwLi8MwXKfWuhCusrvajRRkAdmqLDmoq', entityId: 'coinbase' },

  // ── Add more verified addresses here. Suggested next entries:
  //    - Kraken hot/cold wallets
  //    - Bitstamp cold wallet
  //    - El Salvador Chivo treasury
  //    - MicroStrategy custody addresses
  //    - Marathon Digital mining payout cluster
  //    - China PlusToken seizure cluster
];

// O(1) lookup by address. Built once at module load.
const ADDRESS_MAP = new Map<string, string>(
  KNOWN_ADDRESSES.map((k) => [k.address, k.entityId]),
);

/** Resolve a Bitcoin address to its entity ID, or undefined if unknown. */
export function lookupEntity(address: string | null | undefined): string | undefined {
  if (!address) return undefined;
  return ADDRESS_MAP.get(address);
}

/** Number of attributed addresses currently in the database. */
export function knownAddressCount(): number {
  return ADDRESS_MAP.size;
}
