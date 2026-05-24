import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://bitcoinsinruidos.com',
  integrations: [
    react(),
    mdx(),
    tailwind({ applyBaseStyles: false }),
    sitemap({
      filter: (page) => !page.includes('/404'),
    }),
  ],
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    ssr: {
      noExternal: ['react-globe.gl', 'three'],
    },
  },
});
