// BitcoinNews Worker
// - Cron: runs daily, aggregates ~8 RSS feeds, filters noise, writes to KV.
// - HTTP: serves the cached feed as JSON with CORS + cache headers.

import { XMLParser } from 'fast-xml-parser';
import { SOURCES, BITCOIN_TOPICAL_REGEX, type SourceConfig } from './sources';
import { decide, extractTags } from './filter';

export interface Env {
  NEWS_KV: KVNamespace;
  MAX_ITEMS: string;
  FEED_KEY: string;
  REJECTED_KEY: string;
}

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  excerpt: string;
  lang: string;
  tags: string[];
}

interface FeedDoc {
  updatedAt: string;
  items: NewsItem[];
}

interface RejectedItem {
  title: string;
  source: string;
  reason: string;
  ts: string;
}

// --- HTTP handler ----------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return corsPreflight();

    if (url.pathname === '/feed.json' || url.pathname === '/' ) {
      const raw = await env.NEWS_KV.get(env.FEED_KEY);
      if (!raw) {
        return jsonResponse({ updatedAt: new Date(0).toISOString(), items: [] }, 200, {
          'Cache-Control': 'public, max-age=60',
        });
      }
      return new Response(raw, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
          ...corsHeaders(),
        },
      });
    }

    if (url.pathname === '/refresh' && req.headers.get('x-bsr-token') === env.MAX_ITEMS /* sentinel, only used manually */) {
      // Optional manual refresh path; ignored in normal flow.
      const result = await runAggregation(env);
      return jsonResponse(result, 200);
    }

    // CORS proxy for Bitso public trades — Bitso's REST API does not send
    // `Access-Control-Allow-Origin`, so we mirror it through the Worker.
    if (url.pathname === '/proxy/bitso/trades') {
      const book = url.searchParams.get('book') || 'btc_mxn';
      const limit = url.searchParams.get('limit') || '10';
      const safeBook = /^[a-z_]+$/.test(book) ? book : 'btc_mxn';
      const safeLimit = /^\d{1,3}$/.test(limit) ? limit : '10';
      const target = `https://api.bitso.com/v3/trades/?book=${safeBook}&limit=${safeLimit}`;
      try {
        const resp = await fetch(target, {
          headers: { 'User-Agent': 'BitcoinSinRuidoProxy/1.0' },
          cf: { cacheTtl: 4, cacheEverything: true } as RequestInitCfProperties,
        });
        const body = await resp.text();
        return new Response(body, {
          status: resp.status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=4',
            ...corsHeaders(),
          },
        });
      } catch (err) {
        return jsonResponse({ success: false, error: String(err) }, 502);
      }
    }

    // Live merchant search (OpenStreetMap via Overpass). Browsers hit this
    // Worker instead of Overpass directly, so we add CORS, a short KV cache by
    // rounded tile, and edge caching to protect OSM's fair-use limits.
    if (url.pathname === '/places') {
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      let radius = Number(url.searchParams.get('radius') ?? '5000');
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
        return jsonResponse({ updatedAt: new Date(0).toISOString(), items: [] }, 400);
      radius = Math.min(50000, Math.max(500, Math.round(radius) || 5000));
      const key = `places:${lat.toFixed(2)}:${lon.toFixed(2)}:${radius}`;
      const cached = await env.NEWS_KV.get(key);
      if (cached) {
        return new Response(cached, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=900',
            ...corsHeaders(),
          },
        });
      }
      const q = `[out:json][timeout:25];(nwr["currency:XBT"="yes"](around:${radius},${lat},${lon});nwr["payment:bitcoin"="yes"](around:${radius},${lat},${lon}););out center tags;`;
      try {
        const resp = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'BitcoinSinRuidoBot/1.0 (+https://bitcoinsinruidos.com)',
          },
          body: 'data=' + encodeURIComponent(q),
          cf: { cacheTtl: 900, cacheEverything: true } as RequestInitCfProperties,
        });
        if (!resp.ok) return jsonResponse({ updatedAt: new Date().toISOString(), items: [] }, 200);
        const data = (await resp.json()) as { elements?: any[] };
        const items = (data.elements ?? [])
          .map((e) => {
            const t = e.tags ?? {};
            const elat = e.lat ?? e.center?.lat;
            const elon = e.lon ?? e.center?.lon;
            if (elat == null || elon == null) return null;
            const isAtm = t.amenity === 'atm' || t.amenity === 'bureau_de_change';
            const isFood =
              t.amenity === 'restaurant' || t.amenity === 'cafe' || t.amenity === 'bar' ||
              t.amenity === 'fast_food' || t.amenity === 'pub';
            return {
              id: `${e.type}/${e.id}`,
              lat: elat,
              lon: elon,
              name: t.name ?? (isAtm ? 'Cajero Bitcoin' : 'Comercio'),
              kind: isAtm ? 'atm' : isFood ? 'food' : t.shop ? 'shop' : 'other',
              lightning:
                t['payment:lightning'] === 'yes' || t['payment:lightning_contactless'] === 'yes',
              onchain:
                t['payment:onchain'] === 'yes' ||
                t['payment:bitcoin'] === 'yes' ||
                t['currency:XBT'] === 'yes',
              address: [t['addr:street'], t['addr:housenumber'], t['addr:city']]
                .filter(Boolean)
                .join(' '),
              osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
            };
          })
          .filter(Boolean);
        const body = JSON.stringify({ updatedAt: new Date().toISOString(), items });
        await env.NEWS_KV.put(key, body, { expirationTtl: 1800 });
        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=900',
            ...corsHeaders(),
          },
        });
      } catch (err) {
        return jsonResponse({ updatedAt: new Date().toISOString(), items: [], error: String(err) }, 200);
      }
    }

    // Geocoding proxy (OpenStreetMap Nominatim). Long KV cache since the
    // mapping from a place name to coordinates is stable.
    if (url.pathname === '/geocode') {
      const q = (url.searchParams.get('q') ?? '').slice(0, 120).trim();
      if (q.length < 2) return jsonResponse({ results: [] }, 400);
      const key = `geo:${q.toLowerCase()}`;
      const cached = await env.NEWS_KV.get(key);
      if (cached) {
        return new Response(cached, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
        });
      }
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`,
          {
            headers: { 'User-Agent': 'BitcoinSinRuidoBot/1.0 (+https://bitcoinsinruidos.com)' },
            cf: { cacheTtl: 86400, cacheEverything: true } as RequestInitCfProperties,
          },
        );
        const arr = (await resp.json()) as any[];
        const results = (arr ?? []).map((r) => ({
          name: r.display_name,
          lat: Number(r.lat),
          lon: Number(r.lon),
        }));
        const body = JSON.stringify({ results });
        await env.NEWS_KV.put(key, body, { expirationTtl: 60 * 60 * 24 * 30 });
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
        });
      } catch (err) {
        return jsonResponse({ results: [], error: String(err) }, 200);
      }
    }

    if (url.pathname === '/rejected.json') {
      const raw = (await env.NEWS_KV.get(env.REJECTED_KEY)) ?? '[]';
      return new Response(raw, {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders() });
  },

  // --- Scheduled handler (Cron) ---
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAggregation(env).then(() => undefined));
  },
};

// --- Aggregation pipeline --------------------------------------------------------

async function runAggregation(env: Env): Promise<{ kept: number; rejected: number }> {
  const maxItems = Number(env.MAX_ITEMS ?? '60') || 60;
  const allKept: NewsItem[] = [];
  const allRejected: RejectedItem[] = [];

  // Fetch all sources in parallel; tolerate individual failures.
  const results = await Promise.allSettled(SOURCES.map((src) => fetchAndParse(src)));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const src = SOURCES[i];
    if (r.status !== 'fulfilled') {
      console.error(`Source failed: ${src.name}`, r.reason);
      continue;
    }
    for (const raw of r.value) {
      const decision = decide(raw.title);
      if (!decision.keep) {
        allRejected.push({
          title: raw.title,
          source: src.name,
          reason: decision.reason ?? 'unknown',
          ts: new Date().toISOString(),
        });
        continue;
      }

      // CoinDesk / The Block topical filter
      if (src.topicalFilter && !BITCOIN_TOPICAL_REGEX.test(raw.title)) {
        allRejected.push({ title: raw.title, source: src.name, reason: 'off-topic', ts: new Date().toISOString() });
        continue;
      }

      // Score-gated sources (Reddit, HN)
      if (src.minScore && raw.points !== undefined && raw.points < src.minScore) {
        continue;
      }

      const id = await sha1(raw.url);
      allKept.push({
        id,
        title: cleanText(raw.title).slice(0, 220),
        url: raw.url,
        source: src.name,
        publishedAt: raw.publishedAt,
        excerpt: cleanText(raw.excerpt).slice(0, 280),
        lang: src.lang,
        tags: extractTags(raw.title),
      });
    }
  }

  // Dedupe by URL (after id is computed)
  const seen = new Set<string>();
  const deduped = allKept.filter((it) => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });

  // Sort newest first
  deduped.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const trimmed = deduped.slice(0, maxItems);

  const doc: FeedDoc = {
    updatedAt: new Date().toISOString(),
    items: trimmed,
  };

  await env.NEWS_KV.put(env.FEED_KEY, JSON.stringify(doc), {
    expirationTtl: 60 * 60 * 24 * 3, // 3 days
  });

  // Keep only the last 200 rejected for audit
  const trimmedRejected = allRejected.slice(0, 200);
  await env.NEWS_KV.put(env.REJECTED_KEY, JSON.stringify(trimmedRejected), {
    expirationTtl: 60 * 60 * 24 * 3,
  });

  console.log(`BitcoinNews: kept ${trimmed.length}, rejected ${allRejected.length}`);
  return { kept: trimmed.length, rejected: allRejected.length };
}

// --- Source fetching + RSS parsing ----------------------------------------------

interface RawItem {
  title: string;
  url: string;
  publishedAt: string;
  excerpt: string;
  points?: number;
}

async function fetchAndParse(src: SourceConfig): Promise<RawItem[]> {
  const res = await fetch(src.url, {
    headers: {
      // Some feeds (Reddit) require a UA; be polite.
      'User-Agent': 'BitcoinSinRuidoBot/1.0 (+https://bitcoinsinruidos.com)',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
    },
    cf: { cacheTtl: 300, cacheEverything: true } as RequestInitCfProperties,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${src.url}`);
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    processEntities: true,
  });
  const parsed = parser.parse(xml) as any;

  // RSS 2.0
  if (parsed?.rss?.channel?.item) {
    const items = Array.isArray(parsed.rss.channel.item) ? parsed.rss.channel.item : [parsed.rss.channel.item];
    return items.map((it: any) => ({
      title: extractText(it.title) ?? '',
      url: extractText(it.link) ?? extractText(it.guid) ?? '',
      publishedAt: parseDate(extractText(it.pubDate) ?? extractText(it['dc:date'])),
      excerpt: stripHtml(extractText(it.description) ?? extractText(it['content:encoded']) ?? ''),
      points: parseHnPoints(extractText(it.description)),
    })).filter((it: RawItem) => it.title && it.url);
  }

  // Atom
  if (parsed?.feed?.entry) {
    const entries = Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry];
    return entries.map((e: any) => ({
      title: extractText(e.title) ?? '',
      url: e.link?.[0]?.['@_href'] ?? e.link?.['@_href'] ?? '',
      publishedAt: parseDate(extractText(e.updated) ?? extractText(e.published)),
      excerpt: stripHtml(extractText(e.summary) ?? extractText(e.content) ?? ''),
    })).filter((it: RawItem) => it.title && it.url);
  }

  return [];
}

// --- Helpers --------------------------------------------------------------------

function extractText(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeof obj['#text'] === 'string') return obj['#text'] as string;
    if (typeof obj['_'] === 'string') return obj['_'] as string;
  }
  return undefined;
}

function stripHtml(s: string): string {
  return s.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function parseDate(s: string | undefined): string {
  if (!s) return new Date().toISOString();
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return new Date().toISOString();
  return new Date(t).toISOString();
}

// HN RSS embeds "Points: 142" inside the description
function parseHnPoints(desc: string | undefined): number | undefined {
  if (!desc) return undefined;
  const m = /Points:\s*(\d+)/i.exec(desc);
  return m ? Number(m[1]) : undefined;
}

async function sha1(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-1', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- CORS -----------------------------------------------------------------------

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}
