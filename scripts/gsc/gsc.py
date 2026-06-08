#!/usr/bin/env python3
"""
Cliente CLI para Google Search Console — Bitcoin Sin Ruido.

Lee datos de GSC desde la línea de comandos vía la API oficial, usando una
service account. Diseñado para uso ad-hoc y reproducible desde Claude Code.

CREDENCIALES
    Por defecto lee el JSON de:
        ~/.gsc-credentials/bitcoinsinruidos-gsc.json
    Override:
        - Variable de entorno  GSC_CREDENTIALS=/ruta/al/json
        - Flag  --credentials /ruta/al/json

SITIO
    Por defecto:  sc-domain:bitcoinsinruidos.com  (propiedad de Dominio).
    Override:
        - Variable de entorno  GSC_SITE=...
        - Flag  --site ...

USO
    python gsc.py sites
    python gsc.py query --days 28
    python gsc.py query --days 28 --dim query --limit 20
    python gsc.py query --days 28 --dim page --limit 30
    python gsc.py query --days 28 --dim query,page
    python gsc.py query --start 2026-05-01 --end 2026-05-31 --dim date
    python gsc.py sitemaps
    python gsc.py inspect https://bitcoinsinruidos.com/que-es-bitcoin/
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

try:
    import requests
    from google.oauth2 import service_account
    from google.oauth2.credentials import Credentials as UserCredentials
    from google.auth.transport.requests import Request as GoogleAuthRequest
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError as e:
    sys.stderr.write(
        "ERROR: faltan dependencias.\n"
        "Instala con:  python -m pip install -r scripts/gsc/requirements.txt\n"
        f"Detalle: {e}\n"
    )
    sys.exit(2)


SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]
API_ROOT = "https://searchconsole.googleapis.com"
CRED_DIR = Path.home() / ".gsc-credentials"
SA_PATH = CRED_DIR / "bitcoinsinruidos-gsc.json"             # service account
OAUTH_CLIENT_PATH = CRED_DIR / "oauth-client.json"           # OAuth client_secret
OAUTH_TOKEN_PATH = CRED_DIR / "oauth-token.json"             # cached user token
DEFAULT_SITE = "sc-domain:bitcoinsinruidos.com"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def load_credentials(override_path: str | None):
    """
    Carga credenciales con detección automática:
      1. Si --credentials / GSC_CREDENTIALS apunta a un fichero → usa ese.
      2. Si existe ~/.gsc-credentials/oauth-client.json → OAuth (preferido).
      3. Si existe ~/.gsc-credentials/bitcoinsinruidos-gsc.json → service account.
    Devuelve un objeto credenciales válido para refrescar tokens.
    """
    env_path = os.environ.get("GSC_CREDENTIALS")
    explicit = Path(override_path) if override_path else (Path(env_path) if env_path else None)

    if explicit:
        return _load_from_path(explicit)

    if OAUTH_CLIENT_PATH.is_file():
        return _load_oauth(OAUTH_CLIENT_PATH, OAUTH_TOKEN_PATH)

    if SA_PATH.is_file():
        return service_account.Credentials.from_service_account_file(str(SA_PATH), scopes=SCOPES)

    sys.stderr.write(
        "ERROR: no se encontró ningún archivo de credenciales.\n"
        f"Coloca uno de estos en {CRED_DIR}/:\n"
        f"  - oauth-client.json     (OAuth, recomendado)\n"
        f"  - bitcoinsinruidos-gsc.json   (service account)\n"
        "O exporta GSC_CREDENTIALS con la ruta a un JSON válido.\n"
    )
    sys.exit(2)


def _load_from_path(p: Path):
    """Carga un fichero JSON y detecta si es SA o OAuth client por su 'type'."""
    if not p.is_file():
        sys.stderr.write(f"ERROR: no existe el archivo de credenciales: {p}\n")
        sys.exit(2)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        sys.stderr.write(f"ERROR: JSON inválido en {p}: {e}\n")
        sys.exit(2)
    if data.get("type") == "service_account":
        return service_account.Credentials.from_service_account_file(str(p), scopes=SCOPES)
    if "installed" in data or "web" in data:
        return _load_oauth(p, OAUTH_TOKEN_PATH)
    sys.stderr.write(f"ERROR: tipo de credenciales no reconocido en {p}\n")
    sys.exit(2)


def _load_oauth(client_secrets_path: Path, token_cache_path: Path) -> UserCredentials:
    """
    Carga (o crea, primera vez) un token OAuth de usuario.
    Primera ejecución: abre navegador para autorizar.
    Siguientes: usa el refresh token cacheado.
    """
    creds: UserCredentials | None = None
    if token_cache_path.is_file():
        try:
            creds = UserCredentials.from_authorized_user_file(str(token_cache_path), SCOPES)
        except Exception:
            creds = None

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(GoogleAuthRequest())
    else:
        flow = InstalledAppFlow.from_client_secrets_file(str(client_secrets_path), SCOPES)
        # run_local_server abre el navegador, escucha en un puerto libre y captura el callback.
        creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")

    token_cache_path.parent.mkdir(parents=True, exist_ok=True)
    token_cache_path.write_text(creds.to_json(), encoding="utf-8")
    try:
        os.chmod(token_cache_path, 0o600)  # restringir lectura (best effort en Windows)
    except Exception:
        pass
    return creds


def authed_session(creds) -> requests.Session:
    """Devuelve una sesión de requests con el access token ya inyectado."""
    if not creds.valid:
        creds.refresh(GoogleAuthRequest())
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {creds.token}"
    s.headers["Accept"] = "application/json"
    return s


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def list_sites(session: requests.Session) -> list[dict]:
    r = session.get(f"{API_ROOT}/webmasters/v3/sites")
    r.raise_for_status()
    return r.json().get("siteEntry", [])


def list_sitemaps(session: requests.Session, site: str) -> list[dict]:
    r = session.get(f"{API_ROOT}/webmasters/v3/sites/{requests.utils.quote(site, safe='')}/sitemaps")
    r.raise_for_status()
    return r.json().get("sitemap", [])


def search_analytics_query(
    session: requests.Session,
    site: str,
    start_date: str,
    end_date: str,
    dimensions: list[str],
    row_limit: int = 1000,
    search_type: str = "web",
) -> list[dict]:
    body = {
        "startDate": start_date,
        "endDate": end_date,
        "dimensions": dimensions,
        "rowLimit": row_limit,
        "type": search_type,
    }
    r = session.post(
        f"{API_ROOT}/webmasters/v3/sites/{requests.utils.quote(site, safe='')}/searchAnalytics/query",
        json=body,
    )
    r.raise_for_status()
    return r.json().get("rows", [])


def url_inspection(session: requests.Session, site: str, inspection_url: str) -> dict:
    body = {
        "inspectionUrl": inspection_url,
        "siteUrl": site,
        "languageCode": "es-ES",
    }
    r = session.post(f"{API_ROOT}/v1/urlInspection/index:inspect", json=body)
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Formato de salida
# ---------------------------------------------------------------------------

def fmt_rows_table(rows: list[dict], dimensions: list[str]) -> str:
    if not rows:
        return "(sin filas)"
    headers = list(dimensions) + ["clicks", "impr", "ctr", "pos"]
    out_rows: list[list[str]] = []
    for row in rows:
        keys = row.get("keys", [])
        out_rows.append(
            [*[str(k) for k in keys],
             str(row.get("clicks", 0)),
             str(row.get("impressions", 0)),
             f"{row.get('ctr', 0) * 100:.2f}%",
             f"{row.get('position', 0):.2f}"]
        )
    widths = [max(len(h), *(len(r[i]) for r in out_rows)) for i, h in enumerate(headers)]
    sep = "  "
    lines = [sep.join(h.ljust(widths[i]) for i, h in enumerate(headers))]
    lines.append(sep.join("-" * widths[i] for i in range(len(headers))))
    for r in out_rows:
        lines.append(sep.join(c.ljust(widths[i]) for i, c in enumerate(r)))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Comandos
# ---------------------------------------------------------------------------

def cmd_sites(args: argparse.Namespace) -> int:
    creds = load_credentials(args.credentials)
    s = authed_session(creds)
    sites = list_sites(s)
    if not sites:
        print("(sin sitios accesibles para esta service account)")
        return 0
    for site in sites:
        print(f"{site.get('permissionLevel', '?'):>18}  {site.get('siteUrl')}")
    return 0


def cmd_query(args: argparse.Namespace) -> int:
    creds = load_credentials(args.credentials)
    s = authed_session(creds)

    if args.start and args.end:
        start, end = args.start, args.end
    else:
        end_d = date.today() - timedelta(days=2)   # GSC suele tener latencia de ~2 días
        start_d = end_d - timedelta(days=args.days - 1)
        start, end = start_d.isoformat(), end_d.isoformat()

    dims = [d.strip() for d in args.dim.split(",") if d.strip()]
    rows = search_analytics_query(
        s,
        site=args.site,
        start_date=start,
        end_date=end,
        dimensions=dims,
        row_limit=args.limit,
        search_type=args.search_type,
    )
    print(f"# site={args.site}  rango={start}..{end}  dims={','.join(dims)}  n={len(rows)}")
    print(fmt_rows_table(rows, dims))
    return 0


def cmd_sitemaps(args: argparse.Namespace) -> int:
    creds = load_credentials(args.credentials)
    s = authed_session(creds)
    sitemaps = list_sitemaps(s, args.site)
    if not sitemaps:
        print(f"(sin sitemaps registrados en {args.site})")
        return 0
    for sm in sitemaps:
        print(
            f"{sm.get('path')}\n"
            f"  type={sm.get('type')}  pending={sm.get('isPending')}  "
            f"errors={sm.get('errors', 0)}  warnings={sm.get('warnings', 0)}  "
            f"lastSubmitted={sm.get('lastSubmitted')}  lastDownloaded={sm.get('lastDownloaded')}"
        )
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    creds = load_credentials(args.credentials)
    s = authed_session(creds)
    data = url_inspection(s, args.site, args.url)
    print(json.dumps(data, indent=2, ensure_ascii=False))
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="gsc",
        description="Cliente CLI de Google Search Console (Bitcoin Sin Ruido).",
    )
    p.add_argument("--credentials", help="Ruta al JSON de la service account (override).")
    p.add_argument(
        "--site",
        default=os.environ.get("GSC_SITE") or DEFAULT_SITE,
        help=f"siteUrl en GSC (default: {DEFAULT_SITE}).",
    )

    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("sites", help="Lista los sitios accesibles para la service account.")
    sp.set_defaults(func=cmd_sites)

    sp = sub.add_parser("query", help="Consulta Search Analytics.")
    sp.add_argument("--days", type=int, default=28, help="Últimos N días (default 28).")
    sp.add_argument("--start", help="Fecha inicial YYYY-MM-DD (override --days).")
    sp.add_argument("--end", help="Fecha final YYYY-MM-DD (override --days).")
    sp.add_argument(
        "--dim",
        default="query",
        help="Dimensiones separadas por coma: query,page,date,country,device,searchAppearance.",
    )
    sp.add_argument("--limit", type=int, default=50, help="Máx filas (default 50, máx API 25000).")
    sp.add_argument("--search-type", default="web", help="web | image | video | news | discover.")
    sp.set_defaults(func=cmd_query)

    sp = sub.add_parser("sitemaps", help="Lista los sitemaps registrados.")
    sp.set_defaults(func=cmd_sitemaps)

    sp = sub.add_parser("inspect", help="Inspecciona una URL (URL Inspection API).")
    sp.add_argument("url", help="URL absoluta a inspeccionar.")
    sp.set_defaults(func=cmd_inspect)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except requests.HTTPError as e:
        body = ""
        try:
            body = e.response.text[:500] if e.response is not None else ""
        except Exception:
            pass
        sys.stderr.write(f"ERROR HTTP {e.response.status_code if e.response else '?'}: {e}\n{body}\n")
        return 1
    except Exception as e:
        sys.stderr.write(f"ERROR: {e}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
