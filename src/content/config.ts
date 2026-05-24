import { defineCollection, z } from 'astro:content';

const articulos = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    capa: z.enum(['protocolo', 'L2', 'privacidad', 'futuro', 'glosario']),
    draft: z.boolean().default(false),
    cover: z.string().optional(),
    author: z.string().default('Bitcoin Sin Ruido'),
    order: z.number().optional(),
  }),
});

export const collections = { articulos };
