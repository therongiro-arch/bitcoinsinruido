import { useEffect, useSyncExternalStore } from 'react';
import { useMempoolStream } from './useMempoolStream';
import { lookupEntity } from '../../lib/known-addresses';

// Streams mempool transactions that we can attribute to known entities by
// looking up at least one input or output address in `KNOWN_ADDRESSES`.
// Each attributed transaction emits one or more *spend events* — one per
// input that comes from a known entity. The "destination" of each event
// is the most prominent known output, falling back to the largest output
// even if its address isn't tagged (so a known sender → unknown receiver
// can still produce an arc to *somewhere*).
//
// Detail fetches against mempool.space's public API are throttled hard:
// only the top-N txs per upstream batch get inspected, and identical
// txids are never refetched. This keeps the page well under the public
// rate limits even with many concurrent visitors.

const TX_DETAIL_ENDPOINT = (txid: string) => `https://mempool.space/api/tx/${txid}`;

// How many txs to inspect per upstream poll. Most mempool batches contain
// ~20 txs; inspecting the top 5 by value covers the meaningful flow
// (small txs are almost never institutional) while staying gentle on the
// API.
const DETAILS_PER_BATCH = 5;
const MAX_EVENTS = 80;
const DETAIL_CACHE_MAX = 400;

export interface AttributedSpend {
  txid: string;
  /** Total tx value in BTC (sum of outputs). */
  amountBtc: number;
  /** sat/vB fee rate. */
  feeRate: number;
  /** ms epoch when we attributed the spend. */
  ts: number;
  /** Entity id (matching ACCUMULATION) for the spent input. Always present. */
  fromEntityId: string;
  /** Entity id of the largest known output, or null if no output matched. */
  toEntityId: string | null;
  /** BTC value of the specific input being attributed. */
  inputBtc: number;
}

interface Store {
  events: AttributedSpend[];
  /** How many tx details we have inspected this session. */
  inspected: number;
  /** How many attributed spend events we have emitted. */
  attributed: number;
}

let store: Store = { events: [], inspected: 0, attributed: 0 };
const listeners = new Set<() => void>();
const cachedDetails = new Map<string, true>(); // txids whose details we've fetched
let lastSeenTxId: string | null = null;
let inFlight = 0;

function emit() {
  for (const l of listeners) l();
}

interface RawVin {
  prevout?: { value?: number; scriptpubkey_address?: string };
}
interface RawVout {
  value?: number;
  scriptpubkey_address?: string;
}
interface RawTx {
  txid?: string;
  fee?: number;
  vsize?: number;
  vin?: RawVin[];
  vout?: RawVout[];
}

async function fetchAndAttribute(txid: string): Promise<void> {
  if (cachedDetails.has(txid)) return;
  cachedDetails.set(txid, true);
  inFlight++;
  try {
    const r = await fetch(TX_DETAIL_ENDPOINT(txid), { cache: 'no-store' });
    if (!r.ok) return;
    const tx = (await r.json()) as RawTx;
    if (!tx?.vin || !tx?.vout) return;

    store = { ...store, inspected: store.inspected + 1 };

    // Compute total tx output value (BTC) for context.
    const totalOutSats = tx.vout.reduce((acc, o) => acc + (o.value || 0), 0);
    const amountBtc = totalOutSats / 1e8;
    const feeRate = tx.fee && tx.vsize ? tx.fee / tx.vsize : 0;

    // Find the largest known-entity output to use as destination for any
    // attributed input. Falls back to null (= "unknown destination") if no
    // output matches.
    let largestKnownOut: { entityId: string; value: number } | null = null;
    for (const o of tx.vout) {
      const entityId = lookupEntity(o.scriptpubkey_address);
      if (!entityId) continue;
      if (!largestKnownOut || (o.value || 0) > largestKnownOut.value) {
        largestKnownOut = { entityId, value: o.value || 0 };
      }
    }

    // Walk inputs (= UTXOs being spent). For each input that we can
    // attribute to a known entity, emit one spend event.
    const newEvents: AttributedSpend[] = [];
    const now = Date.now();
    for (const inp of tx.vin) {
      const fromEntityId = lookupEntity(inp.prevout?.scriptpubkey_address);
      if (!fromEntityId) continue;
      // Skip internal moves (same entity to itself). They aren't an
      // interesting flow signal and produce zero-length arcs.
      if (largestKnownOut && largestKnownOut.entityId === fromEntityId) continue;
      newEvents.push({
        txid: tx.txid || txid,
        amountBtc,
        feeRate,
        ts: now,
        fromEntityId,
        toEntityId: largestKnownOut?.entityId ?? null,
        inputBtc: (inp.prevout?.value || 0) / 1e8,
      });
    }

    if (newEvents.length === 0) return;

    const merged = [...store.events, ...newEvents].slice(-MAX_EVENTS);
    store = {
      events: merged,
      inspected: store.inspected,
      attributed: store.attributed + newEvents.length,
    };
    emit();
  } catch {
    /* network blip — swallow, next poll will retry */
  } finally {
    inFlight--;
    // Trim the cache so it doesn't grow without bound.
    if (cachedDetails.size > DETAIL_CACHE_MAX) {
      const keys = Array.from(cachedDetails.keys()).slice(-Math.floor(DETAIL_CACHE_MAX / 2));
      cachedDetails.clear();
      for (const k of keys) cachedDetails.set(k, true);
    }
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot(): Store {
  return store;
}
function getServerSnapshot(): Store {
  return { events: [], inspected: 0, attributed: 0 };
}

/**
 * React hook: returns the latest attributed-spend events plus counters.
 * Internally subscribes to `useMempoolStream` and runs entity attribution
 * on the top-N txs by value of each batch.
 */
export function useAttributedTxStream() {
  const { txs, connected } = useMempoolStream();
  const attributedStore = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Whenever a new batch arrives upstream, fan out detail fetches for the
  // top-N by value. `fetchAndAttribute` is fire-and-forget and dedup'd by
  // `cachedDetails`, so even if strict mode double-invokes the effect we
  // only ever hit the network once per txid.
  useEffect(() => {
    if (!txs.length || typeof window === 'undefined') return;
    let firstNew = 0;
    if (lastSeenTxId) {
      const i = txs.findIndex((t) => t.id === lastSeenTxId);
      if (i >= 0) firstNew = i + 1;
    }
    const unseen = txs.slice(firstNew);
    if (!unseen.length) return;
    lastSeenTxId = txs[txs.length - 1].id;
    const topByValue = [...unseen]
      .sort((a, b) => b.amountBtc - a.amountBtc)
      .slice(0, DETAILS_PER_BATCH);
    for (const t of topByValue) {
      void fetchAndAttribute(t.id);
    }
  }, [txs]);

  return {
    events: attributedStore.events,
    inspected: attributedStore.inspected,
    attributed: attributedStore.attributed,
    mempoolConnected: connected,
    inFlight,
  };
}
