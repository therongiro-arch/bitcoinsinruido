"""
Bitcoin Sin Ruido — Auto-publisher para X (Twitter)
Requiere: pip install tweepy python-dotenv pillow

Credenciales en .env:
  TWITTER_CONSUMER_KEY=...
  TWITTER_CONSUMER_SECRET=...
  TWITTER_ACCESS_TOKEN=...
  TWITTER_ACCESS_TOKEN_SECRET=...

Uso:
  python post_tweet.py              # publica el siguiente tweet de la cola
  python post_tweet.py --preview    # muestra sin publicar
"""

import tweepy
import os
import sys
import json
import random
import tempfile
from datetime import datetime
from dotenv import load_dotenv
from generate_image import generate_card

load_dotenv()

# ── Credenciales ───────────────────────────────────────────────
CONSUMER_KEY        = os.getenv("TWITTER_CONSUMER_KEY")
CONSUMER_SECRET     = os.getenv("TWITTER_CONSUMER_SECRET")
ACCESS_TOKEN        = os.getenv("TWITTER_ACCESS_TOKEN")
ACCESS_TOKEN_SECRET = os.getenv("TWITTER_ACCESS_TOKEN_SECRET")

# ── Cola de tweets educativos sobre Bitcoin ────────────────────
TWEETS = [
    # UTXOs
    """Bitcoin no usa saldo como un banco.

Usa UTXOs.

Piensa en billetes:
No tienes 50€, tienes 2×20€ + 1×10€.

Cuando pagas, gastas billetes completos y recibes cambio.

Así funciona Bitcoin. Sin banco. Sin intermediario.""",

    # Proof of Work
    """¿Cómo protege Bitcoin sus transacciones?

Con energía real.

Los mineros gastan electricidad para añadir bloques.
Reescribir el historial costaría más energía que la que consumen países enteros.

No hay banco central. La seguridad es física.""",

    # 21 millones
    """21.000.000 de Bitcoin.

No es una promesa.
Es código matemático.

Cada ~4 años la recompensa de minería se reduce a la mitad.
La suma de esa serie converge exactamente en 21M.

Ningún CEO puede cambiarlo.
Ningún gobierno puede imprimirlos.""",

    # Nodos
    """¿Quién controla Bitcoin?

Nadie. Y todos.

Hay ~20.000 nodos activos en el mundo.
Cada uno guarda una copia completa y verifica cada transacción.

Si un minero viola las reglas, los nodos lo rechazan automáticamente.

El poder real no está en los mineros — está en los nodos.""",

    # Lightning Network
    """Bitcoin es lento para pagos del día a día.

Lightning Network lo resuelve.

Abre un "canal" con alguien.
Haz miles de pagos instantáneos y baratos dentro de ese canal.
Cuando cierras, solo eso va a la blockchain.

Cash App vio un crecimiento de 7x en Lightning durante 2024.""",

    # Taproot
    """Taproot: la mejora más importante de Bitcoin en años.

Activada en 2021. Casi nadie la entiende.

Introduce firmas Schnorr:
→ Transacciones más pequeñas
→ Más privadas
→ Más baratas

La privacidad no es un lujo. Es parte del protocolo.""",

    # Halving
    """El halving de Bitcoin no es un evento.

Es una ley matemática.

Cada ~4 años, la recompensa por minar un bloque se divide a la mitad.

Menos Bitcoin nuevo → misma demanda → escasez programada.

No hay comité que lo vote. Está en el código.""",

    # BitVM
    """BitVM: contratos inteligentes en Bitcoin.

Sin modificar el protocolo base.

En enero de 2026, Citrea lanzó el primer ZK-rollup sobre Bitcoin en mainnet.

Agrupa miles de transacciones y las verifica con una prueba matemática compacta.

Bitcoin evoluciona sin perder lo que lo hace seguro.""",

    # BIP-360
    """6,51 millones de Bitcoin están en riesgo cuántico.

El 32,7% del suministro total.

BIP-360 propone la solución.
Integrado al repositorio oficial en febrero de 2026.
La transición completa: entre 5 y 10 años.

Bitcoin ya está trabajando en el problema antes de que exista.""",

    # Covenants
    """¿Y si pudieras poner condiciones sobre cómo se gasta tu Bitcoin?

Eso son los Covenants.

Propuestas como OP_CAT y CTV permitirían heredar Bitcoin con reglas, crear bóvedas automáticas, restringir destinos de pago.

Debate activo. Posible activación en 2026.""",
]

QUEUE_FILE = "tweet_queue.json"


def load_queue():
    if os.path.exists(QUEUE_FILE):
        with open(QUEUE_FILE) as f:
            return json.load(f)
    # Primera vez: mezcla aleatoria
    indices = list(range(len(TWEETS)))
    random.shuffle(indices)
    return {"pending": indices, "published": []}


def save_queue(queue):
    with open(QUEUE_FILE, "w") as f:
        json.dump(queue, f, indent=2)


def get_next_tweet(queue):
    if not queue["pending"]:
        # Recarga cuando se agota
        indices = list(range(len(TWEETS)))
        random.shuffle(indices)
        queue["pending"] = indices
        queue["published"] = []
    idx = queue["pending"].pop(0)
    queue["published"].append(idx)
    return TWEETS[idx], idx


def publish(text, tweet_idx, preview=False):
    if preview:
        print(f"\n{'─'*40}")
        print("PREVIEW (no publicado):")
        print(f"{'─'*40}")
        print(text)
        print(f"{'─'*40}")
        print(f"Caracteres: {len(text)}/280")
        # Generar preview de imagen
        img_path = generate_card(tweet_idx, output_path="preview_card.png")
        print(f"Imagen generada: {img_path}")
        return

    # Generar imagen de marca
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img_path = tmp.name
    generate_card(tweet_idx, output_path=img_path)

    # Subir imagen con OAuth 1.0a (media upload requiere v1.1)
    auth = tweepy.OAuth1UserHandler(
        CONSUMER_KEY, CONSUMER_SECRET,
        ACCESS_TOKEN, ACCESS_TOKEN_SECRET
    )
    api_v1 = tweepy.API(auth)
    media = api_v1.media_upload(filename=img_path)
    os.unlink(img_path)

    # Publicar tweet con imagen
    client = tweepy.Client(
        consumer_key=CONSUMER_KEY,
        consumer_secret=CONSUMER_SECRET,
        access_token=ACCESS_TOKEN,
        access_token_secret=ACCESS_TOKEN_SECRET
    )
    response = client.create_tweet(text=text, media_ids=[media.media_id])
    tweet_id = response.data["id"]
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M')}] ✓ Tweet publicado: https://x.com/BitcoinSinRuido/status/{tweet_id}")
    return tweet_id


def main():
    preview = "--preview" in sys.argv

    queue = load_queue()
    text, idx = get_next_tweet(queue)

    publish(text, idx, preview=preview)

    if not preview:
        save_queue(queue)


if __name__ == "__main__":
    main()
