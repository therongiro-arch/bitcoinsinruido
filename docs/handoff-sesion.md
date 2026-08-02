# Handoff de sesión — Bitcoin Sin Ruido

> Documento para **retomar el trabajo en una sesión nueva** sin perder contexto.
> Léelo entero al empezar, junto con `docs/seo-decisiones.md`.
>
> Última actualización: 2 de agosto de 2026.

---

## ⏱️ Lo primero al retomar

**El token de GSC funciona** — no hace falta re-autorizar nada (el bloque que
había aquí antes estaba obsoleto). Comprobación rápida:

```bash
python scripts/gsc/gsc.py sites     # debe devolver: siteOwner  sc-domain:bitcoinsinruidos.com
```

Snapshot de datos:
```bash
python scripts/gsc/gsc.py query --days 28 --dim query --limit 40
python scripts/gsc/gsc.py query --days 28 --dim query,page --limit 40
python scripts/gsc/gsc.py query --days 28 --dim page --limit 50
```

> ⚠️ **Para diagnosticar URLs duplicadas NO uses el informe de Rendimiento** —
> es un histórico de qué se mostró en la SERP, no un informe de indexación. Usa
> `gsc.py inspect <url>` y lee `coverageState` + `googleCanonical`. Está
> explicado en `docs/seo-decisiones.md` §9.

Si algún día el token sí caduca: borrar `~/.gsc-credentials/oauth-token.json` y
re-ejecutar `sites` reabre el navegador (autorizar con `therongiro@gmail.com`;
pantalla "Google no verificó esta app" → *Configuración avanzada → Continuar*).
La app OAuth ya está en Producción, así que el token nuevo es permanente.

---

## 1. Qué es el proyecto

- **bitcoinsinruidos.com** — web educativa en español sobre **Bitcoin técnico**, sin precio ni especulación. Público: España + LATAM.
- **Stack:** Astro (estático) + **Cloudflare Pages**. Deploy automático al merge a `main`. Repo: `therongiro-arch/bitcoinsinruido`.
- **Dos sistemas de contenido:**
  - Páginas `.astro` en `src/pages/` → URLs raíz (`/que-es-bitcoin/`, `/lightning-network/`, `/futuro-bitcoin/`…). Son los **pilares**.
  - Colección MDX en `src/content/articulos/` → `/articulos/<slug>/`. Aquí van los artículos nuevos.
  - Comparten `src/layouts/BaseLayout.astro`.

## 2. Documentos de referencia (leer)

- **`docs/seo-decisiones.md`** — todas las decisiones SEO (silos, canonical, trailing slash, www, títulos, hreflang, llms.txt). Fuente de verdad.
- **`scripts/gsc/README.md`** — cómo usar el cliente de GSC.
- Este archivo (`docs/handoff-sesion.md`) — estado y próximos pasos.

## 3. Arquitectura de silos

| Silo | Pilar | Satélites |
|---|---|---|
| 1. Base | `/que-es-bitcoin/` | historia, qué problema soluciona, por qué tiene valor, descentralización, vs dinero tradicional, blockchain, cómo funciona, UTXO, 21 millones, **vs oro** |
| 2. Tecnología | `/articulos/bitcoin-como-tecnologia/` | bloque, minería, hash, dificultad, halving, nodos, Proof of Work |
| 3. Escalabilidad/Futuro | `/futuro-bitcoin/` | Lightning, ventajas/desventajas LN, Taproot, escalabilidad, problemas y soluciones, BitVM/Citrea, covenants, BIP-360, **Bitcoin e IA** |
| 4. Uso/Seguridad | `/articulos/como-usar-bitcoin-seguro/` | wallet, tipos de wallets, enviar/recibir, clave privada, errores comunes, cómo proteger, **estafas** |

Regla: cada artículo enlaza a su pilar + 2-3 relacionados. Ningún artículo aislado.

## 4. Estado del SEO técnico

> El título anterior de esta sección era "**TODO HECHO**". Se cambió porque
> indujo a error: dio por cerrado el tema y ocultó dos fugas reales (los enlaces
> internos y el bug del sitemap) que se detectaron en agosto. **Esta sección
> lista lo hecho, no garantiza que no quede nada.**

### Verificado en producción (ago-2026)

- ✅ 301 `/bitcoin-explicado` → `/que-es-bitcoin/` (página redundante eliminada).
- ✅ Canonical cruzado: `/articulos/lightning-network` y `/articulos/taproot` → pilares raíz; excluidos del sitemap.
- ✅ `trailingSlash: 'always'` + normalización de canonical en BaseLayout. Comprobado: `curl` devuelve **308** limpio de la variante sin barra a la canónica.
- ✅ **301 www→no-www**: Page Rule en el panel de Cloudflare (`www.bitcoinsinruidos.com/*` → `https://bitcoinsinruidos.com/$1`, 301). **NO vive en el repo** — recrear si se reconfigura Cloudflare. Comprobado: cadena `www` → 301 → 308 → 200. Impresiones con www: 41 en junio → **1 en julio**.
- ✅ Google **ya consolidó** los duplicados: URL Inspection devuelve `coverageState: "Página con redirección"` y el `googleCanonical` correcto.
- ✅ hreflang reducido a `es` + `x-default`.
- ✅ Política de títulos: BaseLayout elimina el sufijo " | Bitcoin Sin Ruido" cuando el título total supera 70 caracteres (mantiene keyword visible).
- ✅ `public/llms.txt` para buscadores de IA. Sitemap enviado en GSC (**62 URLs**).
- ✅ Optimización CTR de 8 páginas top ~15 (títulos con número/hook + meta-descripciones tipo "ad" de SERP).
- ✅ **Enlaces internos con barra final** (PR #34, ago-2026): 954 enlaces en 64 ficheros. Verificado: 51 enlaces únicos muestreados, todos 200 directo, cero redirecciones.
- ✅ **Bug del filtro del sitemap corregido** (PR #33, ago-2026): `includes()` excluía `/articulos/taproot-assets/` por colisión de prefijo. Sitemap 61 → 62 URLs.

### Abierto

- ⬜ Deuda de CI: deprecación de Node 20 en las GitHub Actions. PR de mantenimiento aparte.
- ⬜ `bitcoinsinruido.pages.dev` es público e indexable (mitigado por canonical cross-domain). Ver `seo-decisiones.md` §8.
- ⬜ Re-auditar en Semrush tras el recrawl.

## 5. Contenido publicado

~24 artículos. Destacan piezas largas y profundas (4.000-7.000 palabras):
- **Estafas en Bitcoin** (`/articulos/estafas-en-bitcoin/`) — ~5.500 palabras.
- **Bitcoin vs oro** (`/articulos/bitcoin-vs-oro/`) — ~5.100 palabras.
- **Bitcoin e inteligencia artificial** (`/articulos/bitcoin-e-inteligencia-artificial/`) — ~4.000 palabras.

El agente `.claude/agents/content-research.md` está **actualizado para contenido largo** (4.000-7.000 palabras como formato por defecto de piezas profundas).

## 6. Datos de GSC (snapshot 26-may → 31-jul 2026, todo el histórico)

**Global:** 860 impresiones · 8 clics · CTR 0,93% · posición media ~40.

**Evolución semanal** (S1 = semana de lanzamiento):

| | S2 | S4 | S6 | S7 | S9 |
|---|---|---|---|---|---|
| Impresiones | 43 | 67 | 101 | **190** | 142 |

- **Las impresiones crecen con solidez** (pico de 190 en la semana del 7-jul); por meses, las impresiones canónicas van 21 → 219 → 693.
- **Los clics empiezan a moverse:** 4 de los 8 totales llegaron en las últimas 3 semanas de julio, tras un tramo de 3 semanas seguidas en cero.
- **La posición media sigue estancada** en la banda 30-46 desde la semana 2: el crecimiento viene de aparecer en más búsquedas, no de subir puestos.
- **Reto**: convertir impresiones en clics → títulos/meta + empujar contenido en queries que rozan el top 15.
- **Mercado real: España** (443 impr.), pero **México ya es señal** (114 impr.) y **Argentina tiene el mejor CTR** del sitio (3,70%, 27 impr.). Las queries en **inglés** siguen siendo ruido → ignorar.
- ⚠️ **`bitcoin system`** (84 impr., pos. 43) es un bot de trading ajeno al sitio: tráfico tipo "¿es esto una estafa?". Distorsiona la posición media de `/que-es-bitcoin/` (71% de sus impresiones). No perseguirlo salvo como pieza deliberada del silo de estafas.

## 7. Próximos pasos

1. **Reenviar el sitemap en GSC** para acelerar el redescubrimiento de `/articulos/taproot-assets/`, que llevaba meses fuera por el bug del filtro.
2. **Reforzar `/comercios-que-aceptan-bitcoin/`** con enlaces internos y backlinks: el cluster "aceptan bitcoin" (262 impresiones) es la mayor demanda del sitio y rankea en posiciones 50-65. Ver `seo-decisiones.md` §11.
3. Seguir con CTR: títulos/meta de páginas en top ~15.
4. Publicar **1-2 artículos/semana** en huecos de silo (no a volumen) + difusión en X (`tweet.yml`).
5. Re-auditar en Semrush tras el recrawl.
6. **No** reoptimizar por 1-3 impresiones; **no** perseguir queries en inglés.

## 8. Flujo de trabajo y notas técnicas

- **Ciclo:** rama por cambio → `npx astro check` → PR → CI verde (`build-and-deploy`) → `gh pr merge <n> --squash` → deploy automático → verificar en producción con `curl` **usando cache-bust** `?cb=$(date +%s)` (la caché de Cloudflare tarda minutos en refrescar).
- **Entorno local desactualizado** (no es una regresión, `main` tiene el mismo baseline):
  - `npm run build` falla por desajuste `three`/`globe.gl`.
  - `npx astro check` da **3 errores** `Cannot find module 'leaflet'` en `src/components/react/MerchantFinder.tsx`. La dependencia sí está en `package.json`; falta en `node_modules`.
  - Ambos se arreglan con `npm install`. **CI compila bien en los dos casos.** Al validar con `astro check`, comparar contra el baseline de `main` (`git stash`) en vez de exigir 0 errores.
- **Verificar el sitemap** tras tocar su filtro: comparar el sitemap del deploy de preview del PR contra el de producción y revisar el delta, en vez de fiarse del recuento.
- **Credenciales:** siempre en `~/.gsc-credentials/` (fuera del repo, gitignored). Nunca versionar secretos.
- **Entorno:** Windows; usar la herramienta Bash con sintaxis POSIX o PowerShell según convenga.
