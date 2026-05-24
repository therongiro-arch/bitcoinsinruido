// Client for the BitcoinNews Worker feed.
// The Worker lives at news.bitcoinsinruidos.com and serves a JSON document.

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string; // ISO
  excerpt: string;
  lang: 'en' | 'es' | string;
  tags: string[];
}

export interface NewsFeed {
  updatedAt: string;
  items: NewsItem[];
}

export const NEWS_ENDPOINT =
  (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env as { PUBLIC_NEWS_API_URL?: string }).PUBLIC_NEWS_API_URL) ||
  'https://news.bitcoinsinruidos.com/feed.json';

export async function fetchNews(signal?: AbortSignal): Promise<NewsFeed | null> {
  try {
    const res = await fetch(NEWS_ENDPOINT, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as NewsFeed;
    if (!data || !Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'hace segundos';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `hace ${d} d`;
  const w = Math.round(d / 7);
  if (w < 5) return `hace ${w} sem`;
  const mo = Math.round(d / 30);
  return `hace ${mo} mes${mo > 1 ? 'es' : ''}`;
}
