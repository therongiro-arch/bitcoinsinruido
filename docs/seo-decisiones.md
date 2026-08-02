# Decisiones SEO de Bitcoin Sin Ruido

> Documento de referencia de la arquitectura de contenidos y las decisiones SEO
> tomadas. Sirve para no repetir errores ya resueltos y para que cualquiera
> (humano o agente) entienda el porqué de la estructura actual.
>
> Última actualización: 2026-08-02.

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

> ⚠️ **Las exclusiones del sitemap se comparan por RUTA EXACTA, nunca con
> `includes()`.** El filtro original usaba subcadenas y el patrón
> `/articulos/taproot` capturaba también `/articulos/taproot-assets/` — una
> página legítima (200, canonical propio, 32 enlaces internos) que llevaba meses
> fuera del sitemap por colisión de prefijo. Corregido en el PR #33: el filtro
> normaliza a `pathname` sin barra final y compara contra un `Set`, de forma que
> es independiente de `site` y de `trailingSlash`.
>
> **`/articulos/taproot-assets/` NO es una variante canonicalizada**: es una
> página con entidad propia y debe estar en el sitemap. Solo
> `/articulos/lightning-network/` y `/articulos/taproot/` se excluyen.

---

## 5. Política de URLs

### Barra final (`trailingSlash`)
- `astro.config.mjs` → `trailingSlash: 'always'`.
- Cloudflare Pages sirve las páginas (formato directorio) **con barra final** y
  redirige (308) las versiones sin barra.
- `BaseLayout` **normaliza el canonical a barra final** (cubre también páginas
  que lo hardcodean), para que canonical, hreflang, og:url y sitemap apunten
  siempre a la URL 200 y no a una que redirige.
- **Todo enlace interno termina en `/`.** (Política vigente desde el PR #34,
  ago-2026. Revierte la decisión anterior.)

> **Por qué se revirtió.** La versión anterior de este documento decía: *"No se
> añadió barra final a los enlaces internos: solo generan avisos de redirección
> (no errores) y el valor real es nulo a esta escala"*. **El valor no era nulo.**
> El sitio tenía **954 enlaces internos** (64 ficheros) apuntando a la forma sin
> barra, que responde 308. Eso mantenía abierto un ciclo: el sitio enlaza a la
> URL que redirige → Google la descubre y la rastrea → durante la ventana previa
> a consolidar la muestra en resultados como si fuera una página propia.
>
> El coste era medible en **páginas nuevas**: `/comercios-que-aceptan-bitcoin/`,
> publicada en julio de 2026, compitió consigo misma durante ~2 semanas sobre 5
> queries compartidas antes de que Google consolidara. Se habría repetido con
> cada artículo nuevo.
>
> Google confirmaba el mecanismo él mismo: en la URL Inspection API, las
> `referringUrls` de la variante sin barra eran páginas del propio sitio.
>
> Verificado tras el PR #34: 51 enlaces internos únicos muestreados en 6 páginas,
> **todos 200 directo, cero redirecciones**.

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
- **⚠️ `bitcoinsinruido.pages.dev` es público e indexable.** Es el dominio de
  Cloudflare Pages y sirve el sitio entero, con un `robots.txt` permisivo
  (`Allow: /`). **Mitigado**: el `canonical` y el sitemap que sirve apuntan al
  dominio real (`bitcoinsinruidos.com`), que es la defensa correcta entre
  dominios. Riesgo residual bajo, pero conviene saberlo — no aparece en los datos
  de GSC porque la propiedad es `sc-domain:bitcoinsinruidos.com` y no cubre
  `pages.dev`.

---

## 9. Google Search Console

- Sitemap enviado y "Correcto". **62 URLs** desde el PR #33 (antes 61).
- Indexación solicitada manualmente para los pilares en su forma canónica
  (no-www, con barra final).
- FAQs y breadcrumbs reconocidos como datos estructurados válidos.
- **Forma canónica de toda URL:** `https://bitcoinsinruidos.com/<ruta>/`
  (no-www, con barra final). Usar siempre esta forma al pedir indexación.

### ⚠️ Cómo verificar duplicados de URL (leer antes de diagnosticar)

**El informe de Rendimiento NO sirve para diagnosticar duplicados.** Es un
histórico *inmutable* de qué URL se mostró en la SERP cada día: GSC no reescribe
el pasado cuando Google consolida después. Agregar un rango largo mezcla épocas
distintas del sitio y hace aparecer como "duplicados vivos" URLs que Google
fusionó hace meses.

Para saber si un duplicado sigue vivo, usar la **URL Inspection API**:

```bash
python scripts/gsc/gsc.py inspect https://bitcoinsinruidos.com/<ruta>
```

y leer dos campos:

| Campo | Qué significa |
|---|---|
| `coverageState: "Página con redirección"` | Estado de **NO indexación** → el duplicado está resuelto |
| `coverageState: "Enviada e indexada"` | Es la URL que Google tiene indexada |
| `googleCanonical` | La URL que Google considera canónica de verdad |

Contrastar además con `curl` en producción (código de estado real y
`<link rel="canonical">` servido) y con la distribución temporal por mes: si las
impresiones anómalas decaen mes a mes, la consolidación está ocurriendo.

> **Origen de esta nota (ago-2026).** Un análisis basado solo en el informe de
> Rendimiento concluyó que había 15 pares de URLs duplicadas sin consolidar,
> incluido un caso aparentemente flagrante (`/que-es-bitcoin` sin barra en
> posición 2 frente a la canónica en posición 45). Era falso: esas 4 impresiones
> eran **todas de un único día**, el 28-may, dos días antes del fix de
> `trailingSlash`; las dos variantes no compartían ninguna query; y producción
> devolvía un 308 limpio. La mala posición media de la canónica la causaba que el
> 71 % de sus impresiones venían de `bitcoin system`, una query de ruido en
> inglés donde rankea en posición 43.

---

## 10. Checklist al crear contenido nuevo

- [ ] Asignar el artículo a un silo y enlazar a su **pilar** + 2-3 relacionados.
- [ ] `capa` correcta; `draft: false` solo tras revisión.
- [ ] `faqs` con preguntas reales (genera rich snippets).
- [ ] `related` con slugs MDX existentes; enlaces a pilares `.astro` inline.
- [ ] Título con keyword al principio (la marca se gestiona sola).
- [ ] Enlazar el artículo **desde** su pilar (interlinking bidireccional).
- [ ] No crear una URL que canibalice una keyword ya cubierta (ver sección 4).
- [ ] **Todos los enlaces internos terminan en `/`** (ver sección 5).
- [ ] `npx astro check` sin errores antes de PR.

---

## 11. Pendientes / próximos pasos

### ✅ Cerrado (ago-2026)

- **Consolidación de duplicados: CONFIRMADA.** Verificado con URL Inspection
  (`coverageState: "Página con redirección"` + `googleCanonical` correcto en
  todas las variantes comprobadas) y con la evolución mensual de impresiones:

  | Mes | Canónicas | Sin barra | Con www |
  |---|---|---|---|
  | 2026-05 | 21 | 4 | 22 |
  | 2026-06 | 219 | 29 | 41 |
  | 2026-07 | 693 | 35 | **1** |

  La Page Rule de www funcionó y Google ya lo digirió. *(Nota: este desglose usa
  la dimensión* página *de GSC, cuyo total difiere del total por* fecha *— es
  comportamiento normal de la API.)*
- **Barra final en enlaces internos: HECHO** (PR #34). Ya no era "cosmético" —
  ver sección 5.
- **Bug del filtro del sitemap: CORREGIDO** (PR #33) — ver sección 4.

### Abierto

- **Re-auditar en Semrush** tras el recrawl.
- **Deuda técnica de CI:** las GitHub Actions avisan de deprecación de Node 20
  (`actions/checkout@v4`, `setup-node@v4`, `wrangler-action@v3` corriendo
  forzados en Node 24). No rompe nada hoy. Pendiente de un PR de mantenimiento
  propio — **no** mezclarlo con cambios de contenido o SEO.
- **Entorno local desactualizado:** `npx astro check` da 3 errores
  `Cannot find module 'leaflet'` en `src/components/react/MerchantFinder.tsx`.
  La dependencia **sí está** en `package.json` (`^1.9.4`); falta en el
  `node_modules` local. Mismo patrón que el desajuste `three`/`globe.gl`. Se
  arregla con `npm install`; CI compila bien. **No es una regresión**: el
  baseline de `main` tiene los mismos 3 errores.
- La difusión (X vía `tweet.yml`) y los backlinks son ahora la palanca
  principal; el SEO técnico está resuelto.

### Oportunidad de contenido detectada en GSC (ago-2026)

El cluster **"aceptan bitcoin"** (`sitios/lugares/donde aceptan bitcoin`) suma
**262 impresiones** — con diferencia el tema de mayor demanda del sitio — pero
rankea en posiciones 50-65. Todas las variantes aterrizan en
`/comercios-que-aceptan-bitcoin/`. La intención de búsqueda está muy alineada con
el contenido: el freno es **autoridad/posición, no relevancia**. Candidato
prioritario para enlaces internos y backlinks.

---

## 12. Auditoría GEO (2026-06-18)

Auditoría de *Generative Engine Optimization* (visibilidad/citabilidad en
ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini). El sitio partía de
una base muy sólida (JSON-LD por página, FAQs en las 34 MDX y en pilares,
`llms.txt`, `robots.txt` con todos los bots de IA, E-E-A-T editorial). Se
resolvieron tres incoherencias que afectaban a cómo un motor generativo atribuye
y desambigua las entidades:

1. **Coherencia canonical ↔ JSON-LD (barra final).** Con `trailingSlash: 'always'`
   la URL 200 termina en `/`, pero el JSON-LD (`url`, `@id`, `mainEntityOfPage`,
   `BreadcrumbList.item`) y el `ItemList` del home usaban URLs **sin** barra. Era
   el mismo arreglo ya aplicado solo a Lightning (commit `d0c90bf`), extendido
   ahora a las 21 páginas `.astro`, a `ArticleLayout` (34 artículos MDX), a los
   breadcrumbs de comparativas y al `SearchAction` de `WebSite`. Un LLM que cita
   debe ver la misma URL en el canonical y en el dato estructurado.

2. **Entidad `Person` del editor (`#editor`) era un nodo colgante.** Se
   referenciaba desde `Organization.employee`, desde `ArticleLayout` y desde
   varios pilares (`@id: …/sobre#editor`) pero **no se definía en ninguna parte**.
   Se añade el `Person` completo en `/sobre/` (jobTitle, `knowsAbout`,
   `knowsLanguage`, `worksFor` → `#organization`, `sameAs`, `publishingPrinciples`),
   con `@id` idéntico al ancla visible `<h2 id="editor">`. Cierra el grafo de
   autoría que sostiene el E-E-A-T para IA.

3. **Autoría unificada en pilares.** Varias páginas usaban `Person` inline sin
   `@id`, y `escalabilidad`/`futuro` usaban `Organization` como `author`. Todas
   apuntan ahora al mismo `@id …/sobre#editor`: una sola entidad-autor coherente
   en todo el sitio.

También se ampió `llms.txt` con las 5 comparativas individuales y las páginas de
análisis (anatomía de transacción, mapa del stack), que antes solo existían como
índice.

**No tocado (correcto):** dominio `bitcoinsinruidos.com` consistente, `robots.txt`,
silos e interlinking, FAQs. **Pendiente menor:** `sobre-bitcoin-sin-ruido.astro`
usa meta-refresh + `noindex` (funcional; un 301 en `_redirects` sería más limpio).
