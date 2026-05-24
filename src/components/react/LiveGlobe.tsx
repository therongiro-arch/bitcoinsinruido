import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
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

// Bundled with the site under /public/data/. Strip-down Natural Earth 110m
// (only the `name` property kept, ~170 KB gzipped). No external CDN dependency.
const COUNTRIES_URL = '/data/countries.geojson';

const MIN_BTC = 1;
const RING_DURATION_MS = 3000;
const PULSE_MS = 3500;
const FOCUS_HOLD_MS = 3800;
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

// Build a Bitcoin coin face texture. When `mirror` is true, the inner content
// is drawn horizontally flipped so the back of the cylinder reads correctly
// (CylinderGeometry's bottom cap is shown mirrored by default).
function makeCoinTexture(mirror = false): THREE.Texture {
  const SIZE = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();
  const c = SIZE / 2;

  // Background (no mirroring — it's symmetrical anyway).
  const g = ctx.createRadialGradient(c, c - 60, 80, c, c, c - 30);
  g.addColorStop(0, '#fde68a');
  g.addColorStop(0.45, '#f7931a');
  g.addColorStop(1, '#7a4500');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, c - 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(253, 230, 138, 0.95)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(c, c, c - 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120, 60, 0, 0.5)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(c, c, c - 75, 0, Math.PI * 2);
  ctx.stroke();

  // Text — pre-mirror for the back face.
  ctx.save();
  if (mirror) {
    ctx.translate(SIZE, 0);
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = '#1a0e00';
  ctx.font = 'bold 580px "Inter", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('₿', c, c - 70);
  ctx.font = 'bold 170px ui-monospace, "JetBrains Mono", "Menlo", monospace';
  ctx.fillText('21M', c, c + 290);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function buildCoin(): { pivot: THREE.Group; coin: THREE.Mesh; dispose: () => void } {
  // Globe radius in three-globe units is 100. Coin clearly smaller and centered.
  const radius = 58;
  const thickness = 8;
  const geo = new THREE.CylinderGeometry(radius, radius, thickness, 96, 1);

  const frontTex = makeCoinTexture(false);
  const backTex = makeCoinTexture(true);
  const frontMat = new THREE.MeshStandardMaterial({
    map: frontTex,
    metalness: 0.6,
    roughness: 0.28,
    emissive: new THREE.Color('#f7931a'),
    emissiveIntensity: 0.18,
  });
  const backMat = new THREE.MeshStandardMaterial({
    map: backTex,
    metalness: 0.6,
    roughness: 0.28,
    emissive: new THREE.Color('#f7931a'),
    emissiveIntensity: 0.18,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#b06800'),
    metalness: 0.85,
    roughness: 0.35,
    emissive: new THREE.Color('#3a1f00'),
    emissiveIntensity: 0.15,
  });
  // CylinderGeometry has 3 material slots: [side, top, bottom]
  const coin = new THREE.Mesh(geo, [sideMat, frontMat, backMat]);
  // Lay the coin so its faces look at the camera (flipping like a real coin).
  coin.rotation.x = Math.PI / 2;

  const pivot = new THREE.Group();
  pivot.add(coin);

  return {
    pivot,
    coin,
    dispose: () => {
      geo.dispose();
      frontMat.dispose();
      backMat.dispose();
      sideMat.dispose();
      frontTex.dispose();
      backTex.dispose();
    },
  };
}

export default function LiveGlobe() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<any>(null);
  const coinRef = useRef<{ pivot: THREE.Group; coin: THREE.Mesh; dispose: () => void } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [GlobeCmp, setGlobeCmp] = useState<React.ComponentType<any> | null>(null);
  const [size, setSize] = useState({ w: 480, h: 480 });
  const [countries, setCountries] = useState<any[]>([]);
  const [rings, setRings] = useState<Ring[]>([]);
  const [pulsing, setPulsing] = useState<Record<string, number>>({});
  const [lastBigBuy, setLastBigBuy] = useState<Trade | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenTsRef = useRef<number>(0);
  const { trades, connected } = useExchangeStream();
  const reduced = useMemo(reducedMotion, []);

  // Load globe component
  useEffect(() => {
    let alive = true;
    void loadGlobe().then((Cmp) => {
      if (alive) setGlobeCmp(() => Cmp as unknown as React.ComponentType<any>);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Load countries GeoJSON bundled with the site
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(COUNTRIES_URL);
        if (!r.ok) return;
        const data = (await r.json()) as { features?: any[] };
        if (alive && data?.features) setCountries(data.features);
      } catch {
        /* If countries fail to load the rest of the globe still renders. */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Responsive sizing
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

  // Configure controls + inject the spinning coin. The earth sphere itself
  // is hidden via `showGlobe={false}` in JSX so the coin reads clearly.
  useEffect(() => {
    if (!GlobeCmp || !globeRef.current) return;

    const controls = globeRef.current.controls?.();
    if (controls) {
      controls.autoRotate = !reduced;
      controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
      controls.enableZoom = false;
      controls.enablePan = false;
    }
    globeRef.current.pointOfView?.({ lat: 15, lng: -30, altitude: 2.4 }, 0);

    const scene: THREE.Scene | undefined = globeRef.current.scene?.();
    if (scene && !coinRef.current) {
      const c = buildCoin();
      coinRef.current = c;
      scene.add(c.pivot);

      // Warm rim light to make the coin glint through the empty oceans.
      const rim = new THREE.PointLight('#f7931a', 2.4, 1200);
      rim.position.set(140, 80, 220);
      scene.add(rim);
      // Soft fill from the opposite side
      const fill = new THREE.PointLight('#fde68a', 0.8, 800);
      fill.position.set(-180, -60, -200);
      scene.add(fill);
      (c.pivot.userData as any).rim = rim;
      (c.pivot.userData as any).fill = fill;

      const spin = () => {
        if (coinRef.current) {
          coinRef.current.pivot.rotation.y += reduced ? 0 : 0.012;
        }
        rafRef.current = requestAnimationFrame(spin);
      };
      rafRef.current = requestAnimationFrame(spin);
    }

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      const sceneNow: THREE.Scene | undefined = globeRef.current?.scene?.();
      if (coinRef.current) {
        if (sceneNow) {
          sceneNow.remove(coinRef.current.pivot);
          const rim = (coinRef.current.pivot.userData as any).rim as THREE.PointLight | undefined;
          const fill = (coinRef.current.pivot.userData as any).fill as THREE.PointLight | undefined;
          if (rim) sceneNow.remove(rim);
          if (fill) sceneNow.remove(fill);
        }
        coinRef.current.dispose();
        coinRef.current = null;
      }
    };
  }, [GlobeCmp, reduced]);

  // React to live trades
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

    const match = ACCUMULATION.find((p) => p.matchExchange === newest.exchange);
    if (match) {
      setPulsing((prev) => ({ ...prev, [match.id]: now }));
    }

    if (globeRef.current && !reduced) {
      const controls = globeRef.current.controls?.();
      if (controls) controls.autoRotate = false;
      globeRef.current.pointOfView?.(
        { lat: newest.lat, lng: newest.lon, altitude: 2.2 },
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

  // Periodic GC
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
            // Sphere hidden — only land polygons + atmosphere render. The
            // coin in the center stays visible through the empty oceans.
            showGlobe={false}
            atmosphereColor="#f7931a"
            atmosphereAltitude={0.22}
            showAtmosphere
            // Country polygons floating at globe radius
            polygonsData={countries}
            polygonAltitude={0.008}
            polygonCapColor={() => 'rgba(247, 147, 26, 0.92)'}
            polygonSideColor={() => 'rgba(247, 147, 26, 0.35)'}
            polygonStrokeColor={() => 'rgba(255, 210, 140, 0.85)'}
            // Accumulation points
            pointsData={displayPoints}
            pointLat={(d: DisplayPoint) => d.lat}
            pointLng={(d: DisplayPoint) => d.lng}
            pointColor={(d: DisplayPoint) => d.color}
            pointAltitude={(d: DisplayPoint) => (d.pulsing ? 0.07 : 0.02)}
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
        gira y enfoca cada compra ≥ 1 ₿ que llega vía WebSocket a Binance, Coinbase,
        Kraken, Bitstamp y Bitso. En el núcleo, el límite inmutable: 21 millones.
      </p>
    </div>
  );
}
