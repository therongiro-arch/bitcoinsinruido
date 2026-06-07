# Decisiones SEO de Bitcoin Sin Ruido

> Documento de referencia de la arquitectura de contenidos y las decisiones SEO
> tomadas. Sirve para no repetir errores ya resueltos y para que cualquiera
> (humano o agente) entienda el porqué de la estructura actual.
>
> Última actualización: 2026-06-07.

---

## 1. Resumen

La web es una referencia técnica en español sobre Bitcoin, **sin precio ni
especulación**. El contenido se organiza en **silos temáticos** con un artículo
pilar y varios satélites cada uno, fuertemente enlazados entre sí.

Conviven **dos sistemas de contenido**:

1. **Páginas `.astro`** en `src/pages/` → URLs en la raíz (`/que-es-bitcoin/`,
   `/lightning-network/`, `/taproot/`, `/futuro-bitcoin/`…). Son las páginas
   pilar y de mayor recorrido SEO, con JSON-LD y FAQs propias.
2. **Colección MDX** en `src/content/articulos/` → URLs bajo
   `/articulos/<slug>/`. Renderizadas por `src/pages/articulos/[slug].astro`
   con `ArticleLayout`. Es donde se crean los artículos nuevos.

Ambas comparten `BaseLayout.astro`, que centraliza `<title>`, canonical,
hreflang, Open Graph y JSON-LD de organización.

---

## 2. Arquitectura de silos

Cada silo: 1 pilar + satélites, con interlinking bidireccional
(pilar → satélites y satélites → pilar). **Ningún artículo queda aislado.**

| Silo | Pilar | Satélites (resumen) |
|---|---|---|
| **1. Base** | `/que-es-bitcoin/` (.astro) | historia, qué problema soluciona, por qué tiene valor, descentralización, vs dinero tradicional, blockchain, cómo funciona, UTXO, 21 millones |
| **2. Tecnología** | `/articulos/bitcoin-como-tecnologia/` | bloque, minería, hash (SHA-256), dificultad de minado, halving, nodos, Proof of Work |
| **3. Escalabilidad / Futuro** | `/futuro-bitcoin/` (.astro) | Lightning, ventajas/desventajas de Lightning, Taproot, escalabilidad, problemas y soluciones, BitVM/Citrea, covenants, BIP-360 |
| **4. Uso y seguridad** | `/articulos/como-usar-bitcoin-seguro/` | wallet, tipos de wallets, enviar/recibir, clave privada, errores comunes, cómo proteger |

Regla de interlinking por artículo: **1 enlace al pilar del silo + 2-3 a
artículos relacionados**.

---

## 3. Schema de la colección (`src/content/config.ts`)

Campos relevantes de cada artículo MDX:

- `title`, `description`, `publishedAt`, `updatedAt?`
- `capa`: `protocolo | L2 | privacidad | futuro | glosario | uso`
  - `uso` se añadió para el Silo 4 (uso práctico y seguridad).
- `tags`, `keywords`, `draft`
- `faqs`: array `{ question, answer }` → genera JSON-LD `FAQPage` (elegible para
  rich snippets).
- `related`: slugs de **otros artículos MDX** (solo resuelven los que existen y
  no son draft). Renderiza las tarjetas de "Relacionado".
- `canonical?`: URL canónica **externa**. Solo para variantes que deben
  consolidar señales en otra página (ver sección 4).

> Los enlaces a páginas `.astro` (p. ej. `/que-es-bitcoin/`) **no** pueden ir en
> `related` (no son de la colección); se enlazan inline en el cuerpo.

---

## 4. Anti-canibalización (decisiones de canonical)

Se detectaron 4 pares de URLs compitiendo por la misma keyword. Resolución:

| Par | Decisión | Implementación |
|---|---|---|
| `/bitcoin-explicado` ↔ `/que-es-bitcoin/` | **301** (página redundante eliminada) | `public/_redirects` + 7 enlaces internos unificados |
| `/articulos/lightning-network/` ↔ `/lightning-network/` | **canonical cruzado** al pilar raíz | `canonical` en frontmatter + excluida del sitemap |
| `/articulos/taproot/` ↔ `/taproot/` | **canonical cruzado** al pilar raíz | `canonical` en frontmatter + excluida del sitemap |
| `/que-es-un-nodo-bitcoin/` ↔ `/articulos/nodos-los-guardianes/` | **diferenciar** por ángulo (guía vs tesis) | Sin canonical; revisar solo si GSC muestra competencia |

**Regla general:** una URL canónica por keyword. Para duplicados redundantes,
301; para variantes útiles que se quieren conservar, `rel=canonical`.

La exclusión del sitemap de las variantes canonicalizadas está en el filtro de
`@astrojs/sitemap` (`astro.config.mjs`).

---

## 5. Política de URLs

### Barra final (`trailingSlash`)
- `astro.config.mjs` → `trailingSlash: 'always'`.
- Cloudflare Pages sirve las páginas (formato directorio) **con barra final** y
  redirige (308) las versiones sin barra.
- `BaseLayout` **normaliza el canonical a barra final** (cubre también páginas
  que lo hardcodean), para que canonical, hreflang, og:url y sitemap apunten
  siempre a la URL 200 y no a una que redirige.
- **No** se añadió barra final a los enlaces internos en el código: solo
  generan *avisos* de redirección (no errores) y el valor real es nulo a esta
  escala. El 308 funciona y pasa el equity.

### www → no-www
- El dominio canónico es **sin www** (`site: 'https://bitcoinsinruidos.com'`).
- El 301 `www → no-www` **no** se puede hacer en el repo (el `_redirects` de
  Pages es por ruta, no por host). Está implementado como **Page Rule en
  Cloudflare**:
  - Patrón: `www.bitcoinsinruidos.com/*`
  - Acción: Reenvío URL → `https://bitcoinsinruidos.com/$1`, código **301**.
- Verificado: `www/<ruta>` → 301 → `no-www/<ruta>/` → 200.

> ⚠️ Si se reconstruye la configuración de Cloudflare, **recordar recrear esta
> Page Rule**: no vive en el repositorio.

---

## 6. Política de títulos

Casi todos los títulos descriptivos superan 70 caracteres al sumarles el sufijo
de marca ` | Bitcoin Sin Ruido` (+20). Como Google trunca el final (la marca),
la keyword (front-loaded) sí se ve.

- **`BaseLayout`** quita el sufijo de marca **solo cuando el título completo
  supera 70 caracteres** (`pageTitle`). Aplica a `<title>`, `og:title`,
  `twitter:title`. Así se mantienen los títulos descriptivos y la keyword, y se
  respeta el límite sin reescribir ~48 títulos.
- Excepción: los pocos títulos cuyo **texto base** ya pasaba de 70 se recortaron
  a mano (metodología, custodia-vs-autocustodia, bitvm-vs-smart-contracts).

**Al crear un título nuevo:** front-load de la keyword y, idealmente, texto base
≤ 60-65 caracteres. La marca se añade/quita sola según quepa.

---

## 7. hreflang

Web monolingüe (español). Se emite **solo** `hreflang="es"` + `x-default`,
ambos autorreferenciados al canonical. Se eliminaron las variantes regionales
(`es-ES`, `es-MX`, `es-AR`, `es-CO`) que apuntaban todas a la misma URL y
generaban conflictos y "language mismatch" en la auditoría.

---

## 8. Otros activos SEO

- **`public/llms.txt`**: índice para buscadores de IA (alineado con el
  `robots.txt`, que ya permite explícitamente los bots de IA). Mantenerlo al día
  cuando se añadan páginas pilar.
- **`public/robots.txt`**: permite buscadores tradicionales y bots de IA;
  apunta al sitemap.
- **Sitemap**: `https://bitcoinsinruidos.com/sitemap-index.xml`
  (`@astrojs/sitemap`), enviado en Search Console.

---

## 9. Google Search Console

- Sitemap enviado y "Correcto".
- Indexación solicitada manualmente para los pilares en su forma canónica
  (no-www, con barra final).
- FAQs y breadcrumbs reconocidos como datos estructurados válidos.
- **Forma canónica de toda URL:** `https://bitcoinsinruidos.com/<ruta>/`
  (no-www, con barra final). Usar siempre esta forma al pedir indexación.

---

## 10. Checklist al crear contenido nuevo

- [ ] Asignar el artículo a un silo y enlazar a su **pilar** + 2-3 relacionados.
- [ ] `capa` correcta; `draft: false` solo tras revisión.
- [ ] `faqs` con preguntas reales (genera rich snippets).
- [ ] `related` con slugs MDX existentes; enlaces a pilares `.astro` inline.
- [ ] Título con keyword al principio (la marca se gestiona sola).
- [ ] Enlazar el artículo **desde** su pilar (interlinking bidireccional).
- [ ] No crear una URL que canibalice una keyword ya cubierta (ver sección 4).
- [ ] `npx astro check` sin errores antes de PR.

---

## 11. Pendientes / próximos pasos

- **Monitorizar GSC** (~3 semanas): confirmar que las URLs duplicadas
  (www/no-www, slash/no-slash) se fusionan en una sola por página.
- **Fase 2 opcional (cosmética):** barra final en enlaces internos para vaciar
  los avisos de redirección de Semrush (valor real bajo a esta escala).
- **Re-auditar en Semrush** tras el recrawl.
- La difusión (X vía `tweet.yml`) y los backlinks son ahora la palanca
  principal; el SEO técnico ya está resuelto.
