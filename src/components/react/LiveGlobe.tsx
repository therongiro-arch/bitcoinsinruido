import { useEffect, useMemo, useRef, useState } from 'react';
import { useExchangeStream, EXCHANGES } from './useExchangeStream';
import type { Trade } from '../../lib/exchanges';

// Lazy import so three.js + globe.gl bundle isn't pulled in until this island mounts.
const loadGlobe = () => import('react-globe.gl').then((m) => m.default);

interface Arc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  ts: number;
  label: string;
}

const ARC_DURATION_MS = 1800;
const MAX_ARCS = 25;

// Center of mass for the destination of each arc — Atlantic point as a neutral
// "global" target. The arcs visualise a real trade leaving the exchange HQ.
const TARGET_LAT = 0;
const TARGET_LON = -20;

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export default function LiveGlobe() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [GlobeCmp, setGlobeCmp] = useState<React.ComponentType<any> | null>(null);
  const [size, setSize] = useState({ w: 480, h: 480 });
  const [arcs, setArcs] = useState<Arc[]>([]);
  const { trades, connected } = useExchangeStream();
  const lastSeenTsRef = useRef<number>(0);
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

  // Responsive size based on container.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(280, Math.min(560, entry.contentRect.width));
        setSize({ w, h: w });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Convert new trades into arcs.
  useEffect(() => {
    if (!trades.length) return;
    const newest = trades[trades.length - 1];
    if (newest.ts <= lastSeenTsRef.current) return;
    lastSeenTsRef.current = newest.ts;

    const arc: Arc = {
      startLat: newest.lat,
      startLng: newest.lon,
      endLat: TARGET_LAT,
      endLng: TARGET_LON,
      color: newest.color,
      ts: Date.now(),
      label: `${newest.exchangeName} · ${newest.amountBtc.toFixed(4)} BTC · $${Math.round(newest.priceUsd).toLocaleString('en-US')}`,
    };
    setArcs((prev) => {
      const next = [...prev, arc];
      return next.length > MAX_ARCS ? next.slice(-MAX_ARCS) : next;
    });
  }, [trades]);

  // Garbage-collect arcs after their animation completes.
  useEffect(() => {
    if (!arcs.length) return;
    const id = setTimeout(() => {
      const now = Date.now();
      setArcs((prev) => prev.filter((a) => now - a.ts < ARC_DURATION_MS + 500));
    }, ARC_DURATION_MS + 500);
    return () => clearTimeout(id);
  }, [arcs]);

  // Static points = exchange HQs.
  const points = useMemo(
    () =>
      Object.values(EXCHANGES).map((e) => ({
        lat: e.lat,
        lng: e.lon,
        color: e.color,
        size: 0.6,
        label: `${e.name} · ${e.city}`,
      })),
    [],
  );

  const connectedCount = Object.values(connected).filter(Boolean).length;
  const totalExchanges = Object.keys(EXCHANGES).length;
  const lastTrade: Trade | null = trades.length ? trades[trades.length - 1] : null;

  return (
    <div ref={containerRef} className="relative w-full h-full flex flex-col items-center justify-center">
      <div className="relative" style={{ width: size.w, height: size.h }} aria-hidden="true">
        {GlobeCmp ? (
          <GlobeCmp
            width={size.w}
            height={size.h}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            atmosphereColor="#f7931a"
            atmosphereAltitude={0.18}
            arcsData={reduced ? [] : arcs}
            arcColor={(d: Arc) => d.color}
            arcStroke={0.5}
            arcDashLength={0.5}
            arcDashGap={1}
            arcDashAnimateTime={ARC_DURATION_MS}
            arcLabel={(d: Arc) => `<div style="font:12px ui-monospace,monospace;background:#0a0a0bcc;color:#f5f5f4;border:1px solid #26262b;border-radius:6px;padding:4px 8px">${d.label}</div>`}
            pointsData={points}
            pointAltitude={0.01}
            pointRadius={0.7}
            pointColor={(d: any) => d.color}
            pointLabel={(d: any) => `<div style="font:12px ui-monospace,monospace;background:#0a0a0bcc;color:#f5f5f4;border:1px solid #26262b;border-radius:6px;padding:4px 8px">${d.label}</div>`}
            enablePointerInteraction
          />
        ) : (
          <div className="absolute inset-0 rounded-full bg-bg-card border border-line animate-pulse-slow" />
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs font-mono text-ink-dim">
        <span
          className={`inline-block w-2 h-2 rounded-full ${connectedCount > 0 ? 'bg-btc animate-pulse-slow' : 'bg-ink-dim'}`}
          aria-hidden="true"
        />
        <span>
          {connectedCount}/{totalExchanges} exchanges en vivo
        </span>
        {lastTrade && (
          <>
            <span aria-hidden="true">·</span>
            <span>último: {lastTrade.exchangeName} {lastTrade.amountBtc.toFixed(3)} BTC</span>
          </>
        )}
      </div>

      <p className="mt-1 max-w-xs text-center text-[10px] leading-relaxed text-ink-dim">
        Ubicación aproximada por sede del exchange. Bitcoin es un protocolo global, sin geolocalización inherente.
      </p>
    </div>
  );
}
