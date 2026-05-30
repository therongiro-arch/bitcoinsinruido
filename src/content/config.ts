import { defineCollection, z } from 'astro:content';

const faqSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

const articulos = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    capa: z.enum(['protocolo', 'L2', 'privacidad', 'futuro', 'glosario', 'uso']),
    draft: z.boolean().default(false),
    cover: z.string().optional(),
    author: z.string().default('Bitcoin Sin Ruido'),
    order: z.number().optional(),
    keywords: z.array(z.string()).default([]),
    faqs: z.array(faqSchema).default([]),
    related: z.array(z.string()).default([]),
    // URL canónica externa: usar solo cuando este artículo es una variante
    // que debe consolidar señales SEO en otra página (anti-canibalización).
    canonical: z.string().optional(),
  }),
});

export const collections = { articulos };
