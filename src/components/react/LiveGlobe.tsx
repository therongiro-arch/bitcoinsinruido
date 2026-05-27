import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useMempoolStream, type MempoolTx } from './useMempoolStream';
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

// --- Arc visualisation tuning ---------------------------------------------
// Each new mempool transaction becomes a curved light-beam arc between two
// random anchors taken from the accumulation map. We cap the number of arcs
// rendered simultaneously to keep the globe legible and pick only the top-N
// txs (by BTC value) from each poll so dense mempool bursts don't drown the
// scene. The dash animation is what gives the "moving beam" feel.
const MAX_ARCS = 8;
const ARC_LIFE_MS = 4500;
const ARCS_PER_POLL = 3;
const ARC_DASH_ANIMATE_MS = 2200;
const AUTO_ROTATE_SPEED = 0.35;

interface Arc {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  stroke: number;
  ts: number;
}

interface DisplayPoint extends AccumulationPoint {
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

// Map mempool fee rate (sat/vB) to a colour. Low fees read as cool gray,
// economy as brand orange, premium fees as a bright red-orange so high-fee
// flow stands out visually.
function colorForFeeRate(satPerVbyte: number): string {
  if (satPerVbyte >= 30) return '#ef4444';
  if (satPerVbyte >= 5) return '#f7931a';
  return '#7c8aa0';
}

// Larger transactions get a slightly thicker beam, capped so a whale doesn't
// dominate the whole globe.
function strokeForBtc(btc: number): number {
  if (btc >= 50) return 1.2;
  if (btc >= 5) return 0.85;
  if (btc >= 0.5) return 0.6;
  return 0.4;
}

function pickAnchor(): AccumulationPoint {
  return ACCUMULATION[Math.floor(Math.random() * ACCUMULATION.length)];
}

function pickDistinctAnchors(): { a: AccumulationPoint; b: AccumulationPoint } {
  const a = pickAnchor();
  let b = pickAnchor();
  let guard = 0;
  while (b.id === a.id && guard < 5) {
    b = pickAnchor();
    guard++;
  }
  return { a, b };
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
  // Pre-rotate the canvas 180° on BOTH faces. With the current coin
  // alignment (cylinder rotated y=-π/2 then tilted x=π/2), both caps end
  // up showing the texture upside-down without this compensation. The
  // back face additionally needs a horizontal mirror because cylinder
  // bottom caps render in reverse U direction.
  ctx.translate(SIZE, SIZE);
  ctx.scale(-1, -1);
  if (mirror) {
    // Add a horizontal flip on top so the back face is mirrored only
    // along U (after the 180° rotation that's a vertical flip).
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
  // Pre-rotate the canvas 180° on BOTH faces. With the current coin
  // alignment (cylinder rotated y=-π/2 then tilted x=π/2), both caps end
  // up showing the texture upside-down without this compensation. The
  // back face additionally needs a horizontal mirror because cylinder
  // bottom caps render in reverse U direction.
  ctx.translate(SIZE, SIZE);
  ctx.scale(-1, -1);
  if (mirror) {
    // Add a horizontal flip on top so the back face is mirrored only
    // along U (after the 180° rotation that's a vertical flip).
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

// Rasterise a GeoJSON FeatureCollection into a black/white equirectangular
// canvas. Land = white (opaque), oceans = black (transparent when used as
// alphaMap). 2048×1024 keeps coastlines crisp at the size we render.
function buildEarthAlphaTexture(features: any[]): THREE.Texture {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';

  const project = (lng: number, lat: number): [number, number] => {
    const x = ((lng + 180) / 360) * W;
    const y = ((90 - lat) / 180) * H;
    return [x, y];
  };

  const drawRing = (ring: number[][]) => {
    if (!ring.length) return;
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const [lng, lat] = ring[i];
      const [x, y] = project(lng, lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill('evenodd');
  };

  for (const f of features) {
    const geom = f?.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) drawRing(ring);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        for (const ring of poly) drawRing(ring);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function buildEarth(features: any[]): {
  mesh: THREE.Mesh;
  dispose: () => void;
} {
  // Same radius as react-globe.gl's default (100) so accumulation points,
  // arcs and rings still snap to the surface correctly.
  const geo = new THREE.SphereGeometry(100, 96, 96);
  const alphaTex = buildEarthAlphaTexture(features);

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f7931a'),
    alphaMap: alphaTex,
    transparent: true,
    // FrontSide so back continents don't ghost through and create the
    // illusion of a solid sphere behind the visible land masses.
    side: THREE.FrontSide,
    alphaTest: 0.4,
    metalness: 0.1,
    roughness: 0.85,
    emissive: new THREE.Color('#a85a05'),
    emissiveIntensity: 0.18,
    // Ignore the scene environment map (used to light the coin) so the
    // earth doesn't pick up a warm orange wash that reads as a halo.
    envMapIntensity: 0,
  });

  const mesh = new THREE.Mesh(geo, mat);
  // three-globe uses theta = (90 - lng) * π/180 to place markers, which puts
  // Greenwich at world +Z. The default three.js SphereGeometry UV mapping puts
  // the centre of an equirectangular texture (Greenwich) at world +X. So
  // markers and continents are 90° apart around Y unless we rotate the mesh
  // by −π/2. Verified mathematically against three-globe v2.41 source.
  mesh.rotation.y = -Math.PI / 2;
  return {
    mesh,
    dispose: () => {
      geo.dispose();
      mat.dispose();
      alphaTex.dispose();
    },
  };
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
  // Rotate around the cylinder's own axis (Y) so the ₿ symbol painted on
  // the cap reads upright once we tilt the cylinder to face the camera.
  // Doing this on the mesh itself (before the tilt is applied via parents)
  // keeps the alignment stable as the outer pivot spins.
  coin.rotation.y = -Math.PI / 2;

  // tiltHolder lays the coin flat to the camera (caps facing forward).
  const tiltHolder = new THREE.Group();
  tiltHolder.rotation.x = Math.PI / 2;
  tiltHolder.rotation.z = 0.08; // subtle 3D feel
  tiltHolder.add(coin);

  // pivot is what the animation spins around the world Y axis.
  const pivot = new THREE.Group();
  pivot.add(tiltHolder);

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
  const earthRef = useRef<{ mesh: THREE.Mesh; dispose: () => void } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [contextEpoch, setContextEpoch] = useState(0);
  const [GlobeCmp, setGlobeCmp] = useState<React.ComponentType<any> | null>(null);
  const [size, setSize] = useState({ w: 480, h: 480 });
  const [countries, setCountries] = useState<any[]>([]);
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [lastTx, setLastTx] = useState<MempoolTx | null>(null);
  const lastSeenIdRef = useRef<string | null>(null);
  const { txs, connected } = useMempoolStream();
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

  // Build the alpha-masked Earth sphere as soon as countries are ready and
  // the globe instance is mounted. Rebuilt on contextEpoch bump so a lost +
  // restored WebGL context gets a fresh mesh on the new scene.
  useEffect(() => {
    if (!GlobeCmp || !globeRef.current || !countries.length) return;
    const scene: THREE.Scene | undefined = globeRef.current.scene?.();
    if (!scene) return;
    if (earthRef.current) return; // already built

    const earth = buildEarth(countries);
    scene.add(earth.mesh);
    earthRef.current = earth;

    return () => {
      const sceneNow: THREE.Scene | undefined = globeRef.current?.scene?.();
      if (earthRef.current) {
        if (sceneNow) sceneNow.remove(earthRef.current.mesh);
        earthRef.current.dispose();
        earthRef.current = null;
      }
    };
  }, [GlobeCmp, countries, contextEpoch]);

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

  // WebGL context loss handling. After long idle / GPU reset / device sleep,
  // Chromium can lose the WebGL context, leaving a blank canvas (which the
  // browser then paints as a broken-image placeholder). We must call
  // preventDefault on `webglcontextlost` for the context to be eligible for
  // restoration — without it, the canvas is dead forever.
  useEffect(() => {
    if (!GlobeCmp || !globeRef.current) return;
    const renderer: THREE.WebGLRenderer | undefined = globeRef.current.renderer?.();
    const canvas = renderer?.domElement;
    if (!canvas) return;

    const onLost = (e: Event) => {
      e.preventDefault();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      // Drop refs so the next effect run rebuilds against the fresh context.
      coinRef.current?.dispose();
      coinRef.current = null;
      earthRef.current?.dispose();
      earthRef.current = null;
    };
    const onRestored = () => {
      setContextEpoch((n) => n + 1);
    };

    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }, [GlobeCmp]);

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

    // The globe sphere is hidden by showGlobe={false} in JSX. We don't
    // touch globeMaterial here because in this version of react-globe.gl
    // it's only available as a JSX prop, not as a runtime setter.

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
        if (coinRef.current && document.visibilityState === 'visible') {
          coinRef.current.pivot.rotation.y += reduced ? 0 : 0.012;
        }
        rafRef.current = requestAnimationFrame(spin);
      };
      rafRef.current = requestAnimationFrame(spin);
    }

    // When tab regains visibility, kick the controls so three-globe re-renders.
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const r: THREE.WebGLRenderer | undefined = globeRef.current?.renderer?.();
      const s: THREE.Scene | undefined = globeRef.current?.scene?.();
      const cam = globeRef.current?.camera?.();
      if (r && s && cam) r.render(s, cam);
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
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
  }, [GlobeCmp, reduced, contextEpoch]);

  // React to live mempool transactions: take the top-N by value from any
  // batch of unseen txs and draw arcs between two random anchors taken from
  // the accumulation map. We don't reposition the camera on tx events — the
  // globe just keeps slowly rotating while light beams flow across it.
  useEffect(() => {
    if (!txs.length) return;
    // Find the index of the last tx we already processed.
    const lastSeen = lastSeenIdRef.current;
    let firstNewIdx = 0;
    if (lastSeen) {
      const i = txs.findIndex((t) => t.id === lastSeen);
      if (i >= 0) firstNewIdx = i + 1;
    }
    const unseen = txs.slice(firstNewIdx);
    if (!unseen.length) return;
    lastSeenIdRef.current = txs[txs.length - 1].id;

    // Update the live ticker with the most recent tx regardless of how many
    // we render arcs for.
    setLastTx(unseen[unseen.length - 1]);

    if (reduced) return;

    // Pick the top-N by amount so a dense burst doesn't choke the scene.
    const top = [...unseen]
      .sort((a, b) => b.amountBtc - a.amountBtc)
      .slice(0, ARCS_PER_POLL);

    const now = Date.now();
    setArcs((prev) => {
      const next = [...prev];
      for (const tx of top) {
        const { a, b } = pickDistinctAnchors();
        next.push({
          id: tx.id,
          startLat: a.lat,
          startLng: a.lng,
          endLat: b.lat,
          endLng: b.lng,
          color: colorForFeeRate(tx.feeRate),
          stroke: strokeForBtc(tx.amountBtc),
          ts: now,
        });
      }
      return next.length > MAX_ARCS ? next.slice(-MAX_ARCS) : next;
    });
  }, [txs, reduced]);

  // Periodic GC for stale arcs
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setArcs((prev) => {
        const f = prev.filter((arc) => now - arc.ts < ARC_LIFE_MS);
        return f.length === prev.length ? prev : f;
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  const displayPoints = useMemo<DisplayPoint[]>(
    () =>
      ACCUMULATION.map((p) => ({
        ...p,
        color: CATEGORY_COLOR[p.category],
        size: sizeForBtc(p.btc),
      })),
    [],
  );

  return (
    <div ref={containerRef} className="relative w-full h-full flex flex-col items-center justify-center">
      <div className="relative" style={{ width: size.w, height: size.h }}>
        {GlobeCmp ? (
          <GlobeCmp
            ref={globeRef}
            width={size.w}
            height={size.h}
            backgroundColor="rgba(0,0,0,0)"
            // Globe sphere hidden — our own alpha-mapped Earth sphere is
            // injected into the scene, which gives transparent oceans and
            // opaque continents in a single mesh (no back-face issues).
            showGlobe={false}
            // Atmosphere off: in light mode the orange halo desaturates into
            // a pale disc behind the continents that breaks the "floating
            // continents" illusion. Without it the oceans are fully see-through.
            showAtmosphere={false}
            // Accumulation points (static, sized by sqrt of BTC stash)
            pointsData={displayPoints}
            pointLat={(d: DisplayPoint) => d.lat}
            pointLng={(d: DisplayPoint) => d.lng}
            pointColor={(d: DisplayPoint) => d.color}
            pointAltitude={0.02}
            pointRadius={(d: DisplayPoint) => d.size}
            pointResolution={8}
            pointLabel={(d: DisplayPoint) =>
              `<div style="font:12px ui-monospace,monospace;background:#0a0a0bee;color:#f5f5f4;border:1px solid #26262b;border-radius:8px;padding:6px 10px;min-width:200px"><div style="font-weight:600;font-size:13px;color:${d.color}">${d.name}</div><div style="opacity:0.7;margin-top:2px">${d.city} · ${d.country}</div><div style="margin-top:4px;font-weight:600">${formatBtc(d.btc)}</div><div style="opacity:0.55;margin-top:2px;text-transform:uppercase;letter-spacing:0.05em;font-size:10px">${CATEGORY_LABEL[d.category]}</div></div>`
            }
            // Live mempool transactions as curved light-beam arcs.
            // Dash animation gives the "flowing" feel of the reference image.
            arcsData={reduced ? [] : arcs}
            arcStartLat={(d: Arc) => d.startLat}
            arcStartLng={(d: Arc) => d.startLng}
            arcEndLat={(d: Arc) => d.endLat}
            arcEndLng={(d: Arc) => d.endLng}
            arcColor={(d: Arc) => d.color}
            arcStroke={(d: Arc) => d.stroke}
            arcAltitudeAutoScale={0.55}
            arcDashLength={0.4}
            arcDashGap={0.6}
            arcDashAnimateTime={ARC_DASH_ANIMATE_MS}
            arcsTransitionDuration={0}
            enablePointerInteraction
          />
        ) : (
          <div className="absolute inset-0 rounded-full bg-bg-card border border-line animate-pulse-slow" />
        )}
      </div>

      <div className="mt-4 w-full max-w-full sm:max-w-md min-h-[42px] px-3 sm:px-4 py-2 rounded-xl border border-line bg-bg-card/60 backdrop-blur flex items-center justify-center text-center overflow-hidden">
        {lastTx ? (
          <div className="text-xs font-mono flex flex-wrap items-center gap-x-2 gap-y-0.5 justify-center">
            <span className="text-btc font-semibold">● TX EN VIVO</span>
            <span className="text-ink font-semibold">{lastTx.amountBtc.toFixed(4)} ₿</span>
            <span className="text-ink-dim">·</span>
            <span className="text-ink-muted">{lastTx.feeRate.toFixed(1)} sat/vB</span>
            <span className="text-ink-dim">·</span>
            <span className="text-ink-muted opacity-70">mempool</span>
          </div>
        ) : (
          <div className="text-xs font-mono text-ink-dim">
            {connected ? 'esperando transacciones del mempool…' : 'conectando con mempool.space…'}
          </div>
        )}
      </div>

      <div className="mt-3 w-full max-w-full flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] sm:text-[11px] font-mono text-ink-dim px-2">
        {(Object.entries(CATEGORY_COLOR) as Array<[keyof typeof CATEGORY_COLOR, string]>).map(([key, color]) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} aria-hidden="true" />
            <span>{CATEGORY_LABEL[key]}</span>
          </span>
        ))}
        <span className="text-ink-dim/70">tamaño ∝ BTC acumulado</span>
      </div>

      <div className="mt-2 w-full max-w-full flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] sm:text-[11px] font-mono text-ink-dim px-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ background: '#7c8aa0' }} aria-hidden="true" />
          <span>fee bajo</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ background: '#f7931a' }} aria-hidden="true" />
          <span>fee medio</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ background: '#ef4444' }} aria-hidden="true" />
          <span>fee alto</span>
        </span>
        <span className="text-ink-dim/70">grosor ∝ BTC enviados</span>
      </div>

      <p className="mt-2 max-w-md w-full text-center text-[10px] leading-relaxed text-ink-dim px-2">
        {ACCUMULATION.length} ubicaciones · {formatBtc(TOTAL_TRACKED_BTC)} acumulados.
        Datos de DOJ, BitcoinTreasuries y análisis on-chain (~Q2 2026). Cada arco
        luminoso es una transacción Bitcoin que acaba de llegar al mempool
        (fuente: mempool.space). En el núcleo, el límite inmutable: 21 millones.
      </p>
    </div>
  );
}
