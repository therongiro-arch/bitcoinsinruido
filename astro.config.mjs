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
      // Excluir 404 y las variantes canonicalizadas (anti-canibalización):
      // sus señales SEO se consolidan en los pilares raíz /lightning-network y /taproot.
      filter: (page) =>
        !page.includes('/404') &&
        !page.includes('/articulos/lightning-network') &&
        !page.includes('/articulos/taproot'),
    }),
  ],
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    // Force a single resolved instance of `three` across the bundle.
    // Without this, react-globe.gl's internal three import and our own
    // `import * as THREE from 'three'` can resolve to separate copies,
    // which triggers `THREE.WARNING: Multiple instances of Three.js being
    // imported` and can break `instanceof` checks at runtime.
    resolve: {
      dedupe: ['three'],
    },
    ssr: {
      noExternal: ['react-globe.gl', 'three'],
    },
  },
});
