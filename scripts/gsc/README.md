# gsc — Cliente CLI de Google Search Console

Lee datos de Search Console desde la línea de comandos vía la API oficial,
usando una *service account*. Pensado para uso ad-hoc y reproducible (sin
exportar CSV manualmente cada vez).

## Setup (una sola vez)

El script detecta automáticamente el tipo de credencial. Dos modos:

### Modo OAuth (recomendado)

Usa **tu propia cuenta de Google** (la que es propietaria en GSC). No requiere
añadir usuarios extra a GSC. La primera vez abre el navegador para autorizar
y guarda un token con `refresh_token` para futuras llamadas (sin intervención).

1. En Google Cloud Console (mismo proyecto donde habilitaste la
   **Search Console API**):
   - Configurar **Pantalla de consentimiento de OAuth** (Externo, modo Testing,
     añadiéndote a ti como *tester*).
   - **Credenciales → Crear → ID de cliente de OAuth 2.0**, tipo
     **Aplicación de escritorio**.
   - Descargar el JSON.
2. Coloca el JSON descargado en:
   ```
   ~/.gsc-credentials/oauth-client.json
   ```
   (En Windows: `C:\Users\<tu_usuario>\.gsc-credentials\oauth-client.json`)
3. Instala dependencias:
   ```bash
   python -m pip install -r scripts/gsc/requirements.txt
   ```
4. Primera ejecución (cualquier comando) abrirá el navegador → autoriza → se
   guarda `~/.gsc-credentials/oauth-token.json`. A partir de aquí, sin
   interacción.

### Modo service account (alternativa)

Útil para ejecución no-interactiva o en CI. Requiere añadir el email de la
service account como usuario de la propiedad GSC (a veces GSC lo rechaza con
"correo no encontrado": en ese caso, usa OAuth).

1. Crear service account, descargar JSON, colocarlo en:
   ```
   ~/.gsc-credentials/bitcoinsinruidos-gsc.json
   ```
2. Añadir el email de la SA como usuario "Restringido" en GSC →
   Ajustes → Usuarios y permisos.

### Detección automática

El script busca en este orden:
1. `--credentials` / `GSC_CREDENTIALS` si están definidos.
2. `~/.gsc-credentials/oauth-client.json` (OAuth).
3. `~/.gsc-credentials/bitcoinsinruidos-gsc.json` (service account).

> Las credenciales **nunca se versionan**. Viven fuera del repo (en
> `~/.gsc-credentials/`). Si se filtran, rota en Google Cloud.

## Uso

Listar los sitios accesibles para esta service account (sirve para descubrir
el `siteUrl` exacto):
```bash
python scripts/gsc/gsc.py sites
```

Consultar Search Analytics — top queries de los últimos 28 días:
```bash
python scripts/gsc/gsc.py query --days 28 --dim query --limit 30
```

Top páginas:
```bash
python scripts/gsc/gsc.py query --days 28 --dim page --limit 30
```

Cruzar query × página:
```bash
python scripts/gsc/gsc.py query --days 28 --dim query,page --limit 50
```

Serie temporal:
```bash
python scripts/gsc/gsc.py query --days 28 --dim date
```

Rango personalizado:
```bash
python scripts/gsc/gsc.py query --start 2026-05-01 --end 2026-05-31 --dim query
```

Sitemaps registrados:
```bash
python scripts/gsc/gsc.py sitemaps
```

Inspeccionar una URL:
```bash
python scripts/gsc/gsc.py inspect https://bitcoinsinruidos.com/que-es-bitcoin/
```

## Overrides útiles

- `GSC_CREDENTIALS=/ruta/al/json` — usar otro fichero de credenciales.
- `GSC_SITE=sc-domain:otrodominio.com` — apuntar a otra propiedad.
- Flags `--credentials` y `--site` equivalentes en cada invocación.

## Dimensiones soportadas

`query`, `page`, `date`, `country`, `device`, `searchAppearance`.
Se combinan separadas por coma: `--dim query,page,device`.

## Latencia

GSC suele tener ~2 días de retraso en los datos. El default `--days 28`
termina hoy − 2 para coger un rango "estable". Para datos más recientes,
usa `--start`/`--end` explícitos.

## Notas de seguridad

- La service account está creada con **rol "Restringido"** en GSC →
  permite **solo lectura**.
- Si se sospecha de compromiso del JSON, rotar en Google Cloud:
  Service Account → Claves → eliminar la actual y crear una nueva.
