# Hilos semanales (Twitter/X)

Archivo permanente de cada hilo semanal generado por `generate_thread.py` y publicado por el workflow `.github/workflows/tweet.yml` (cron `0 9 * * 1` — lunes).

Cada subcarpeta contiene:
- `card.png` — la imagen del primer tweet del hilo
- `content.txt` — el texto completo del hilo, tweet a tweet, con headers de cada uno

Formato: `YYYY-MM-DD-hilo-N/` donde `N` es el `run_number` del workflow que lo generó (mismo número que el artifact `hilo-semanal-N` en GitHub Actions).

Esta carpeta está **excluida del build de Astro** (ver `paths-ignore` en `deploy.yml`), así que añadir un hilo nuevo no redeploys la web.
