import { useEffect, useMemo, useState } from 'react';
import { fetchNews, timeAgo, type NewsItem, type NewsFeed as NewsFeedData } from '../../lib/news';

interface Props {
  limit?: number;          // maximum items to render
  compact?: boolean;       // dense layout used on home preview
  initialFeed?: NewsFeedData | null; // optional SSR-provided feed
}

export default function NewsFeed({ limit, compact = false, initialFeed = null }: Props) {
  const [feed, setFeed] = useState<NewsFeedData | null>(initialFeed);
  const [loading, setLoading] = useState<boolean>(!initialFeed);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  const load = async (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);
    const data = await fetchNews();
    if (!data) {
      setError('No pudimos cargar el feed de noticias. Reintenta en un minuto.');
    } else {
      setFeed(data);
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    void load('initial');
    // Auto-refresh every 5 minutes when tab visible
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load('refresh');
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items: NewsItem[] = useMemo(() => {
    if (!feed) return [];
    let xs = feed.items;
    if (sourceFilter) xs = xs.filter((i) => i.source === sourceFilter);
    if (limit) xs = xs.slice(0, limit);
    return xs;
  }, [feed, sourceFilter, limit]);

  const sources = useMemo(() => {
    if (!feed) return [];
    const set = new Map<string, number>();
    for (const it of feed.items) set.set(it.source, (set.get(it.source) ?? 0) + 1);
    return Array.from(set.entries()).sort((a, b) => b[1] - a[1]);
  }, [feed]);

  if (loading) {
    return (
      <div className="grid gap-3" aria-busy="true">
        {Array.from({ length: limit ?? 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-bg-card border border-line animate-pulse-slow" />
        ))}
      </div>
    );
  }

  if (error || !feed) {
    return (
      <div className="p-6 rounded-xl border border-line bg-bg-card text-ink-muted">
        <p className="mb-3">{error ?? 'Feed no disponible.'}</p>
        <button
          type="button"
          onClick={() => void load('initial')}
          className="btn"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSourceFilter(null)}
              className={`text-xs font-mono px-3 py-1.5 rounded-full border transition ${
                sourceFilter === null
                  ? 'bg-btc text-bg border-btc'
                  : 'border-line text-ink-muted hover:text-ink hover:border-ink'
              }`}
            >
              Todas · {feed.items.length}
            </button>
            {sources.map(([name, count]) => (
              <button
                key={name}
                type="button"
                onClick={() => setSourceFilter(name)}
                className={`text-xs font-mono px-3 py-1.5 rounded-full border transition ${
                  sourceFilter === name
                    ? 'bg-btc text-bg border-btc'
                    : 'border-line text-ink-muted hover:text-ink hover:border-ink'
                }`}
              >
                {name} · {count}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-ink-dim">
            <span>Actualizado {timeAgo(feed.updatedAt)}</span>
            <button
              type="button"
              onClick={() => void load('refresh')}
              disabled={refreshing}
              className="btn !py-1 !px-3 text-xs disabled:opacity-50"
            >
              {refreshing ? 'Refrescando…' : 'Refrescar'}
            </button>
          </div>
        </div>
      )}

      <div className={compact ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3'}>
        {items.map((it) => (
          <a
            key={it.id}
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group block p-4 sm:p-5 rounded-xl border border-line bg-bg-card hover:border-btc/50 hover:bg-bg-soft transition"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-ink-dim mb-2">
              <span className="text-btc">{it.source}</span>
              <span aria-hidden="true">·</span>
              <span>{timeAgo(it.publishedAt)}</span>
              {it.lang && it.lang !== 'es' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="uppercase">{it.lang}</span>
                </>
              )}
            </div>
            <h3 className="font-semibold text-ink group-hover:text-btc transition leading-snug text-balance">
              {it.title}
            </h3>
            {!compact && it.excerpt && (
              <p className="mt-2 text-sm text-ink-muted line-clamp-2">{it.excerpt}</p>
            )}
            {!compact && it.tags?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {it.tags.slice(0, 4).map((t) => (
                  <span key={t} className="text-[10px] uppercase tracking-wider text-ink-dim font-mono">#{t}</span>
                ))}
              </div>
            ) : null}
          </a>
        ))}
      </div>

      {!compact && items.length === 0 && (
        <p className="text-ink-muted text-center py-12">Sin noticias con este filtro ahora mismo.</p>
      )}
    </div>
  );
}
