# Bitcoin Sin Ruido

> Protocolo, no precio. Investigación técnica sobre Bitcoin desde LATAM.

Sitio estático en **Astro 4** + **React islands**, desplegado en **Cloudflare Pages** bajo `bitcoinsinruidos.com`. Globo terráqueo conectado a WebSockets reales de exchanges. Sección **BitcoinNews** alimentada por un Cloudflare Worker con Cron Trigger diario.

---

## Tabla de contenidos

1. [Stack y arquitectura](#stack-y-arquitectura)
2. [Desarrollo local](#desarrollo-local)
3. [Publicar un artículo nuevo (sin tocar código)](#publicar-un-artículo-nuevo)
4. [Setup de Cloudflare Pages (one-time)](#setup-de-cloudflare-pages)
5. [Setup del Asistente IA (one-time)](#setup-del-asistente-ia)
6. [Setup del Worker BitcoinNews (one-time)](#setup-del-worker-bitcoinnews)
7. [Verificación end-to-end](#verificación-end-to-end)
8. [Performance budget](#performance-budget)

---

## Stack y arquitectura

| Capa | Herramienta |
|---|---|
| Framework | Astro 4 (estático) |
| UI interactiva | React 18 + `react-globe.gl` (three.js) |
| Estilos | Tailwind 3 + tokens custom |
| Contenido | MDX vía Astro Content Collections |
| Hosting | Cloudflare Pages (build automático en push a `main`) |
| Dominio | `bitcoinsinruidos.com` (DNS en Cloudflare) |
| BitcoinNews | Cloudflare Worker con Cron Trigger + KV |
| Precios en vivo | WebSockets de Binance, Coinbase, Kraken, Bitstamp + REST de Bitso (LATAM) |

```
src/
├── components/         Componentes Astro y React (LiveGlobe, NewsFeed, etc.)
├── content/articulos/  ← Subes MDX aquí para publicar artículos
├── layouts/            BaseLayout, ArticleLayout
├── pages/              index, articulos/[slug], news, rss
└── lib/                exchanges.ts, news.ts (clientes)
workers/news-fetcher/   ← Worker BitcoinNews (despliegue independiente)
```

---

## Desarrollo local

Requisitos: **Node 20+**.

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # genera /dist
npm run preview      # sirve /dist en local
npm run check        # type-check + astro check
```

El globo se conecta a los WebSockets reales en cuanto entra en viewport. Verifica el funcionamiento abriendo DevTools → **Network → WS** y mirando los frames entrantes de Binance, Coinbase, Kraken y Bitstamp. Bitso aparece como `Fetch/XHR` cada 5 segundos.

---

## Publicar un artículo nuevo

**Sin tocar código, ni clonar el repo, ni levantar nada local.**

1. Abre el repositorio en GitHub → carpeta `src/content/articulos/`.
2. Botón **Add file → Create new file**.
3. Nombre del archivo: `nombre-en-kebab-case.mdx`. Ese será el slug.
4. Pega este frontmatter al inicio y escribe el artículo en MDX debajo:

   ```mdx
   ---
   title: "Título del artículo"
   description: "Resumen de una a dos líneas. Aparece en home, listados y meta tags."
   publishedAt: 2026-05-25
   capa: protocolo            # protocolo | L2 | privacidad | futuro | glosario
   tags: [taproot, schnorr]   # opcional
   draft: false               # ponlo en true para guardar sin publicar
   ---

   Aquí va el contenido en **MDX**: markdown + componentes JSX si los necesitas.

   ## Subtítulo

   - Listas
   - **negritas**, [enlaces](https://bitcoinops.org)
   - `código inline`, citas con >

   > Buena cita técnica con fuente.
   ```

5. **Commit directamente a `main`** (o abre un PR si prefieres revisarlo antes; los PR generan preview en `*.pages.dev`).
6. Cloudflare Pages detecta el push, corre `npm run build` (~30–60 s) y publica.
7. El artículo aparece en `https://bitcoinsinruidos.com/articulos/<slug>` en **< 3 min** desde el commit.

### Campos del frontmatter

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `title` | string | sí | |
| `description` | string | sí | meta + listados |
| `publishedAt` | fecha (`YYYY-MM-DD`) | sí | usa formato ISO |
| `updatedAt` | fecha | no | |
| `capa` | enum | sí | `protocolo`, `L2`, `privacidad`, `futuro`, `glosario` |
| `tags` | array de strings | no | |
| `draft` | boolean | no | drafts se excluyen del build |
| `cover` | URL/path | no | para OG personalizado |
| `author` | string | no | default: `Bitcoin Sin Ruido` |
| `order` | number | no | para orden manual dentro de una capa |

### Borrar o editar un artículo

Igual que cualquier archivo en GitHub: edítalo en la web, commit a main, redeploy automático.

---

## Setup de Cloudflare Pages

**Una sola vez.** Después solo haces push a `main`.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Selecciona el repo de GitHub.
3. **Build settings**:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `/`
4. **Environment variables**:
   - `NODE_VERSION=20`
   - (opcional) `PUBLIC_NEWS_API_URL=https://news.bitcoinsinruidos.com/feed.json` si quieres apuntar el feed a otro dominio.
5. **Save and Deploy**. El primer build tarda ~1–2 min.
6. **Custom domains** → Add domain → `bitcoinsinruidos.com` y `www.bitcoinsinruidos.com`.
   - Cloudflare detecta que el dominio ya está en la cuenta y crea los registros DNS automáticamente.
   - SSL emitido en ~1 min.
7. Listo. Cada push a `main` redeploya. Cada PR genera una preview en `<branch>.<project>.pages.dev`.

> ⚠️ **No subir `node_modules` ni `dist`** — el `.gitignore` ya los excluye.

---

## Setup del Asistente IA

El chatbot flotante ("Asistente Bitcoin") vive en toda la web. Es una **Cloudflare
Pages Function** (`functions/api/chat.ts`, ruta `POST /api/chat`) que actúa de proxy
seguro sobre la **API de Gemini** de Google. La clave nunca llega al navegador: se
guarda como *secret* del proyecto de Pages y solo se usa en el edge.

**Una sola vez:**

1. Consigue una API key de Gemini en [Google AI Studio](https://aistudio.google.com/apikey)
   (o habilita la *Generative Language API* en tu proyecto de Google Cloud y crea una
   API key). Es gratis dentro de la cuota generosa del tier gratuito.
2. Cloudflare dashboard → **Workers & Pages** → proyecto `bitcoinsinruido` →
   **Settings** → **Variables and Secrets** → **Add**.
3. Añade el secret (marca **Encrypt**), en **Production** y también en **Preview**:
   - `GEMINI_API_KEY` = *(tu clave de Gemini)*
   - (opcional) `GEMINI_MODEL` = `gemini-flash-latest` *(valor por defecto si se omite)*
4. **Save** y vuelve a desplegar (push a `main` o *Retry deployment*) para que el
   secret quede disponible en runtime.

> 🔒 El secret se configura en **el proyecto de Pages** (runtime), no como secret de
> GitHub Actions. Si falta, el asistente responde con un aviso de "no configurado"
> (HTTP 503) en vez de romperse.

> 💡 En local, `npm run dev` **no** ejecuta la Function (Astro sirve solo estático), así
> que el chat mostrará un aviso de error al enviar. Para probar el backend en local usa
> `npx wrangler pages dev dist` con un archivo `.dev.vars` que contenga `GEMINI_API_KEY=...`.

---

## Setup del Worker BitcoinNews

El Worker corre **independiente** del sitio. Solo necesita configurarse una vez.

```bash
cd workers/news-fetcher
npm install
npx wrangler login
```

### 1. Crear el namespace KV

```bash
npx wrangler kv:namespace create NEWS_KV
```

Toma el `id` que devuelve y reemplaza `REPLACE_WITH_KV_ID` en `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "NEWS_KV"
id = "abcdef0123456789..."
```

### 2. Probar localmente

```bash
npm run dev
# en otra terminal:
curl http://localhost:8787/feed.json
```

Para forzar una ejecución del cron en local:

```bash
npx wrangler dev --test-scheduled
# luego: curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"
```

### 3. Desplegar a producción

```bash
npm run deploy
```

### 4. Conectar el subdominio `news.bitcoinsinruidos.com`

En el dashboard de Cloudflare:

1. **Workers & Pages** → tu worker `bsr-news-fetcher` → **Settings** → **Triggers** → **Custom Domains** → Add → `news.bitcoinsinruidos.com`.
2. CF crea el DNS automáticamente, SSL en ~1 min.
3. Verifica: `curl https://news.bitcoinsinruidos.com/feed.json`.

### 5. Forzar la primera ejecución del cron

El cron está programado para `0 6 * * *` UTC (03:00 ART, 00:00 CDMX). Para no esperar, fuerza una ejecución desde el dashboard del Worker → **Triggers** → **Cron Triggers** → **Run**.

A partir de ahí, el feed se refresca cada día solo. La sección `/news` del sitio consume el endpoint y auto-refresca en navegador cada 5 minutos cuando la pestaña está visible.

### Tunear el filtro anti-ruido

`workers/news-fetcher/src/filter.ts` contiene los patrones que descartan titulares. Para inspeccionar qué se está descartando:

```
curl https://news.bitcoinsinruidos.com/rejected.json
```

Si un titular relevante está siendo filtrado por error, ajusta los regex y redeploya.

---

## Verificación end-to-end

Antes de cada release importante:

- [ ] `npm run check` — type-check sin errores.
- [ ] `npm run build` — build limpio.
- [ ] `npm run preview` — sitio carga, globo recibe trades, ticker actualiza.
- [ ] DevTools mobile (iPhone SE 320px): sin overflow horizontal.
- [ ] DevTools tablet (iPad 768px): layout grids correctos.
- [ ] DevTools desktop (1440px): hero, listados y news en columnas previstas.
- [ ] Lighthouse: Performance ≥ 95, Accessibility ≥ 95, SEO 100.
- [ ] Probar `/articulos/<slug>` para cada artículo.
- [ ] Probar `/news` con Worker arriba y abajo (debe degradarse con mensaje claro).
- [ ] Probar navegación con teclado (Tab, focus rings visibles).
- [ ] Probar con `prefers-reduced-motion`: arcs del globo no animan.

Cross-browser:

- [ ] Chrome desktop
- [ ] Safari macOS + iOS (Safari es el más estricto con WebSockets)
- [ ] Firefox desktop
- [ ] Edge desktop
- [ ] Chrome Android

---

## Performance budget

| Métrica | Objetivo |
|---|---|
| First Contentful Paint | < 1.2 s |
| Largest Contentful Paint | < 2.0 s |
| Total Blocking Time | < 200 ms |
| Cumulative Layout Shift | < 0.05 |
| JS bundle inicial | < 80 KB gz |
| three.js + globe (lazy) | < 320 KB gz, solo al entrar el globo en viewport |

El globo monta con `client:visible` (no se carga hasta que el usuario lo ve). El ticker monta con `client:idle` (en cuanto el navegador esté libre). El feed de news monta con `client:visible` en la home y `client:load` en `/news`.

---

## Licencia y créditos

- Código: MIT.
- Contenido editorial (carpeta `src/content/`): **CC BY-NC-SA 4.0**.
- Datos de exchanges: APIs públicas de Binance, Coinbase, Kraken, Bitstamp y Bitso. Sin afiliación.
- Fuentes RSS de BitcoinNews: cada medio mantiene sus derechos sobre sus titulares.

> Bitcoin no es opinión. Es protocolo. Y este sitio es el intento de explicarlo así.
