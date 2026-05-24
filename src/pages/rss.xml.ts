import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const items = await getCollection('articulos', ({ data }) => !data.draft);
  return rss({
    title: 'Bitcoin Sin Ruido',
    description: 'Bitcoin desde el protocolo, no desde el precio. Investigación técnica desde LATAM.',
    site: context.site ?? 'https://bitcoinsinruidos.com',
    items: items
      .sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime())
      .map((entry) => ({
        title: entry.data.title,
        description: entry.data.description,
        pubDate: entry.data.publishedAt,
        link: `/articulos/${entry.slug}/`,
      })),
    customData: '<language>es</language>',
  });
}
