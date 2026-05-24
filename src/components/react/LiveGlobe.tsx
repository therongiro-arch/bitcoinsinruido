import { useEffect, useMemo, useRef, useState } from 'react';
import { useExchangeStream, EXCHANGES } from './useExchangeStream';
import type { Trade, ExchangeId } from '../../lib/exchanges';

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

interface Ring {
  lat: number;
  lng: number;
  color: string;
  ts: number;
}

interface PointMarker {
  id: ExchangeId;
  name: string;
  city: string;
  lat: number;
  lng: number;
  color: string;
  pulsing: boolean;
}

const ARC_DURATION_MS = 1800;
const RING_DURATION_MS = 2200;
const PULSE_MS = 1400;
const MAX_ARCS = 18;
const MAX_RINGS = 30;

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
  const [rings, setRings] = useState<Ring[]>([]);
  const [pulsing, setPulsing] = useState<Record<string, number>>({});
  const { trades, connected } = useExchangeStream();
  const lastSeenTsRef = useRef<number>(0);
  const reduced = useMemo(reducedMotion, []);

  useEffect(() => {
    let alive = true;
    void loadGlobe().then((Cmp) => {
      if (alive) setGlobeCmp(() => Cmp as unknown as React.ComponentType<any>);
    });
    return () => {
      alive = false;
    };
  }, []);

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

  useEffect(() => {
    if (!trades.length) return;
    const newest = trades[trades.length - 1];
    if (newest.ts <= lastSeenTsRef.current) return;
    lastSeenTsRef.current = newest.ts;

    // Most exchanges expose side; if missing, treat the event as a buy so the
    // globe always reacts to real flow rather than going silent.
    if (newest.side && newest.side !== 'buy') return;

    const now = Date.now();

    setPulsing((prev) => ({ ...prev, [newest.exchange]: now }));

    setRings((prev) => {
      const next = [
        ...prev,
        { lat: newest.lat, lng: newest.lon, color: newest.color, ts: now },
      ];
      return next.length > MAX_RINGS ? next.slice(-MAX_RINGS) : next;
    });

    const arc: Arc = {
      startLat: newest.lat,
      startLng: newest.lon,
      endLat: TARGET_LAT,
      endLng: TARGET_LON,
      color: newest.color,
      ts: now,
      label: `${newest.exchangeName} · compra ${newest.amountBtc.toFixed(4)} BTC · $${Math.round(newest.priceUsd).toLocaleString('en-US')}`,
    };
    setArcs((prev) => {
      const next = [...prev, arc];
      return next.length > MAX_ARCS ? next.slice(-MAX_ARCS) : next;
    });
  }, [trades]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setArcs((prev) => {
        const filtered = prev.filter((a) => now - a.ts < ARC_DURATION_MS + 500);
        return filtered.length === prev.length ? prev : filtered;
      });
      setRings((prev) => {
        const filtered = prev.filter((r) => now - r.ts < RING_DURATION_MS);
        return filtered.length === prev.length ? prev : filtered;
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
    }, 250);
    return () => clearInterval(id);
  }, []);

  const markers = useMemo<PointMarker[]>(
    () =>
      Object.values(EXCHANGES).map((e) => ({
        id: e.id,
        name: e.name,
        city: e.city,
        lat: e.lat,
        lng: e.lon,
        color: e.color,
        pulsing: !!pulsing[e.id],
      })),
    [pulsing],
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
            // Glow points underneath labels so the marker is visible even
            // before three.js TextGeometry finishes loading the font.
            pointsData={markers}
            pointLat={(d: PointMarker) => d.lat}
            pointLng={(d: PointMarker) => d.lng}
            pointColor={(d: PointMarker) => d.color}
            pointAltitude={(d: PointMarker) => (d.pulsing ? 0.04 : 0.015)}
            pointRadius={(d: PointMarker) => (d.pulsing ? 0.9 : 0.55)}
            pointResolution={6}
            pointLabel={(d: PointMarker) =>
              `<div style="font:12px ui-monospace,monospace;background:#0a0a0bcc;color:#f5f5f4;border:1px solid #26262b;border-radius:6px;padding:4px 8px">${d.name} · ${d.city}</div>`
            }
            // ₿ label on top of each point. helvetiker (default font) supports
            // basic latin; we use the Bitcoin sign ₿ (U+20BF) — three-globe's
            // bundled helvetiker_regular font includes it. If it ever falls
            // back to a glyph stub the user still sees the colored point.
            labelsData={markers}
            labelLat={(d: PointMarker) => d.lat}
            labelLng={(d: PointMarker) => d.lng}
            labelText={() => '₿'}
            labelColor={(d: PointMarker) => d.color}
            labelSize={(d: PointMarker) => (d.pulsing ? 1.4 : 1.0)}
            labelDotRadius={0}
            labelAltitude={(d: PointMarker) => (d.pulsing ? 0.06 : 0.04)}
            labelResolution={3}
            // Subtle directional flow line
            arcsData={reduced ? [] : arcs}
            arcColor={(d: Arc) => d.color}
            arcStroke={0.35}
            arcDashLength={0.4}
            arcDashGap={2}
            arcDashAnimateTime={ARC_DURATION_MS}
            arcAltitudeAutoScale={0.4}
            arcLabel={(d: Arc) =>
              `<div style="font:12px ui-monospace,monospace;background:#0a0a0bcc;color:#f5f5f4;border:1px solid #26262b;border-radius:6px;padding:4px 8px">${d.label}</div>`
            }
            // Expanding "ping" effect on each buy
            ringsData={reduced ? [] : rings}
            ringColor={(d: Ring) => d.color}
            ringMaxRadius={4}
            ringPropagationSpeed={2.2}
            ringRepeatPeriod={0}
            ringAltitude={0.005}
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
            <span>
              última: {lastTrade.exchangeName} {lastTrade.amountBtc.toFixed(3)} BTC
            </span>
          </>
        )}
      </div>

      <p className="mt-1 max-w-xs text-center text-[10px] leading-relaxed text-ink-dim">
        Cada ₿ marca un exchange donde se acaban de registrar compras de BTC.
        Ubicación aproximada por sede del exchange — Bitcoin es un protocolo global, sin geolocalización inherente.
      </p>
    </div>
  );
}
