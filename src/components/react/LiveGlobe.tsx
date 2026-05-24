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

// Color texture: gold gradient + dark engraved-looking text.
function makeCoinColorTexture(mirror = false): THREE.Texture {
  const SIZE = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();
  const c = SIZE / 2;

  // Polished gold radial gradient
  const g = ctx.createRadialGradient(c - 80, c - 120, 60, c, c + 20, c - 20);
  g.addColorStop(0, '#fff4cf');
  g.addColorStop(0.25, '#f4c558');
  g.addColorStop(0.55, '#d68f1a');
  g.addColorStop(0.85, '#9a5e08');
  g.addColorStop(1, '#5a3500');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, c - 6, 0, Math.PI * 2);
  ctx.fill();

  // Polished outer rim
  ctx.strokeStyle = 'rgba(255, 235, 170, 0.9)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(c, c, c - 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(70, 30, 0, 0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, c - 36, 0, Math.PI * 2);
  ctx.stroke();

  // Inner bevel ring
  ctx.strokeStyle = 'rgba(100, 50, 0, 0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, c - 70, 0, Math.PI * 2);
  ctx.stroke();

  // Engraved text (dark amber so the bump map carries the depth illusion)
  ctx.save();
  if (mirror) {
    ctx.translate(SIZE, 0);
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = '#3a1d00';
  ctx.font = 'bold 560px "Inter", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('₿', c, c - 60);
  ctx.font = 'bold 150px ui-monospace, "JetBrains Mono", "Menlo", monospace';
  ctx.fillText('21M', c, c + 280);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Bump map: grayscale where dark = recessed (engraving). The rest of the
// coin face is white (flat surface).
function makeCoinBumpTexture(mirror = false): THREE.Texture {
  const SIZE = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();
  const c = SIZE / 2;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Outer bevel (slightly raised ring)
  ctx.strokeStyle = '#d8d8d8';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(c, c, c - 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#aaaaaa';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c, c, c - 70, 0, Math.PI * 2);
  ctx.stroke();

  // Engraved text — pure black so bump pushes it down clearly
  ctx.save();
  if (mirror) {
    ctx.translate(SIZE, 0);
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 560px "Inter", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('₿', c, c - 60);
  ctx.font = 'bold 150px ui-monospace, "JetBrains Mono", "Menlo", monospace';
  ctx.fillText('21M', c, c + 280);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function buildCoin(): { pivot: THREE.Group; coin: THREE.Mesh; dispose: () => void } {
  // Smaller, more realistic gold coin floating in the globe core.
  const radius = 36;
  const thickness = 5;
  const geo = new THREE.CylinderGeometry(radius, radius, thickness, 128, 1);

  const frontColor = makeCoinColorTexture(false);
  const backColor = makeCoinColorTexture(true);
  const frontBump = makeCoinBumpTexture(false);
  const backBump = makeCoinBumpTexture(true);

  const sharedMatOpts = {
    metalness: 0.95,
    roughness: 0.18,
    emissive: new THREE.Color('#2a1500'),
    emissiveIntensity: 0.06,
    // Deep enough to read as real engraving when the spotlight hits the
    // coin at grazing angles.
    bumpScale: 2.5,
  } as const;

  const frontMat = new THREE.MeshStandardMaterial({
    ...sharedMatOpts,
    map: frontColor,
    bumpMap: frontBump,
  });
  const backMat = new THREE.MeshStandardMaterial({
    ...sharedMatOpts,
    map: backColor,
    bumpMap: backBump,
  });

  // Reeded edge texture for the coin rim — vertical stripes.
  const edgeCanvas = document.createElement('canvas');
  edgeCanvas.width = 512;
  edgeCanvas.height = 32;
  const ec = edgeCanvas.getContext('2d');
  if (ec) {
    ec.fillStyle = '#9a5e08';
    ec.fillRect(0, 0, 512, 32);
    ec.fillStyle = '#5a3500';
    for (let x = 0; x < 512; x += 8) {
      ec.fillRect(x, 0, 3, 32);
    }
  }
  const edgeTex = new THREE.CanvasTexture(edgeCanvas);
  edgeTex.wrapS = THREE.RepeatWrapping;
  edgeTex.repeat.set(1, 1);

  const sideMat = new THREE.MeshStandardMaterial({
    map: edgeTex,
    metalness: 0.9,
    roughness: 0.35,
    color: new THREE.Color('#c98a18'),
  });

  const coin = new THREE.Mesh(geo, [sideMat, frontMat, backMat]);
  coin.rotation.x = Math.PI / 2;
  // Slight tilt so the coin reads as 3D even when not spinning.
  coin.rotation.z = 0.08;

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
      frontColor.dispose();
      backColor.dispose();
      frontBump.dispose();
      backBump.dispose();
      edgeTex.dispose();
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

    // Force real transparency — three-globe sometimes leaves a black clear
    // color on the renderer even when the canvas itself is transparent.
    const renderer: THREE.WebGLRenderer | undefined = globeRef.current.renderer?.();
    if (renderer) {
      renderer.setClearColor(0x000000, 0);
      renderer.setClearAlpha?.(0);
    }
    const scene: THREE.Scene | undefined = globeRef.current.scene?.();
    if (scene) scene.background = null;

    // Replace the globe sphere material with one that's truly invisible —
    // `showGlobe={false}` alone leaves a backside-visible sphere in some
    // builds, which reads as a "dark disc" behind the continents.
    const invisibleGlobe = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    globeRef.current.globeMaterial?.(invisibleGlobe);

    // Environment map: a tiny procedural cube renders the scene as it is and
    // then PMREMGenerator turns it into the reflection map for the gold coin.
    // This is what gives the metal its "polished" look without needing an HDR.
    let envMap: THREE.Texture | null = null;
    if (renderer && scene) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      // Plain warm gradient as the world background reflected on the coin
      const envCanvas = document.createElement('canvas');
      envCanvas.width = 256;
      envCanvas.height = 128;
      const ec = envCanvas.getContext('2d');
      if (ec) {
        const grad = ec.createLinearGradient(0, 0, 0, 128);
        grad.addColorStop(0, '#3a1a00');
        grad.addColorStop(0.5, '#f7931a');
        grad.addColorStop(1, '#1a0e00');
        ec.fillStyle = grad;
        ec.fillRect(0, 0, 256, 128);
      }
      const envTex = new THREE.CanvasTexture(envCanvas);
      envTex.mapping = THREE.EquirectangularReflectionMapping;
      envMap = pmrem.fromEquirectangular(envTex).texture;
      envTex.dispose();
      pmrem.dispose();
      scene.environment = envMap;
    }
    if (scene && !coinRef.current) {
      const c = buildCoin();
      coinRef.current = c;
      scene.add(c.pivot);

      // Strong key light from upper-front (shows engraving + specular)
      const key = new THREE.DirectionalLight('#fff5e0', 1.8);
      key.position.set(140, 220, 280);
      scene.add(key);

      // Warm rim from below-back for metal contour highlight
      const rim = new THREE.PointLight('#f7931a', 3.2, 1400);
      rim.position.set(-120, -80, -260);
      scene.add(rim);

      // Hemisphere fill — warm sky, cool ground — keeps shadows readable
      const hemi = new THREE.HemisphereLight('#ffb347', '#2a1500', 0.6);
      scene.add(hemi);

      (c.pivot.userData as any).key = key;
      (c.pivot.userData as any).rim = rim;
      (c.pivot.userData as any).hemi = hemi;

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
          const ud = coinRef.current.pivot.userData as any;
          sceneNow.remove(coinRef.current.pivot);
          for (const k of ['key', 'rim', 'hemi']) {
            const obj = ud[k] as THREE.Object3D | undefined;
            if (obj) sceneNow.remove(obj);
          }
        }
        coinRef.current.dispose();
        coinRef.current = null;
      }
      if (envMap) envMap.dispose();
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

  // DoubleSide unlit material for country polygons — keeps both the
  // front-facing and back-facing continent caps in full orange so the
  // far hemisphere doesn't appear as a dark crescent through the oceans.
  const polygonMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#f7931a'),
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: true,
      }),
    [],
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
            // Globe sphere stays but its material is replaced with an
            // invisible one inside the effect hook above.
            showGlobe
            atmosphereColor="#f7931a"
            atmosphereAltitude={0.22}
            showAtmosphere
            // Country polygons floating at globe radius — DoubleSide
            // material so the back-facing continents on the far side of
            // the globe don't appear as a dark silhouette through the
            // transparent oceans.
            polygonsData={countries}
            polygonAltitude={0.008}
            polygonCapMaterial={polygonMat}
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
