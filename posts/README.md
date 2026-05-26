# Posts diarios (Twitter/X)

Archivo permanente de cada tweet diario generado por `post_tweet.py` y publicado por el workflow `.github/workflows/tweet.yml` (cron `0 10 * * *`).

Cada subcarpeta contiene:
- `card.png` — la imagen del tweet
- `content.txt` — el texto exacto que se publica

Formato: `YYYY-MM-DD-tweet-N/` donde `N` es el `run_number` del workflow que lo generó (mismo número que el artifact `tweet-del-dia-N` en GitHub Actions).

Esta carpeta está **excluida del build de Astro** (ver `paths-ignore` en `deploy.yml`), así que añadir un post nuevo no redeploys la web.
