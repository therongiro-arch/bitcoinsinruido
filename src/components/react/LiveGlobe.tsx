import { useEffect, useMemo, useRef, useState } from 'react';
import { useExchangeStream } from './useExchangeStream';
import type { Trade } from '../../lib/exchanges';
import {
  ACCUMULATION,
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  TOTAL_TRACKED_BTC,
  sizeForBtc,
  type AccumulationPoint,
} from '../../lib/accumulation';

const loadGlobe = () => import('react-globe.gl').then((m) => m.default);

const MIN_BTC = 1; // Only purchases of >= 1 BTC trigger the live overlay
const RING_DURATION_MS = 3000;
const PULSE_MS = 3500;
const FOCUS_HOLD_MS = 3800; // pause auto-rotation while a big purchase is highlighted
const MAX_RINGS = 12;
const AUTO_ROTATE_SPEED = 0.35;
const POV_TRANSITION_MS = 1100;

interface Ring {
  lat: number;
  lng: number;
  color: string;
  ts: number;
  label: string;
}

interface DisplayPoint extends AccumulationPoint {
  pulsing: boolean;
  color: string;
  size: number;
}

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function formatBtc(btc: number): string {
  if (btc >= 1_000_000) return `${(btc / 1_000_000).toFixed(2)} M ₿`;
  if (btc >= 1_000) return `${Math.round(btc / 1_000)} K ₿`;
  return `${btc.toLocaleString('es-ES')} ₿`;
}

export default function LiveGlobe() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<any>(null);
  const [GlobeCmp, setGlobeCmp] = useState<React.ComponentType<any> | null>(null);
  const [size, setSize] = useState({ w: 480, h: 480 });
  const [rings, setRings] = useState<Ring[]>([]);
  const [pulsing, setPulsing] = useState<Record<string, number>>({});
  const [lastBigBuy, setLastBigBuy] = useState<Trade | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenTsRef = useRef<number>(0);
  const { trades, connected } = useExchangeStream();
  const reduced = useMemo(reducedMotion, []);

  // Load the globe component on first mount.
  useEffect(() => {
    let alive = true;
    void loadGlobe().then((Cmp) => {
      if (alive) setGlobeCmp(() => Cmp as unknown as React.ComponentType<any>);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Responsive sizing.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(280, Math.min(600, entry.contentRect.width));
        setSize({ w, h: w });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Enable auto-rotation once the globe is mounted.
  useEffect(() => {
    if (!GlobeCmp || !globeRef.current) return;
    const controls = globeRef.current.controls?.();
    if (!controls) return;
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
    controls.enableZoom = false;
    controls.enablePan = false;
    // Slight initial tilt for a more "planet" feel
    globeRef.current.pointOfView?.({ lat: 15, lng: -30, altitude: 2.2 }, 0);
  }, [GlobeCmp, reduced]);

  // React to live trades: only ≥ MIN_BTC, side=buy. Pan the camera, push a
  // ring, mark the matching accumulation point as pulsing, then resume rotate.
  useEffect(() => {
    if (!trades.length) return;
    const newest = trades[trades.length - 1];
    if (newest.ts <= lastSeenTsRef.current) return;
    if (newest.side && newest.side !== 'buy') return;
    if (newest.amountBtc < MIN_BTC) return;
    lastSeenTsRef.current = newest.ts;

    const now = Date.now();

    setLastBigBuy(newest);

    setRings((prev) => {
      const next = [
        ...prev,
        {
          lat: newest.lat,
          lng: newest.lon,
          color: newest.color,
          ts: now,
          label: `${newest.exchangeName} · ${newest.amountBtc.toFixed(2)} BTC · $${Math.round(newest.priceUsd * newest.amountBtc).toLocaleString('en-US')}`,
        },
      ];
      return next.length > MAX_RINGS ? next.slice(-MAX_RINGS) : next;
    });

    // Pulse the matching accumulation point (if any)
    const match = ACCUMULATION.find((p) => p.matchExchange === newest.exchange);
    if (match) {
      setPulsing((prev) => ({ ...prev, [match.id]: now }));
    }

    // Camera focus
    if (globeRef.current && !reduced) {
      const controls = globeRef.current.controls?.();
      if (controls) controls.autoRotate = false;
      globeRef.current.pointOfView?.(
        { lat: newest.lat, lng: newest.lon, altitude: 2 },
        POV_TRANSITION_MS,
      );

      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => {
        if (globeRef.current) {
          const c = globeRef.current.controls?.();
          if (c) c.autoRotate = true;
        }
      }, FOCUS_HOLD_MS);
    }
  }, [trades, reduced]);

  // Periodic GC.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setRings((prev) => {
        const f = prev.filter((r) => now - r.ts < RING_DURATION_MS);
        return f.length === prev.length ? prev : f;
      });
      setPulsing((prev) => {
        let changed = false;
        const next: Record<string, number> = {};
        for (const [k, t] of Object.entries(prev)) {
          if (now - t < PULSE_MS) next[k] = t;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 400);
    return () => clearInterval(id);
  }, []);

  // Static accumulation layer with reactivity baked into the data so the
  // globe knows when to re-render the changed ones.
  const displayPoints = useMemo<DisplayPoint[]>(
    () =>
      ACCUMULATION.map((p) => ({
        ...p,
        pulsing: !!pulsing[p.id],
        color: CATEGORY_COLOR[p.category],
        size: sizeForBtc(p.btc),
      })),
    [pulsing],
  );

  const connectedCount = Object.values(connected).filter(Boolean).length;
  const totalExchanges = 5;

  return (
    <div ref={containerRef} className="relative w-full h-full flex flex-col items-center justify-center">
      <div className="relative" style={{ width: size.w, height: size.h }}>
        {GlobeCmp ? (
          <GlobeCmp
            ref={globeRef}
            width={size.w}
            height={size.h}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            atmosphereColor="#f7931a"
            atmosphereAltitude={0.18}
            showAtmosphere
            // Accumulation points (always visible)
            pointsData={displayPoints}
            pointLat={(d: DisplayPoint) => d.lat}
            pointLng={(d: DisplayPoint) => d.lng}
            pointColor={(d: DisplayPoint) => d.color}
            pointAltitude={(d: DisplayPoint) => (d.pulsing ? 0.05 : 0.01)}
            pointRadius={(d: DisplayPoint) => (d.pulsing ? d.size * 1.6 : d.size)}
            pointResolution={8}
            pointLabel={(d: DisplayPoint) =>
              `<div style="font:12px ui-monospace,monospace;background:#0a0a0bee;color:#f5f5f4;border:1px solid #26262b;border-radius:8px;padding:6px 10px;min-width:200px"><div style="font-weight:600;font-size:13px;color:${d.color}">${d.name}</div><div style="opacity:0.7;margin-top:2px">${d.city} · ${d.country}</div><div style="margin-top:4px;font-weight:600">${formatBtc(d.btc)}</div><div style="opacity:0.55;margin-top:2px;text-transform:uppercase;letter-spacing:0.05em;font-size:10px">${CATEGORY_LABEL[d.category]}</div></div>`
            }
            // Live ≥ 1 BTC rings
            ringsData={reduced ? [] : rings}
            ringLat={(d: Ring) => d.lat}
            ringLng={(d: Ring) => d.lng}
            ringColor={(d: Ring) => d.color}
            ringMaxRadius={6}
            ringPropagationSpeed={2.4}
            ringRepeatPeriod={0}
            ringAltitude={0.01}
            enablePointerInteraction
          />
        ) : (
          <div className="absolute inset-0 rounded-full bg-bg-card border border-line animate-pulse-slow" />
        )}
      </div>

      {/* Last big buy banner */}
      <div className="mt-4 w-full max-w-md min-h-[42px] px-4 py-2 rounded-xl border border-line bg-bg-card/60 backdrop-blur flex items-center justify-center text-center">
        {lastBigBuy ? (
          <div className="text-xs font-mono flex flex-wrap items-center gap-x-2 gap-y-0.5 justify-center">
            <span className="text-btc font-semibold">● COMPRA EN VIVO</span>
            <span className="text-ink-muted">{lastBigBuy.exchangeName}</span>
            <span className="text-ink-dim">·</span>
            <span className="text-ink font-semibold">{lastBigBuy.amountBtc.toFixed(3)} ₿</span>
            <span className="text-ink-dim">·</span>
            <span className="text-ink-muted">${Math.round(lastBigBuy.priceUsd * lastBigBuy.amountBtc).toLocaleString('en-US')}</span>
          </div>
        ) : (
          <div className="text-xs font-mono text-ink-dim">
            esperando compras ≥ 1 ₿…{' '}
            <span className="opacity-60">
              ({connectedCount}/{totalExchanges} exchanges en vivo)
            </span>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-mono text-ink-dim">
        {(Object.entries(CATEGORY_COLOR) as Array<[keyof typeof CATEGORY_COLOR, string]>).map(([key, color]) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} aria-hidden="true" />
            <span>{CATEGORY_LABEL[key]}</span>
          </span>
        ))}
        <span className="text-ink-dim/70">tamaño ∝ BTC acumulado</span>
      </div>

      <p className="mt-2 max-w-md text-center text-[10px] leading-relaxed text-ink-dim">
        {ACCUMULATION.length} ubicaciones · {formatBtc(TOTAL_TRACKED_BTC)} acumulados.
        Datos de DOJ, BitcoinTreasuries y análisis on-chain (~Q2 2026). El globo
        gira automáticamente y enfoca cada compra ≥ 1 ₿ que llega vía WebSocket
        a Binance, Coinbase, Kraken, Bitstamp y Bitso.
      </p>
    </div>
  );
}
