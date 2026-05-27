import { useSyncExternalStore } from 'react';

// Lightweight live feed of unconfirmed Bitcoin transactions arriving in the
// public mempool. Polls mempool.space's `/api/mempool/recent` endpoint, which
// returns the 24 most-recent mempool transactions. The endpoint ships with
// `Access-Control-Allow-Origin: *` so we can hit it directly from the browser
// without going through the Worker proxy.
//
// Why polling instead of the websocket? `wss://mempool.space/api/v1/ws` works
// but its message schema for live tx events is undocumented and shifts between
// releases. The REST endpoint is rock solid, gives us all the data we need
// (txid, value, fee, vsize) and 3-second polling produces plenty of fresh
// material — well over what the globe can usefully animate.

const ENDPOINT = 'https://mempool.space/api/mempool/recent';
const POLL_MS = 3000;
const BUFFER = 80;          // total tx history kept in store
const SEEN_MAX = 600;       // hard cap on the dedup set

export interface MempoolTx {
  id: string;
  amountBtc: number;
  feeRate: number; // sat/vB
  ts: number;      // ms epoch when WE saw it (mempool API doesn't include it here)
}

interface Store {
  txs: MempoolTx[];
  connected: boolean;
}

let store: Store = { txs: [], connected: false };
const listeners = new Set<() => void>();
let initialized = false;
const seen = new Set<string>();

function emit() {
  for (const l of listeners) l();
}

function setConnected(v: boolean) {
  if (store.connected === v) return;
  store = { ...store, connected: v };
  emit();
}

async function tick() {
  // Don't burn battery / data when the tab isn't visible.
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  try {
    const r = await fetch(ENDPOINT, { cache: 'no-store' });
    if (!r.ok) {
      setConnected(false);
      return;
    }
    const data = (await r.json()) as Array<{
      txid: string;
      fee: number;
      vsize: number;
      value: number;
    }>;
    if (!Array.isArray(data)) {
      setConnected(false);
      return;
    }

    const fresh: MempoolTx[] = [];
    const now = Date.now();
    for (const t of data) {
      if (!t?.txid || seen.has(t.txid)) continue;
      seen.add(t.txid);
      fresh.push({
        id: t.txid,
        amountBtc: (t.value || 0) / 1e8,
        feeRate: t.fee && t.vsize ? t.fee / t.vsize : 0,
        ts: now,
      });
    }

    // Trim the dedup set so it doesn't grow without bound.
    if (seen.size > SEEN_MAX) {
      const keep = Array.from(seen).slice(-Math.floor(SEEN_MAX / 2));
      seen.clear();
      for (const id of keep) seen.add(id);
    }

    if (fresh.length === 0) {
      setConnected(true);
      return;
    }

    const merged = [...store.txs, ...fresh].slice(-BUFFER);
    store = { txs: merged, connected: true };
    emit();
  } catch {
    setConnected(false);
  }
}

function ensureStarted() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  void tick(); // immediate first hit
  const id = setInterval(() => {
    void tick();
  }, POLL_MS);

  // Re-tick on visibility change so the feed wakes up immediately when
  // the user returns to the tab (instead of waiting for the next interval).
  const onVis = () => {
    if (document.visibilityState === 'visible') void tick();
  };
  document.addEventListener('visibilitychange', onVis);

  window.addEventListener('beforeunload', () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVis);
  });
}

function subscribe(cb: () => void) {
  ensureStarted();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): Store {
  return store;
}
function getServerSnapshot(): Store {
  return { txs: [], connected: false };
}

export function useMempoolStream(): Store {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
