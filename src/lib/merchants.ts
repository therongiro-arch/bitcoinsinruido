// Client for the merchant-finder endpoints exposed by the BitcoinNews Worker.
// The Worker proxies OpenStreetMap (Overpass + Nominatim) so the browser never
// hits OSM directly — that keeps us within OSM's fair-use limits and adds a
// short edge cache by zone.

export type MerchantKind = 'shop' | 'food' | 'atm' | 'other';

export interface Merchant {
  id: string;
  lat: number;
  lon: number;
  name: string;
  kind: MerchantKind;
  lightning: boolean;
  onchain: boolean;
  address: string;
  osmUrl: string;
}

export interface MerchantsResponse {
  updatedAt: string;
  items: Merchant[];
}

export interface GeocodeResult {
  name: string;
  lat: number;
  lon: number;
}

// Derive the API base from the same host as the news feed. NEWS_ENDPOINT is a
// full URL ending in `/feed.json`; strip that path so we can append `/places`
// and `/geocode`.
const BASE = (
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    (import.meta.env as { PUBLIC_NEWS_API_URL?: string }).PUBLIC_NEWS_API_URL) ||
  'https://news.bitcoinsinruidos.com/feed.json'
)
  .replace(/\/feed\.json$/, '')
  .replace(/\/+$/, '');

export const MERCHANTS_ENDPOINT = `${BASE}/places`;
export const GEOCODE_ENDPOINT = `${BASE}/geocode`;

export async function fetchMerchants(p: {
  lat: number;
  lon: number;
  radius: number;
  signal?: AbortSignal;
}): Promise<MerchantsResponse | null> {
  try {
    const u = `${MERCHANTS_ENDPOINT}?lat=${p.lat}&lon=${p.lon}&radius=${Math.round(p.radius)}`;
    const res = await fetch(u, { signal: p.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as MerchantsResponse;
    if (!data || !Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function geocode(q: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  try {
    const res = await fetch(`${GEOCODE_ENDPOINT}?q=${encodeURIComponent(query)}`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: GeocodeResult[] };
    return Array.isArray(data?.results) ? data.results : [];
  } catch {
    return [];
  }
}

// Great-circle distance in kilometres between two lat/lon points.
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

// Universal Google Maps directions link. Opens the native app on mobile and
// the web map on desktop.
export function mapsDirectionsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}
