"""
Bitcoin Sin Ruido - Generador de hilo semanal para X
Combina metricas en vivo de la red + noticias Bitcoin Optech + deep dive tecnico rotativo
Salida: thread_content.txt + thread_card.png
"""

import os, sys, json, math
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import URLError
import xml.etree.ElementTree as ET
from generate_image import W, H, BG, ORANGE, FG, MUTED, DIM, get_font, glow, draw_grid
from PIL import Image, ImageDraw

# ─────────────────────────────────────────────
# DEEP DIVES ROTATIVOS (10 temas, 1 por semana)
# ─────────────────────────────────────────────
DEEP_DIVES = [
  {
    "tema": "Lightning Network",
    "tweets": [
      "Abres un canal con otra persona.\nAmbos bloquean Bitcoin en un contrato multi-firma.\nLuego intercambian firmas actualizadas sin tocar la blockchain.\nMiles de pagos. Cero fees de red.",
      "Cuando cierras el canal, solo ESA transaccion final va a la blockchain.\nToda la actividad comprimida en 2 transacciones on-chain.\nEficiencia brutal.",
      "Channel splicing ya implementado en LDK, Eclair y c-lightning.\nPermite redimensionar canales sin cerrarlos.\nMenos fricccion. Mas liquidez.",
      "Cash App: crecimiento 7x en Lightning durante 2024.\nNo es un experimento.\nEs infraestructura de pagos global en construccion.",
      "El problema pendiente: routing.\nEncontrar el camino optimo entre nodos es NP-hard.\nLos algoritmos mejoran, pero la UX aun no es perfecta.",
      "Lo que viene:\n→ Async payments (sin estar online)\n→ Taproot channels (mas privados)\n→ LSP estandarizados\n→ Splicing nativo en mas wallets\nLa infraestructura madura rapido.",
      "Lightning no reemplaza la blockchain base.\nLa complementa.\nBitcoin: liquidacion final.\nLightning: pagos del dia a dia.\nDos capas. Una sola red de confianza.",
    ]
  },
  {
    "tema": "Covenants",
    "tweets": [
      "Un Covenant es una restriccion programable que viaja con el Bitcoin.\nEjemplo: 'Este BTC solo puede ir a una de estas 3 direcciones.'\nEl protocolo lo verifica automaticamente.",
      "Las propuestas principales:\nOP_CTV: congela el destino en el momento de crear el gasto.\nOP_CAT: concatena datos, base de muchas capacidades avanzadas.",
      "¿Para que sirven?\n→ Bovedas: bloqueo con tiempo de espera\n→ Herencias: condiciones automaticas\n→ Canales Lightning mas eficientes\n→ Pagos restringidos por destino",
      "El debate en la comunidad es intenso.\nA favor: amplian capacidades sin comprometer seguridad.\nEn contra: aumentan complejidad y superficie de ataque.",
      "Activar un soft fork en Bitcoin requiere consenso social amplio.\nNo hay CEO que decida.\nLos nodos votan con su software.\nLos mineros con su hashrate.",
      "Es un proceso lento a proposito.\nBitcoin prefiere moverse despacio y bien antes que rapido y roto.",
      "Si OP_CAT y CTV se activan en 2026, Bitcoin tendra capacidades de contratos inteligentes sin abandonar la simplicidad del protocolo base.\nEl debate sigue. El protocolo espera.",
    ]
  },
  {
    "tema": "Proof of Work",
    "tweets": [
      "Mucha gente critica el consumo energetico de Bitcoin.\nPocos entienden por que ese consumo ES exactamente el punto.",
      "Para anadir un bloque, un minero debe encontrar un numero que produzca un hash con caracteristicas especificas.\nEs costoso a proposito.\nSin costo, no hay seguridad.",
      "Reescribir una transaccion de hace 6 bloques requeriria mas hashrate que toda la red combinada durante 6 bloques seguidos.\nCosto fisico = barrera infranqueable.",
      "La red Bitcoin supera 600 EH/s.\nUn ataque del 51% requeriria hardware por miles de millones + electricidad masiva + seria detectable al instante.",
      "Proof of Stake no tiene este costo fisico.\nLa seguridad viene de tokens, que pueden imprimirse, comprarse o confiscarse.\nPoW ancla la seguridad al mundo real.",
      "Bitcoin usa ~0.5% de la energia mundial.\nEl sistema bancario tradicional usa mucho mas.\nY Bitcoin puede usar energia residual o renovable.",
      "La energia gastada en PoW no desaparece.\nSe convierte en la garantia mas solida de la historia: el historial de Bitcoin no puede reescribirse sin un costo fisico catastrofico.",
    ]
  },
  {
    "tema": "Modelo UTXO",
    "tweets": [
      "Tu banco guarda un numero: tu saldo.\nBitcoin guarda monedas especificas.\nEsa diferencia cambia absolutamente todo.",
      "UTXO = Unspent Transaction Output\nCada vez que recibes Bitcoin, recibes una moneda especifica con un valor especifico.\nNo un credito. Una moneda real con historial.",
      "Cuando pagas, gastas monedas completas.\nSi tienes 0.1 BTC y pagas 0.03:\n→ Gastas el UTXO de 0.1\n→ Creas uno de 0.03 (destino)\n→ Creas uno de 0.07 (cambio tuyo)\nComo billetes fisicos.",
      "Ventaja 1: Verificabilidad\nCada UTXO tiene historial completo desde su creacion.\nCualquier nodo verifica que no ha sido gastado dos veces.\nSin confiar en nadie.",
      "Ventaja 2: Paralelismo\nTransacciones con diferentes UTXOs pueden validarse en paralelo.\nMas escalable a nivel de validacion que los modelos de cuenta.",
      "Ventaja 3: Privacidad potencial\nCon buenas practicas (CoinJoin, no reusar direcciones), el modelo UTXO permite cortar el rastro.\nImperfecto, pero mejor que un libro mayor de cuentas.",
      "La complejidad del modelo UTXO es su poder.\nNo es un bug.\nEs la arquitectura que hace a Bitcoin verificable, resistente a censura y descentralizado a escala global.",
    ]
  },
  {
    "tema": "Los 21 Millones",
    "tweets": [
      "Ningun activo en la historia tiene un suministro tan verificable como Bitcoin.\n¿Como esta garantizado exactamente?",
      "El suministro esta definido por una serie geometrica:\nBloques 0-209999: 50 BTC/bloque\nBloques 210000-419999: 25 BTC\n...\nCada ~4 anos, la mitad.",
      "La suma converge matematicamente en:\n50 x 210.000 x (1 + 1/2 + 1/4 + ...) = 21.000.000\nNo es una decision de empresa.\nEs una identidad matematica.",
      "El ultimo Bitcoin se minara ~en el ano 2140.\nPero el 93% ya fue emitido.\nEl 99% estara emitido antes de 2036.\nLa escasez ya es efectiva hoy.",
      "¿Quien controla esto?\nNadie. Y cualquier nodo puede verificarlo.\nSi un minero intentara crear mas Bitcoin, todos los nodos rechazarian ese bloque automaticamente.",
      "La politica monetaria de Bitcoin es la unica en la historia que ninguna entidad puede cambiar unilateralmente.\nFed: puede imprimir. BCE: puede imprimir. Bitcoin: matematicamente imposible.",
      "El halving no es un evento de precio.\nEs la confirmacion periodica de que el protocolo funciona exactamente como fue disenado.\nCada 210.000 bloques, la matematica gana.",
    ]
  },
  {
    "tema": "Nodos",
    "tweets": [
      "La narrativa popular: los mineros controlan Bitcoin.\nEs falsa.\nLos verdaderos guardianes son los nodos.",
      "Un nodo completo:\n→ Guarda toda la blockchain (~600 GB)\n→ Verifica cada transaccion\n→ Verifica cada bloque\n→ Rechaza automaticamente lo invalido\nSin pedir permiso a nadie.",
      "~20.000 nodos activos en el mundo.\nCada uno independiente.\nNinguno necesita permiso de otro.\nNinguno puede ser apagado centralmente.",
      "Los mineros proponen bloques.\nLos nodos los aceptan o rechazan.\nSi un bloque viola las reglas, todos los nodos lo rechazan.\nEl minero pierde trabajo y recompensa.",
      "En 2017, el UASF (User Activated Soft Fork):\nLos usuarios, con sus nodos, forzaron una activacion que los mineros resistian.\nLos nodos ganaron. Sin un solo disparo.",
      "Correr un nodo:\nRaspberry Pi + disco de 1 TB = nodo completo.\nCosto: ~80 euros.\nBeneficio: soberania total. Verificas tus propias transacciones.",
      "Cada nodo hace Bitcoin mas resistente.\nMas descentralizado.\nMas dificil de censurar.\nEl acto mas poderoso en Bitcoin no es comprar. Es validar.",
    ]
  },
  {
    "tema": "BitVM",
    "tweets": [
      "Mientras todos miraban el precio, los desarrolladores construian algo mas importante.\nContratos inteligentes en Bitcoin. Sin soft fork.",
      "BitVM es un sistema de ejecucion optimista.\nPermite cualquier computacion verificable sobre Bitcoin sin modificar el protocolo.\nLa cadena no ejecuta el codigo. Solo verifica si hubo fraude.",
      "¿Como funciona?\n1. Dos partes se comprometen a una computacion.\n2. Se ejecuta off-chain.\n3. Si hay disputa, se resuelve on-chain con prueba de fraude.\n4. El que mintio pierde sus fondos.",
      "Enero 2026: Citrea lanzo el primer ZK-rollup sobre Bitcoin mainnet.\nAgrupa miles de transacciones y las verifica con una prueba matematica compacta.\nSeguridad de Bitcoin. Escala de rollup.",
      "¿Que abre esto?\n→ Puentes Bitcoin a otras redes con seguridad real\n→ Contratos inteligentes auditables\n→ DeFi sobre Bitcoin sin nueva capa de confianza\n→ Stablecoins ancladas a Bitcoin",
      "Diferencia con Ethereum:\nEthereum ejecuta contratos on-chain (costoso, lento).\nBitVM ejecuta off-chain y solo toca la cadena si hay fraude.\nMas eficiente. Seguridad de Bitcoin.",
      "BitVM no es magia.\nTransacciones de disputa son caras. La coordinacion es compleja.\nPero es la prueba de que Bitcoin puede evolucionar sin perder lo que lo hace seguro.",
    ]
  },
  {
    "tema": "Taproot",
    "tweets": [
      "Activada en noviembre de 2021.\nCasi nadie la entiende.\nTodos se benefician de ella.",
      "Taproot introdujo las firmas Schnorr.\nAntes (ECDSA): cada firma es unica y rastreable.\nAhora (Schnorr): multiples firmas se combinan en una sola.\nUn multisig 3/5 parece transaccion normal.",
      "En practica:\nUna cartera multisig (mas segura) ahora cuesta lo mismo en fees que una wallet simple.\nY es indistinguible en la blockchain.\nMas seguridad. Mas privacidad. Mismo precio.",
      "Taproot tambien introdujo Tapscript.\nCondiciones de gasto complejas que solo se revelan si se usan.\nSi nadie disputa, la blockchain solo ve la firma. Nada mas.",
      "Para Lightning: Taproot es critico.\nCanales mas eficientes, mas privados, menor huella on-chain.\nMejora directa en fees al abrir o cerrar canales.",
      "La adopcion es lenta.\nA 2026, menos del 30% de transacciones usan Taproot.\nLas wallets tardan en actualizar. Los exchanges mas aun.\nLa mejora esta disponible. El ecosistema la sigue.",
      "Taproot es la base de lo que viene:\n→ Covenants\n→ Taproot Assets\n→ BitVM\n→ PTLC en Lightning\nEl protocolo ya esta listo. El resto del ecosistema lo sigue.",
    ]
  },
  {
    "tema": "BIP-360",
    "tweets": [
      "Los ordenadores cuanticos no existen a escala practica.\nPero Bitcoin ya se esta preparando.\n¿Por que ahora y no cuando llegue el riesgo?",
      "El problema:\nLas firmas ECDSA actuales son vulnerables al algoritmo de Shor en un ordenador cuantico suficientemente potente.\nUn QC podria derivar la clave privada desde la publica.",
      "¿Cuando es real el riesgo?\nEstimados actuales: entre 5 y 15 anos para QC capaces de atacar Bitcoin.\nNo es inmediato. Pero la transicion tarda anos.\nHay que empezar ya.",
      "6,51 millones de Bitcoin en direcciones vulnerables.\n32.7% del suministro total.\nDirecciones que expusieron su clave publica (P2PK antiguas, direcciones reutilizadas).",
      "BIP-360 propone el esquema QRSC (Quantum Resistant Signature Scheme).\nIntegrado al repositorio oficial en febrero de 2026.\nEstado actual: testnet activo.",
      "La transicion requiere:\n→ Soft fork con consenso de red\n→ Periodo de migracion de meses/anos\n→ Usuarios moviendo fondos a nuevas direcciones\n→ Wallets y exchanges actualizando",
      "Bitcoin anticipa los problemas antes de que sean urgentes.\nBIP-360 en 2026 es ponerse el casco antes del accidente.\nEso es como debe funcionar un protocolo de dinero global.",
    ]
  },
  {
    "tema": "Modelo de Seguridad de Bitcoin",
    "tweets": [
      "Bitcoin no necesita que confies en nadie.\nEsta disenado para que no tengas que hacerlo.\n¿Como funciona realmente esa seguridad?",
      "Capa 1 — Criptografia:\nTus Bitcoin solo se mueven con tu firma digital.\nLa clave privada nunca sale de tu dispositivo.\nSin firma valida, no hay transaccion posible.",
      "Capa 2 — Proof of Work:\nCada bloque requiere trabajo real.\nAlterar el pasado requiere rehacer ese trabajo + todo el posterior.\nCosto fisico = seguridad real.",
      "Capa 3 — Nodos:\n~20.000 nodos verifican cada bloque independientemente.\nSi viola las reglas, es rechazado.\nNo hay autoridad central. El consenso emerge de la red.",
      "Capa 4 — Descentralizacion:\nNo hay punto unico de fallo.\nNo hay servidor que apagar.\nNo hay CEO que arrestar.\nBitcoin vive en miles de nodos en todo el mundo.",
      "Capa 5 — Auditabilidad:\nCualquier persona puede descargar el software gratuito, verificar la blockchain completa y confirmar que las reglas se cumplen.\nLa transparencia es la garantia.",
      "La suma: un sistema monetario donde la confianza no es necesaria.\nNo confias en Satoshi. No confias en los mineros.\nVerificas. Y eso es suficiente.",
    ]
  },
]


# ─────────────────────────────────────────────
# FETCH DE DATOS EN VIVO
# ─────────────────────────────────────────────

def fetch_mempool_stats():
    """Obtiene metricas actuales de la red desde mempool.space"""
    stats = {"height": None, "fee_fast": None, "hashrate": None}
    try:
        req = Request("https://mempool.space/api/blocks/tip/height",
                      headers={"User-Agent": "BitcoinSinRuido/1.0"})
        stats["height"] = int(urlopen(req, timeout=8).read().decode())
    except Exception:
        pass
    try:
        req = Request("https://mempool.space/api/v1/fees/recommended",
                      headers={"User-Agent": "BitcoinSinRuido/1.0"})
        data = json.loads(urlopen(req, timeout=8).read())
        stats["fee_fast"] = data.get("fastestFee")
    except Exception:
        pass
    try:
        req = Request("https://mempool.space/api/v1/mining/hashrate/3d",
                      headers={"User-Agent": "BitcoinSinRuido/1.0"})
        data = json.loads(urlopen(req, timeout=8).read())
        hashrates = data.get("hashrates", [])
        if hashrates:
            stats["hashrate"] = round(hashrates[-1]["avgHashrate"] / 1e18, 1)
    except Exception:
        pass
    return stats


def fetch_optech_headline():
    """Obtiene el titulo del ultimo newsletter de Bitcoin Optech"""
    try:
        req = Request("https://bitcoinops.org/feed.xml",
                      headers={"User-Agent": "BitcoinSinRuido/1.0"})
        xml_data = urlopen(req, timeout=10).read()
        root = ET.fromstring(xml_data)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        entry = root.find("atom:entry", ns)
        if entry is not None:
            title = entry.find("atom:title", ns)
            if title is not None:
                return title.text.strip()
    except Exception:
        pass
    return None


# ─────────────────────────────────────────────
# GENERACION DE IMAGEN PARA EL TWEET GANCHO
# ─────────────────────────────────────────────

def generate_thread_card(semana, tema, height, fee, hashrate, output_path="thread_card.png"):
    base = Image.new("RGBA", (W, H), (*BG, 255))
    draw = ImageDraw.Draw(base, "RGBA")
    draw_grid(draw)

    # Panel derecho
    for i in range(20):
        x = 520 + i * 35
        draw.rectangle([x, 0, x + 36, H], fill=(17, 17, 20, min(255, i * 18)))

    # Glow central derecho
    vcx, vcy = 920, 338
    glow(draw, vcx, vcy, 80, ORANGE, steps=10)

    # Icono hilo (lineas conectadas)
    c = ORANGE
    for i, y in enumerate([200, 270, 340, 410, 480]):
        draw.ellipse([vcx-14, y-14, vcx+14, y+14], fill=(*c, 200 - i*20))
        if i < 4:
            draw.line([(vcx, y+14), (vcx, y+56)], fill=(*c, 120), width=3)

    # Barra izquierda
    draw.rectangle([0, 0, 5, H], fill=(*ORANGE, 255))

    # Label
    draw.text((44, 44), "HILO SEMANAL", font=get_font(13, bold=True), fill=(*ORANGE, 255))

    # Semana
    draw.text((40, 76), f"Semana {semana}", font=get_font(56, bold=True), fill=(*FG, 255))

    # Linea
    draw.rectangle([40, 152, 200, 155], fill=(*ORANGE, 255))

    # Tema
    draw.text((40, 172), tema, font=get_font(26, medium=True), fill=(*MUTED, 255))

    # Stats de red
    stat_y = 240
    draw.text((40, stat_y), "Estado de la red:", font=get_font(16, bold=True), fill=(*FG, 200))
    stat_y += 32

    items = []
    if height:
        items.append(f"Bloque #{height:,}")
    if fee:
        items.append(f"Fee: {fee} sat/vB")
    if hashrate:
        items.append(f"Hashrate: {hashrate} EH/s")

    f_stat = get_font(18)
    for item in items:
        draw.ellipse([40, stat_y + 7, 48, stat_y + 15], fill=(*ORANGE, 255))
        draw.text((62, stat_y), item, font=f_stat, fill=(*FG, 210))
        stat_y += 34

    # Marca
    draw.text((40, H - 58), "Bitcoin Sin Ruido", font=get_font(20, bold=True), fill=(*FG, 255))
    draw.text((40, H - 30), "bitcoinsinruidos.com  @BitcoinSinRuido", font=get_font(13), fill=(*DIM, 255))
    draw.rectangle([0, H - 4, W, H], fill=(*ORANGE, 160))

    base.convert("RGB").save(output_path, "PNG", optimize=True)
    return output_path


# ─────────────────────────────────────────────
# CONSTRUCCION DEL HILO
# ─────────────────────────────────────────────

def build_thread(semana, stats, optech_headline):
    deep = DEEP_DIVES[(semana - 1) % len(DEEP_DIVES)]
    tema = deep["tema"]

    tweets = []

    # 1. Tweet gancho con metricas
    lines = [f"🧵 HILO SEMANAL — Semana {semana}"]
    lines.append("")
    lines.append("Estado de la red Bitcoin:")
    if stats["height"]:
        lines.append(f"📦 Bloque: #{stats['height']:,}")
    if stats["fee_fast"]:
        lines.append(f"⚡ Fee rapido: {stats['fee_fast']} sat/vB")
    if stats["hashrate"]:
        lines.append(f"💪 Hashrate: {stats['hashrate']} EH/s")
    lines.append("")
    lines.append(f"Esta semana: {tema} 👇")
    tweets.append("\n".join(lines))

    # 2. Tweet de actualidad Optech (si hay)
    if optech_headline:
        optech_tweet = f"📰 Ultimo Bitcoin Optech:\n\"{optech_headline}\"\n\nLa newsletter tecnica mas rigurosa del ecosistema.\nTe explico lo mas relevante 👇"
        if len(optech_tweet) <= 280:
            tweets.append(optech_tweet)

    # 3. Intro del deep dive
    tweets.append(f"🔬 DEEP DIVE: {tema.upper()}\n\n¿Entiendes realmente como funciona?\nVamos a verlo sin condescendencia. Con precision.")

    # 4-10+. Tweets del deep dive
    for t in deep["tweets"]:
        tweets.append(t)

    # Cierre
    tweets.append(
        "Eso es todo por esta semana.\n\nSigueme @BitcoinSinRuido para mas contenido tecnico de Bitcoin en espanol.\n\nSin precio. Sin hype. Solo protocolo. 🟠"
    )

    return tweets, tema


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main():
    now = datetime.now(timezone.utc)
    semana = now.isocalendar()[1]

    print(f"[{now.strftime('%Y-%m-%d %H:%M')} UTC] Generando hilo semana {semana}...")

    stats = fetch_mempool_stats()
    print(f"  Red: bloque={stats['height']}, fee={stats['fee_fast']} sat/vB, hashrate={stats['hashrate']} EH/s")

    optech = fetch_optech_headline()
    if optech:
        print(f"  Optech: {optech[:80]}...")
    else:
        print("  Optech: no disponible")

    tweets, tema = build_thread(semana, stats, optech)

    # Guardar contenido
    with open("thread_content.txt", "w", encoding="utf-8") as f:
        f.write(f"HILO SEMANAL — Semana {semana} — {tema}\n")
        f.write(f"Generado: {now.strftime('%Y-%m-%d %H:%M')} UTC\n")
        f.write("=" * 50 + "\n\n")
        for i, tweet in enumerate(tweets, 1):
            f.write(f"TWEET {i}/{len(tweets)} ({len(tweet)}/280 chars)\n")
            f.write("─" * 40 + "\n")
            f.write(tweet + "\n\n")

    # Generar imagen
    img_path = generate_thread_card(
        semana, tema,
        stats["height"], stats["fee_fast"], stats["hashrate"]
    )

    print(f"\n  Hilo de {len(tweets)} tweets generado.")
    print(f"  Imagen: {img_path}")
    print(f"  Contenido: thread_content.txt")

    # Verificar longitudes
    over = [(i+1, len(t)) for i, t in enumerate(tweets) if len(t) > 280]
    if over:
        print(f"\n  ADVERTENCIA: tweets sobre 280 chars: {over}")
    else:
        print(f"  Todos los tweets dentro de 280 chars.")


if __name__ == "__main__":
    main()
