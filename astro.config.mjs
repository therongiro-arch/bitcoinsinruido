import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// Variantes canonicalizadas que NO deben ir al sitemap (anti-canibalización):
// sus señales SEO se consolidan en los pilares raíz /lightning-network/ y
// /taproot/ vía `canonical` en el frontmatter. Se comparan por RUTA EXACTA
// (sin barra final), nunca por subcadena — ver el filtro de abajo.
const SITEMAP_EXCLUIDAS = new Set([
  '/404',
  '/articulos/lightning-network',
  '/articulos/taproot',
]);

export default defineConfig({
  site: 'https://bitcoinsinruidos.com',
  // Cloudflare Pages sirve las páginas (formato directorio) con barra final.
  // Forzar 'always' alinea rutas, canonical, hreflang y sitemap con la URL
  // real 200, evitando redirecciones 308 y los conflictos hreflang/canonical.
  trailingSlash: 'always',
  integrations: [
    react(),
    mdx(),
    tailwind({ applyBaseStyles: false }),
    sitemap({
      // Comparación por ruta EXACTA en lugar de `includes()`.
      //
      // El filtro anterior usaba subcadenas, así que el patrón
      // '/articulos/taproot' capturaba también '/articulos/taproot-assets/':
      // una página legítima (200, canonical propio, 32 enlaces internos)
      // quedaba fuera del sitemap por colisión de prefijo.
      //
      // Normalizamos a pathname sin barra final para que la comparación sea
      // independiente de `site` y de `trailingSlash`.
      filter: (page) => {
        const ruta = new URL(page, 'https://bitcoinsinruidos.com').pathname.replace(/\/+$/, '');
        return !SITEMAP_EXCLUIDAS.has(ruta);
      },
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
