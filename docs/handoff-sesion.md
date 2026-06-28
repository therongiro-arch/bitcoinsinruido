# Handoff de sesión — Bitcoin Sin Ruido

> Documento para **retomar el trabajo en una sesión nueva** sin perder contexto.
> Léelo entero al empezar, junto con `docs/seo-decisiones.md`.
>
> Última actualización: junio 2026.

---

## ⏱️ Lo primero al retomar (acción inmediata)

La herramienta de Google Search Console necesita **una re-autorización** (el token caducó; la app OAuth ya se publicó a Producción, así que el nuevo token será permanente):

```bash
rm -f ~/.gsc-credentials/oauth-token.json
python scripts/gsc/gsc.py sites
```

Esto abre el navegador del usuario → autoriza con `therongiro@gmail.com` (pantalla "Google no verificó esta app" → **Configuración avanzada → Continuar**) → guarda un token ya permanente. A partir de ahí se pueden sacar datos frescos.

Luego, sacar el snapshot:
```bash
python scripts/gsc/gsc.py query --days 28 --dim query --limit 40
python scripts/gsc/gsc.py query --days 28 --dim query,page --limit 40
python scripts/gsc/gsc.py query --days 28 --dim page --limit 50
```

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

## 4. Estado del SEO técnico (TODO HECHO)

- ✅ 301 `/bitcoin-explicado` → `/que-es-bitcoin/` (página redundante eliminada).
- ✅ Canonical cruzado: `/articulos/lightning-network` y `/articulos/taproot` → pilares raíz; excluidos del sitemap.
- ✅ `trailingSlash: 'always'` + normalización de canonical en BaseLayout.
- ✅ **301 www→no-www**: Page Rule en el panel de Cloudflare (`www.bitcoinsinruidos.com/*` → `https://bitcoinsinruidos.com/$1`, 301). **NO vive en el repo** — recrear si se reconfigura Cloudflare.
- ✅ hreflang reducido a `es` + `x-default`.
- ✅ Política de títulos: BaseLayout elimina el sufijo " | Bitcoin Sin Ruido" cuando el título total supera 70 caracteres (mantiene keyword visible).
- ✅ `public/llms.txt` para buscadores de IA. Sitemap enviado en GSC.
- ✅ Optimización CTR de 8 páginas top ~15 (títulos con número/hook + meta-descripciones tipo "ad" de SERP).

## 5. Contenido publicado

~24 artículos. Destacan piezas largas y profundas (4.000-7.000 palabras):
- **Estafas en Bitcoin** (`/articulos/estafas-en-bitcoin/`) — ~5.500 palabras.
- **Bitcoin vs oro** (`/articulos/bitcoin-vs-oro/`) — ~5.100 palabras.
- **Bitcoin e inteligencia artificial** (`/articulos/bitcoin-e-inteligencia-artificial/`) — ~4.000 palabras.

El agente `.claude/agents/content-research.md` está **actualizado para contenido largo** (4.000-7.000 palabras como formato por defecto de piezas profundas).

## 6. Datos de GSC (último snapshot, ~8-16 jun 2026)

- ~**181 impresiones, 3 clics**, mayoría en **posiciones >30**. Home pos ~3,8.
- Reto actual: **convertir impresiones en clics** → palanca = títulos/meta + empujar contenido en queries que rozan top 15.
- Mercado real: **España** (señal incipiente en Venezuela). Las queries en **inglés** (tráfico USA) son **ruido** → ignorar.
- Sitio con ~1 mes → posiciones de partida buenas; falta tiempo, clics y backlinks.

## 7. Próximos pasos

1. **Re-autorizar GSC** (sección de arriba) y sacar datos frescos.
2. Seguir con CTR: títulos/meta de páginas en top ~15; empujar contenido en queries cercanas.
3. Publicar **1-2 artículos/semana** en huecos de silo (no a volumen) + difusión en X (`tweet.yml`).
4. Re-auditar en Semrush tras recrawl; verificar consolidación de duplicados www/slash.
5. **No** reoptimizar por 1-3 impresiones; **no** perseguir queries en inglés.

## 8. Flujo de trabajo y notas técnicas

- **Ciclo:** rama por cambio → `npx astro check` (0 errores) → PR → CI verde (`build-and-deploy`) → `gh pr merge <n> --squash` → deploy automático → verificar en producción con `curl` **usando cache-bust** `?cb=$(date +%s)` (la caché de Cloudflare tarda minutos en refrescar).
- **Build local:** `npm run build` falla en local por desajuste `three`/`globe.gl` (solo local; CI compila bien). Validar con `npx astro check`.
- **Credenciales:** siempre en `~/.gsc-credentials/` (fuera del repo, gitignored). Nunca versionar secretos.
- **Entorno:** Windows; usar la herramienta Bash con sintaxis POSIX o PowerShell según convenga.
