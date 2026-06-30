import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import {
  fetchMerchants,
  geocode,
  haversineKm,
  formatDistance,
  mapsDirectionsUrl,
  type Merchant,
  type GeocodeResult,
} from '../../lib/merchants';

type Status = 'idle' | 'locating' | 'loading' | 'ready' | 'error';

interface Filters {
  shops: boolean;
  atms: boolean;
  lightningOnly: boolean;
}

const RADIUS_OPTIONS = [
  { value: 1000, label: '1 km' },
  { value: 3000, label: '3 km' },
  { value: 5000, label: '5 km' },
  { value: 10000, label: '10 km' },
  { value: 25000, label: '25 km' },
];

const KIND_LABEL: Record<Merchant['kind'], string> = {
  shop: 'Tienda',
  food: 'Restauración',
  atm: 'Cajero',
  other: 'Comercio',
};

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// Pin colour by kind. Cajeros stand out in blue, comercios en naranja marca.
function pinColor(m: Merchant): string {
  if (m.kind === 'atm') return '#3d6fa8';
  if (m.kind === 'food') return '#e0651a';
  return '#f7931a';
}

export default function MerchantFinder() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [loc, setLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [locLabel, setLocLabel] = useState<string>('');
  const [items, setItems] = useState<Merchant[]>([]);
  const [radius, setRadius] = useState<number>(5000);
  const [filters, setFilters] = useState<Filters>({ shops: true, atms: true, lightningOnly: false });

  const [query, setQuery] = useState('');
  const [geoResults, setGeoResults] = useState<GeocodeResult[]>([]);
  const [geoOpen, setGeoOpen] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const [mapReady, setMapReady] = useState(false);
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const reduced = useMemo(reducedMotion, []);

  // --- Data fetch: re-runs whenever the centre or radius changes ----------
  useEffect(() => {
    if (!loc) return;
    fetchAbortRef.current?.abort();
    const ac = new AbortController();
    fetchAbortRef.current = ac;
    setStatus('loading');
    setError(null);
    (async () => {
      const data = await fetchMerchants({ lat: loc.lat, lon: loc.lon, radius, signal: ac.signal });
      if (ac.signal.aborted) return;
      if (!data) {
        setError('No pudimos consultar OpenStreetMap. Reintenta en un momento.');
        setStatus('error');
        return;
      }
      setItems(data.items);
      setStatus('ready');
    })();
    return () => ac.abort();
  }, [loc, radius]);

  // --- Geocoding search with debounce -------------------------------------
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setGeoResults([]);
      return;
    }
    const ac = new AbortController();
    setGeocoding(true);
    const id = setTimeout(async () => {
      const results = await geocode(q, ac.signal);
      if (ac.signal.aborted) return;
      setGeoResults(results);
      setGeoOpen(true);
      setGeocoding(false);
    }, 450);
    return () => {
      clearTimeout(id);
      ac.abort();
    };
  }, [query]);

  const useMyLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Tu navegador no permite geolocalización. Busca por ciudad.');
      setStatus('error');
      return;
    }
    setStatus('locating');
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocLabel('Tu ubicación');
        setLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => {
        setError('No pudimos obtener tu ubicación. Revisa los permisos o busca por ciudad.');
        setStatus('error');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  const pickPlace = useCallback((r: GeocodeResult) => {
    setLocLabel(r.name.split(',').slice(0, 2).join(', '));
    setQuery('');
    setGeoResults([]);
    setGeoOpen(false);
    setLoc({ lat: r.lat, lon: r.lon });
  }, []);

  // --- Filtering + distance sort ------------------------------------------
  const visible = useMemo(() => {
    if (!loc) return [];
    let xs = items.filter((m) => {
      const isAtm = m.kind === 'atm';
      if (isAtm && !filters.atms) return false;
      if (!isAtm && !filters.shops) return false;
      if (filters.lightningOnly && !m.lightning) return false;
      return true;
    });
    xs = xs
      .map((m) => ({ m, d: haversineKm(loc.lat, loc.lon, m.lat, m.lon) }))
      .sort((a, b) => a.d - b.d)
      .map((x) => x.m);
    return xs;
  }, [items, filters, loc]);

  const distanceOf = useCallback(
    (m: Merchant) => (loc ? haversineKm(loc.lat, loc.lon, m.lat, m.lon) : 0),
    [loc],
  );

  // --- Map init (once a location exists) ----------------------------------
  useEffect(() => {
    if (!loc || !mapElRef.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !mapElRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(mapElRef.current, {
        center: [loc.lat, loc.lon],
        zoom: 14,
        scrollWheelZoom: false,
        attributionControl: true,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);
      // Leaflet measures the container on init; if it mounted hidden or mid
      // layout the tiles can render greyed-out until a resize is forced.
      setTimeout(() => map.invalidateSize(), 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [loc]);

  // Tear down the map on unmount.
  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // --- Render markers + recenter ------------------------------------------
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer || !loc) return;

    layer.clearLayers();

    // "You are here" marker.
    L.circleMarker([loc.lat, loc.lon], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#2563eb',
      fillOpacity: 1,
    })
      .bindTooltip(locLabel || 'Tu ubicación', { direction: 'top' })
      .addTo(layer);

    for (const m of visible) {
      const color = pinColor(m);
      const symbol = m.kind === 'atm' ? '$' : m.lightning ? '⚡' : '₿';
      const icon = L.divIcon({
        className: 'merchant-pin',
        html: `<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:1.5px solid rgba(255,255,255,0.9);box-shadow:0 1px 3px rgba(0,0,0,0.35);"><span style="transform:rotate(45deg);color:#fff;font:600 12px/1 Inter,sans-serif;">${symbol}</span></span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 24],
        popupAnchor: [0, -22],
      });
      const badges = [
        m.onchain ? '₿ on-chain' : '',
        m.lightning ? '⚡ Lightning' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const popup = `
        <div style="font:13px Inter,sans-serif;min-width:180px">
          <strong>${escapeHtml(m.name)}</strong>
          <div style="opacity:.7;margin-top:2px">${KIND_LABEL[m.kind]}${m.address ? ' · ' + escapeHtml(m.address) : ''}</div>
          ${badges ? `<div style="margin-top:4px">${badges}</div>` : ''}
          <div style="margin-top:6px;display:flex;gap:10px">
            <a href="${mapsDirectionsUrl(m.lat, m.lon)}" target="_blank" rel="noopener noreferrer">Cómo llegar</a>
            <a href="${m.osmUrl}" target="_blank" rel="noopener noreferrer">Ver en OSM</a>
          </div>
        </div>`;
      L.marker([m.lat, m.lon], { icon }).bindPopup(popup).addTo(layer);
    }

    map.setView([loc.lat, loc.lon], radius >= 10000 ? 12 : radius >= 5000 ? 13 : 14, {
      animate: !reduced,
    });
    map.invalidateSize();
  }, [visible, loc, locLabel, radius, reduced, mapReady]);

  const toggle = (k: keyof Filters) => setFilters((f) => ({ ...f, [k]: !f[k] }));

  return (
    <div className="not-prose">
      {/* Controls */}
      <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <button type="button" onClick={useMyLocation} className="btn justify-center">
          {status === 'locating' ? 'Localizando…' : '📍 Usar mi ubicación'}
        </button>

        <div className="relative">
          <label className="sr-only" htmlFor="merchant-search">
            Buscar ciudad o dirección
          </label>
          <input
            id="merchant-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => geoResults.length && setGeoOpen(true)}
            placeholder="Busca una ciudad o dirección…"
            className="w-full rounded-lg border border-line bg-bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:border-btc focus:outline-none"
            autoComplete="off"
          />
          {geoOpen && (geoResults.length > 0 || geocoding) && (
            <ul className="absolute z-[1100] mt-1 w-full overflow-hidden rounded-lg border border-line bg-bg-card shadow-lg">
              {geocoding && geoResults.length === 0 ? (
                <li className="px-3 py-2 text-sm text-ink-dim">Buscando…</li>
              ) : (
                geoResults.map((r, i) => (
                  <li key={`${r.lat}-${r.lon}-${i}`}>
                    <button
                      type="button"
                      onClick={() => pickPlace(r)}
                      className="block w-full px-3 py-2 text-left text-sm text-ink-muted hover:bg-bg-soft hover:text-ink"
                    >
                      {r.name}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <span className="sr-only sm:not-sr-only">Radio</span>
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="rounded-lg border border-line bg-bg-card px-2 py-2 text-sm text-ink focus:border-btc focus:outline-none"
          >
            {RADIUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Filter chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(
          [
            ['shops', 'Comercios'],
            ['atms', 'Cajeros'],
            ['lightningOnly', '⚡ Solo Lightning'],
          ] as Array<[keyof Filters, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            aria-pressed={filters[key]}
            className={`text-xs font-mono px-3 py-1.5 rounded-full border transition ${
              filters[key]
                ? 'bg-btc text-bg border-btc'
                : 'border-line text-ink-muted hover:text-ink hover:border-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      {!loc && status !== 'error' ? (
        <div className="mt-6 rounded-xl border border-dashed border-line bg-bg-card p-8 text-center text-ink-muted">
          <p>
            Activa tu ubicación o busca una ciudad para ver en el mapa los comercios y cajeros que
            aceptan Bitcoin a tu alrededor.
          </p>
        </div>
      ) : status === 'error' ? (
        <div className="mt-6 rounded-xl border border-line bg-bg-card p-6 text-ink-muted">
          <p className="mb-3">{error ?? 'Algo salió mal.'}</p>
          {loc && (
            <button type="button" onClick={() => setLoc({ ...loc })} className="btn">
              Reintentar
            </button>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* Map */}
          <div
            ref={mapElRef}
            className="h-[320px] w-full overflow-hidden rounded-xl border border-line bg-bg-card sm:h-[420px]"
            role="application"
            aria-label="Mapa de comercios que aceptan Bitcoin"
          />

          {/* List */}
          <div>
            <div className="mb-3 flex items-center justify-between text-xs font-mono text-ink-dim">
              <span>
                {status === 'loading'
                  ? 'Consultando OpenStreetMap…'
                  : `${visible.length} resultado${visible.length === 1 ? '' : 's'}${
                      locLabel ? ` · ${locLabel}` : ''
                    }`}
              </span>
            </div>

            {status === 'loading' ? (
              <div className="grid gap-3" aria-busy="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-20 rounded-xl border border-line bg-bg-card animate-pulse-slow"
                  />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-muted">
                <p className="mb-2">
                  No encontramos comercios mapeados en esta zona con los filtros actuales.
                </p>
                <p>
                  La cobertura depende de lo que la comunidad haya mapeado en OpenStreetMap: prueba a
                  ampliar el radio, otra ciudad, o{' '}
                  <a
                    href="https://btcmap.org/add-location"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-btc underline"
                  >
                    añade un comercio que falte
                  </a>
                  .
                </p>
              </div>
            ) : (
              <ul className="grid max-h-[480px] gap-3 overflow-y-auto pr-1">
                {visible.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-xl border border-line bg-bg-card p-4 hover:border-btc/50 transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-ink leading-snug">{m.name}</h3>
                        <p className="mt-0.5 text-xs font-mono text-ink-dim">
                          {KIND_LABEL[m.kind]}
                          {m.address ? ` · ${m.address}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-mono text-ink-muted">
                        {formatDistance(distanceOf(m))}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {m.onchain && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-line text-ink-muted">
                          ₿ on-chain
                        </span>
                      )}
                      {m.lightning && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-btc/40 text-btc">
                          ⚡ Lightning
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-mono">
                      <a
                        href={mapsDirectionsUrl(m.lat, m.lon)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-btc hover:underline"
                      >
                        Cómo llegar →
                      </a>
                      <a
                        href={m.osmUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink-dim hover:text-ink"
                      >
                        Ver en OSM
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <p className="mt-4 text-[11px] text-ink-dim">
        Datos de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">© OpenStreetMap</a>{' '}
        en tiempo real (vía Overpass). Tu ubicación se usa solo para esta búsqueda y no se almacena.
      </p>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
