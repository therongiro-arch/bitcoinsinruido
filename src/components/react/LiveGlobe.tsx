import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useAttributedTxStream, type AttributedSpend } from './useAttributedTxStream';
import { knownAddressCount } from '../../lib/known-addresses';
import {
  ACCUMULATION,
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  TOTAL_TRACKED_BTC,
  sizeForBtc,
  type AccumulationPoint,
} from '../../lib/accumulation';
import {
  MINING_LOCATIONS,
  MINING_KIND_LABEL,
  type MiningLocation,
} from '../../lib/mining-locations';

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

// Map entity id -> AccumulationPoint for O(1) arc endpoint resolution.
const ENTITY_BY_ID = new Map<string, AccumulationPoint>(ACCUMULATION.map((p) => [p.id, p]));

function resolveEntity(entityId: string): AccumulationPoint | undefined {
  return ENTITY_BY_ID.get(entityId);
}

// Build a "Google-Maps-style" teardrop pin SVG for a mining location.
// The SVG is 22x60 so that, when react-globe.gl centres the element on
// the lat/lng, the *visible* tip (which lives in the top 30 px) lands
// exactly on the geographic point. The bottom 30 px are intentional
// empty space acting as a counterweight for the centring.
function buildMiningPin(d: MiningLocation): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.title = `${d.name} · ${d.city}, ${d.country}\n${MINING_KIND_LABEL[d.kind]}${d.notes ? ' — ' + d.notes : ''}`;
  wrapper.style.cssText =
    'width:22px;height:60px;pointer-events:auto;cursor:help;will-change:transform;';
  // Unique gradient id per pin so they don't collide in the DOM.
  const gid = `mp-${d.id}`;
  wrapper.innerHTML = `
    <div class="mining-pin-anim" style="width:100%;height:100%;">
      <svg width="22" height="60" viewBox="0 0 22 60" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.35));">
        <defs>
          <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#8ec1ea" stop-opacity="0.55"/>
            <stop offset="1" stop-color="#3d6fa8" stop-opacity="0.7"/>
          </linearGradient>
        </defs>
        <path d="M11 0 C4.9 0 0 4.9 0 11 C0 16.5 5.5 22 11 30 C16.5 22 22 16.5 22 11 C22 4.9 17.1 0 11 0 Z"
              fill="url(#${gid})"
              stroke="rgba(160,200,235,0.95)"
              stroke-width="0.8"/>
        <text x="11" y="15.5" text-anchor="middle" font-size="13" font-weight="700" fill="#ffffff" font-family="Inter, -apple-system, BlinkMacSystemFont, sans-serif">₿</text>
      </svg>
    </div>
  `;
  return wrapper;
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

// Ocean shell tuning — theme-aware so the blue stays perceptible without
// being loud in either mode.
//
// Dark mode: page bg is near-black, so a pale tint at low opacity reads
// clearly (the dark background "amplifies" subtle colours).
//
// Light mode: page bg is off-white, which dilutes any pale colour. We
// compensate with a more saturated blue + higher opacity so it doesn't
// disappear into the page.
const OCEAN_STYLE_DARK = { color: '#bdd9ed', opacity: 0.14 } as const;
const OCEAN_STYLE_LIGHT = { color: '#5491c8', opacity: 0.28 } as const;

function oceanStyleFor(dark: boolean): { color: string; opacity: number } {
  return dark ? OCEAN_STYLE_DARK : OCEAN_STYLE_LIGHT;
}

// Reactively tracks the `.dark` class on <html>. Updates when the user
// toggles the theme so we can re-tint the ocean shell without reloading.
function useIsDarkMode(): boolean {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function buildEarth(
  features: any[],
  dark: boolean,
): {
  land: THREE.Mesh;
  ocean: THREE.Mesh;
  dispose: () => void;
} {
  // Same radius as react-globe.gl's default (100) so accumulation points,
  // arcs and rings still snap to the surface correctly.
  const landGeo = new THREE.SphereGeometry(100, 96, 96);
  const alphaTex = buildEarthAlphaTexture(features);

  const landMat = new THREE.MeshStandardMaterial({
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

  const land = new THREE.Mesh(landGeo, landMat);
  // three-globe uses theta = (90 - lng) * π/180 to place markers, which puts
  // Greenwich at world +Z. The default three.js SphereGeometry UV mapping puts
  // the centre of an equirectangular texture (Greenwich) at world +X. So
  // markers and continents are 90° apart around Y unless we rotate the mesh
  // by −π/2. Verified mathematically against three-globe v2.41 source.
  land.rotation.y = -Math.PI / 2;

  // Ocean shell: a slightly smaller sphere just inside the land mesh.
  // Because the land mesh's alphaTest hard-clips ocean pixels, the blue
  // here only shows through over real ocean areas. Kept extremely pale +
  // transparent so it reads as a tint rather than a solid colour, and
  // doesn't break the "floating continents" feel.
  const oceanGeo = new THREE.SphereGeometry(99.5, 64, 64);
  const { color: oceanColor, opacity: oceanOpacity } = oceanStyleFor(dark);
  const oceanMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(oceanColor),
    transparent: true,
    opacity: oceanOpacity,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  // Render the ocean before the land so blending stays stable when the
  // camera moves and we don't get z-fighting with the coin or the arcs.
  ocean.renderOrder = -1;

  return {
    land,
    ocean,
    dispose: () => {
      landGeo.dispose();
      landMat.dispose();
      alphaTex.dispose();
      oceanGeo.dispose();
      oceanMat.dispose();
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
  const earthRef = useRef<{ land: THREE.Mesh; ocean: THREE.Mesh; dispose: () => void } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [contextEpoch, setContextEpoch] = useState(0);
  const [GlobeCmp, setGlobeCmp] = useState<React.ComponentType<any> | null>(null);
  const [globeVisible, setGlobeVisible] = useState(false);
  const [size, setSize] = useState({ w: 320, h: 320 });
  const [countries, setCountries] = useState<any[]>([]);
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [lastEvent, setLastEvent] = useState<AttributedSpend | null>(null);
  const lastSeenEventRef = useRef<string | null>(null);
  const { events, inspected, attributed, mempoolConnected } = useAttributedTxStream();
  const reduced = useMemo(reducedMotion, []);
  const dark = useIsDarkMode();
  // Stable ref so the buildEarth effect can read the latest theme without
  // having `dark` in its deps (we don't want to rebuild the alpha texture
  // every time the user toggles the theme).
  const darkRef = useRef(dark);
  useEffect(() => {
    darkRef.current = dark;
  }, [dark]);

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

  // Smooth fade-in once the globe chunk has actually mounted and rendered
  // at least one canvas frame. Without this, cold loads of the home flash
  // an empty disc for a few hundred ms while react-globe.gl downloads,
  // then the globe pops in abruptly.
  useEffect(() => {
    if (!GlobeCmp) {
      setGlobeVisible(false);
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setGlobeVisible(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [GlobeCmp]);

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

    const earth = buildEarth(countries, darkRef.current);
    scene.add(earth.ocean);
    scene.add(earth.land);
    earthRef.current = earth;

    return () => {
      const sceneNow: THREE.Scene | undefined = globeRef.current?.scene?.();
      if (earthRef.current) {
        if (sceneNow) {
          sceneNow.remove(earthRef.current.land);
          sceneNow.remove(earthRef.current.ocean);
        }
        earthRef.current.dispose();
        earthRef.current = null;
      }
    };
  }, [GlobeCmp, countries, contextEpoch]);

  // Re-tint the ocean shell when the theme toggles. Mutates the existing
  // material rather than rebuilding the earth — alpha texture is expensive
  // and doesn't need to be regenerated for a colour change.
  useEffect(() => {
    if (!earthRef.current) return;
    const mat = earthRef.current.ocean.material as THREE.MeshBasicMaterial;
    const { color, opacity } = oceanStyleFor(dark);
    mat.color.set(color);
    mat.opacity = opacity;
  }, [dark, countries, contextEpoch]);

  // Responsive sizing
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Floor low enough that very narrow phones (~300px content box) don't
        // force a canvas wider than the column, which would overflow the grid.
        const w = Math.max(240, Math.min(600, entry.contentRect.width));
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

    // Only devices with a real cursor (mouse/trackpad) get manual rotation,
    // and only while the pointer is hovering the globe. On touch we leave
    // OrbitControls disabled so a finger drag scrolls the page instead of
    // being trapped rotating the globe (the globe keeps auto-rotating).
    const finePointer =
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

    const controls = globeRef.current.controls?.();
    if (controls) {
      controls.autoRotate = !reduced;
      controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
      controls.enableZoom = false;
      controls.enablePan = false;
      // Manual drag stays OFF until the cursor enters the globe (see the
      // pointerenter/leave listeners below).
      controls.enableRotate = false;
      // IMPORTANT: keep the controls enabled. globe.gl's render loop only
      // calls `controls.update()` when `controls.enabled` is truthy, and
      // that update is what advances the auto-rotation. Disabling it freezes
      // the ambient spin (notably on touch, where there's no hover to re-arm).
      controls.enabled = true;
      // On touch, stop a one-finger drag from being captured as rotation so
      // the gesture scrolls the page instead. Auto-rotation keeps running.
      if (!finePointer && controls.touches) {
        controls.touches.ONE = null;
      }
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

    // Cursor-gated rotation: enable manual drag only while the pointer is over
    // the globe, and pause the ambient auto-rotation during interaction so the
    // user keeps full control. On leave we restore auto-rotation.
    const canvas = renderer?.domElement;
    const onPointerEnter = () => {
      if (!controls) return;
      controls.enableRotate = true;
      controls.autoRotate = false;
    };
    const onPointerLeave = () => {
      if (!controls) return;
      controls.enableRotate = false;
      controls.autoRotate = !reduced;
    };
    if (canvas && finePointer) {
      canvas.addEventListener('pointerenter', onPointerEnter);
      canvas.addEventListener('pointerleave', onPointerLeave);
    } else if (canvas) {
      // Touch: guarantee vertical page scroll passes through the canvas.
      canvas.style.touchAction = 'pan-y';
    }

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
      if (canvas) {
        canvas.removeEventListener('pointerenter', onPointerEnter);
        canvas.removeEventListener('pointerleave', onPointerLeave);
      }
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

  // React to attributed spend events: one arc per UTXO spent from a known
  // entity, going to the largest known output (or skipped entirely if the
  // destination isn't a tracked entity either). Endpoints come straight
  // from ACCUMULATION coordinates — every arc represents a real on-chain
  // movement between two real organisations.
  useEffect(() => {
    if (!events.length) return;
    const lastSeen = lastSeenEventRef.current;
    let firstNewIdx = 0;
    if (lastSeen) {
      // Compose key like txid + fromEntity for dedupe so two inputs of the
      // same tx don't collapse to a single event.
      const i = events.findIndex((e) => `${e.txid}:${e.fromEntityId}` === lastSeen);
      if (i >= 0) firstNewIdx = i + 1;
    }
    const unseen = events.slice(firstNewIdx);
    if (!unseen.length) return;
    const newest = unseen[unseen.length - 1];
    lastSeenEventRef.current = `${newest.txid}:${newest.fromEntityId}`;
    setLastEvent(newest);

    if (reduced) return;

    const now = Date.now();
    setArcs((prev) => {
      const next = [...prev];
      for (const ev of unseen) {
        const from = resolveEntity(ev.fromEntityId);
        if (!from) continue;
        // If the destination isn't a tracked entity, skip — we won't draw
        // an arc to a fabricated location. Loosen this branch if you'd
        // rather show "known sender, unknown receiver" arcs.
        if (!ev.toEntityId) continue;
        const to = resolveEntity(ev.toEntityId);
        if (!to) continue;
        next.push({
          id: `${ev.txid}:${ev.fromEntityId}:${ev.toEntityId}`,
          startLat: from.lat,
          startLng: from.lng,
          endLat: to.lat,
          endLng: to.lng,
          color: colorForFeeRate(ev.feeRate),
          stroke: strokeForBtc(ev.amountBtc),
          ts: now,
        });
      }
      return next.length > MAX_ARCS ? next.slice(-MAX_ARCS) : next;
    });
  }, [events, reduced]);

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
      <div className="relative max-w-full" style={{ width: size.w, height: size.h }}>
        {GlobeCmp ? (
          <div
            className={`absolute inset-0 transition-opacity duration-500 ease-out ${globeVisible ? 'opacity-100' : 'opacity-0'}`}
          >
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
            // Mining-node pins (Google-Maps-style teardrops with ₿).
            // Floating animation lives in the wrapper class .mining-pin-anim
            // declared in global.css.
            htmlElementsData={MINING_LOCATIONS}
            htmlLat={(d: MiningLocation) => d.lat}
            htmlLng={(d: MiningLocation) => d.lng}
            htmlAltitude={0.005}
            htmlElement={buildMiningPin}
            enablePointerInteraction
          />
          </div>
        ) : (
          // Transparent placeholder — reserves the layout space while the
          // react-globe.gl chunk downloads (~hundred KB) without flashing
          // a coloured disc that would be jarring in light mode.
          <div className="absolute inset-0" aria-hidden="true" />
        )}
      </div>

      <div className="mt-4 w-full max-w-full sm:max-w-md min-h-[42px] px-3 sm:px-4 py-2 rounded-xl border border-line bg-bg-card/60 backdrop-blur flex items-center justify-center text-center overflow-hidden">
        {lastEvent ? (
          (() => {
            const from = resolveEntity(lastEvent.fromEntityId);
            const to = lastEvent.toEntityId ? resolveEntity(lastEvent.toEntityId) : null;
            return (
              <div className="text-xs font-mono flex flex-wrap items-center gap-x-2 gap-y-0.5 justify-center">
                <span className="text-btc font-semibold">● TX EN VIVO</span>
                <span className="text-ink-muted">{from?.name ?? lastEvent.fromEntityId}</span>
                <span className="text-ink-dim">→</span>
                <span className="text-ink-muted">{to?.name ?? '—'}</span>
                <span className="text-ink-dim">·</span>
                <span className="text-ink font-semibold">{lastEvent.amountBtc.toFixed(3)} ₿</span>
              </div>
            );
          })()
        ) : (
          <div className="text-xs font-mono text-ink-dim">
            {mempoolConnected
              ? `mempool conectado · ${inspected} tx analizadas · ${attributed} atribuidas`
              : 'conectando con mempool.space…'}
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

      <div className="mt-2 w-full max-w-full flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] sm:text-[11px] font-mono text-ink-dim px-2">
        <span className="inline-flex items-center gap-1.5">
          <svg width="11" height="15" viewBox="0 0 22 30" aria-hidden="true">
            <path d="M11 0 C4.9 0 0 4.9 0 11 C0 16.5 5.5 22 11 30 C16.5 22 22 16.5 22 11 C22 4.9 17.1 0 11 0 Z" fill="rgba(80,130,200,0.7)" stroke="rgba(160,200,235,0.95)" strokeWidth="0.8" />
            <text x="11" y="15.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">₿</text>
          </svg>
          <span>{MINING_LOCATIONS.length} nodos de minado</span>
        </span>
        <span className="text-ink-dim/70">pools · granjas · minería estatal</span>
      </div>

      <p className="mt-2 max-w-md w-full text-center text-[10px] leading-relaxed text-ink-dim px-2">
        {ACCUMULATION.length} ubicaciones · {formatBtc(TOTAL_TRACKED_BTC)} acumulados.
        Datos de DOJ, BitcoinTreasuries y análisis on-chain (~Q2 2026). Cada arco
        luminoso es un <span className="text-ink-muted">UTXO real</span> gastado
        por una de las entidades del mapa, detectado en el mempool (fuente:
        mempool.space) vía atribución de direcciones ({knownAddressCount()} en
        la base actual). En el núcleo, el límite inmutable: 21 millones.
      </p>
    </div>
  );
}
