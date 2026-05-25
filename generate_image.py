"""Bitcoin Sin Ruido - Generador de tarjetas visuales para tweets."""

from PIL import Image, ImageDraw, ImageFont
import os, sys, math, random

W, H = 1200, 675
BG      = (10,  10,  11)
ORANGE  = (247, 147, 26)
FG      = (245, 245, 244)
MUTED   = (168, 168, 163)
DIM     = (80,  80,  76)

CARDS = [
    {"label":"FUNDAMENTOS","keyword":"UTXOs","tagline":"Bitcoin no tiene saldos.\nTiene monedas.","facts":["Monedas digitales especificas, no saldos","Gastas completo y recibes cambio","Mas privado y verificable que un banco"],"stat":None,"visual":"coins"},
    {"label":"SEGURIDAD","keyword":"Proof of Work","tagline":"La seguridad de Bitcoin\nes energia real.","facts":["Los mineros gastan electricidad real","Reescribir el historial cuesta energia masiva","Sin banco central, la fisica protege"],"stat":None,"visual":"energy"},
    {"label":"ESCASEZ","keyword":"21 Millones","tagline":"No es una promesa.\nEs codigo matematico.","facts":["Recompensa se divide a la mitad cada ~4 anios","Serie geometrica converge en 21.000.000","Ningun CEO ni gobierno puede cambiarlo"],"stat":"21.000.000 BTC","visual":"limit"},
    {"label":"DESCENTRALIZACION","keyword":"Nodos","tagline":"El poder real no esta\nen los mineros.","facts":["~20.000 nodos activos en el mundo","Cada nodo verifica cada transaccion","Rechazan bloques invalidos automaticamente"],"stat":"~20.000 nodos","visual":"network"},
    {"label":"CAPA 2","keyword":"Lightning","tagline":"Pagos instantaneos\nsobre Bitcoin.","facts":["Canales de pago fuera de la blockchain","Miles de pagos sin tocar la cadena base","7x crecimiento en Cash App durante 2024"],"stat":"7x en 2024","visual":"lightning"},
    {"label":"PRIVACIDAD","keyword":"Taproot","tagline":"La mejora mas importante\nde Bitcoin en anios.","facts":["Activada en noviembre de 2021","Firmas Schnorr: mas pequenias y privadas","Reduce el costo de transacciones complejas"],"stat":"Activo desde 2021","visual":"taproot"},
    {"label":"EMISION","keyword":"Halving","tagline":"Escasez programada.\nNadie lo vota.","facts":["Recompensa se divide a la mitad cada ~4 anios","Controla el ritmo de emision de Bitcoin","Esta en el codigo, no en instituciones"],"stat":None,"visual":"halving"},
    {"label":"PROGRAMABILIDAD","keyword":"BitVM","tagline":"Contratos inteligentes\nen Bitcoin.","facts":["Computacion verificable sin cambiar consenso","Citrea: primer ZK-rollup en Bitcoin mainnet","Lanzado el 27 de enero de 2026"],"stat":"Mainnet: ene 2026","visual":"circuit"},
    {"label":"RESISTENCIA CUANTICA","keyword":"BIP-360","tagline":"Bitcoin trabaja en el problema\nantes de que exista.","facts":["6,51M BTC en direcciones vulnerables (32,7%)","Integrado al repositorio en febrero 2026","Transicion estimada: 5 a 10 anios"],"stat":"6,51M BTC en riesgo","visual":"shield"},
    {"label":"PROTOCOLO","keyword":"Covenants","tagline":"Condiciones sobre\ncomo se gasta Bitcoin.","facts":["Propuestas OP_CAT y CTV en debate activo","Bovedas, herencias y pagos restringidos","Posible activacion en 2026"],"stat":"Debate activo 2026","visual":"lock"},
]


def get_font(size, bold=False, medium=False):
    bold_paths   = ["/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf","C:/Windows/Fonts/arialbd.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
    medium_paths = ["/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf","C:/Windows/Fonts/arial.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    reg_paths    = ["/usr/share/fonts/truetype/google-fonts/Poppins-Regular.ttf","C:/Windows/Fonts/arial.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    paths = bold_paths if bold else (medium_paths if medium else reg_paths)
    for p in paths:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def glow(draw, cx, cy, r, color, steps=8):
    for i in range(steps, 0, -1):
        alpha = int(160 * (i / steps) ** 2.5)
        radius = r + (steps - i) * 20
        draw.ellipse([cx-radius, cy-radius, cx+radius, cy+radius], fill=(*color, alpha))


def draw_grid(draw):
    for x in range(0, W, 48):
        draw.line([(x,0),(x,H)], fill=(255,255,255,8), width=1)
    for y in range(0, H, 48):
        draw.line([(0,y),(W,y)], fill=(255,255,255,8), width=1)


def draw_network(draw, cx, cy, c):
    random.seed(42)
    nodes = []
    for r in [60, 130, 210]:
        for i in range(6):
            a = i * 2*math.pi/6 + random.uniform(-0.3, 0.3)
            nodes.append((cx + int(r*math.cos(a)), cy + int(r*math.sin(a))))
    nodes.append((cx, cy))
    for i, (x1,y1) in enumerate(nodes):
        for j, (x2,y2) in enumerate(nodes):
            if i < j and math.hypot(x1-x2, y1-y2) < 170:
                draw.line([(x1,y1),(x2,y2)], fill=(*c,40), width=1)
    for (nx,ny) in nodes:
        draw.ellipse([nx-5,ny-5,nx+5,ny+5], fill=(*c,200))
    draw.ellipse([cx-10,cy-10,cx+10,cy+10], fill=(*c,255))


def draw_lightning_bolt(draw, cx, cy, size, color):
    s = size
    pts = [(cx+s*0.1,cy-s),(cx-s*0.15,cy-s*0.05),(cx+s*0.25,cy-s*0.05),(cx-s*0.1,cy+s),(cx+s*0.15,cy+s*0.05),(cx-s*0.25,cy+s*0.05)]
    draw.polygon(pts, fill=(*color, 230))


def draw_coins(draw, cx, cy, c):
    for i, (ox,oy) in enumerate([(20,30),(10,15),(0,0),(-10,-15),(-20,-30)]):
        alpha = 100 + i*30
        draw.ellipse([cx+ox-55,cy+oy-20,cx+ox+55,cy+oy+20], fill=(*c, alpha))
        draw.ellipse([cx+ox-55,cy+oy-20,cx+ox+55,cy+oy+20], outline=(*c,200), width=2)


def draw_halving_bars(draw, cx, cy, c):
    heights = [200, 100, 50, 25, 12]
    bw, gap = 45, 18
    total_w = len(heights)*bw + (len(heights)-1)*gap
    x0 = cx - total_w//2
    for i, h in enumerate(heights):
        x = x0 + i*(bw+gap)
        draw.rectangle([x, cy+100-h, x+bw, cy+100], fill=(*c, 80+i*30))


def draw_shield(draw, cx, cy, c):
    for scale, alpha in [(1.0, 200), (0.6, 120)]:
        pts = [(cx + int(110*scale*math.cos(math.pi/2 + i*math.pi/3)), cy + int(110*scale*math.sin(math.pi/2 + i*math.pi/3))) for i in range(6)]
        draw.polygon(pts, outline=(*c, alpha), width=4)
        draw.polygon(pts, fill=(*c, 20))


def draw_circuit(draw, cx, cy, c):
    pts = [(cx-120,cy),(cx-60,cy),(cx-60,cy-60),(cx+20,cy-60),(cx+20,cy+40),(cx+100,cy+40),(cx+100,cy-80),(cx+160,cy-80)]
    for i in range(len(pts)-1):
        draw.line([pts[i],pts[i+1]], fill=(*c,180), width=3)
    for (px,py) in pts[1:-1]:
        draw.ellipse([px-6,py-6,px+6,py+6], fill=(*c,220))


def draw_lock(draw, cx, cy, c):
    bw, bh = 80, 63
    draw.rounded_rectangle([cx-bw//2,cy,cx+bw//2,cy+bh], radius=12, fill=(*c,200))
    aw = 44
    draw.arc([cx-aw//2,cy-54,cx+aw//2,cy+18], start=180, end=0, fill=(*c,200), width=11)
    draw.ellipse([cx-9,cy+bh//2-9,cx+9,cy+bh//2+9], fill=(*BG,255))


def draw_taproot(draw, cx, cy, c):
    for angle in [-40,-20,0,20,40]:
        rad = math.radians(90 + angle)
        draw.line([(cx,cy+80),(cx+int(100*math.cos(rad)),cy+80+int(80*math.sin(rad)))], fill=(*c,120), width=3)
    draw.line([(cx,cy+80),(cx,cy-20)], fill=(*c,220), width=6)
    for angle in range(-60,61,20):
        rad = math.radians(90 - angle)
        draw.line([(cx,cy-20),(cx+int(120*math.cos(rad)),cy-20-int(80*math.sin(rad)))], fill=(*c,160), width=3)


def draw_energy(draw, cx, cy, c):
    for i in range(5,0,-1):
        draw.ellipse([cx-i*45,cy-i*45,cx+i*45,cy+i*45], outline=(*c,30+i*25), width=2)
    draw_lightning_bolt(draw, cx, cy, 55, c)


def draw_limit(draw, cx, cy, c):
    bw, bh = 280, 28
    draw.rounded_rectangle([cx-bw//2,cy-bh//2,cx+bw//2,cy+bh//2], radius=8, outline=(*c,80), width=2)
    draw.rounded_rectangle([cx-bw//2+3,cy-bh//2+3,cx+bw//2-3,cy+bh//2-3], radius=6, fill=(*c,200))
    f = get_font(36, bold=True)
    draw.text((cx,cy-70), "21.000.000", font=f, fill=(*c,255), anchor="mm")
    f2 = get_font(16)
    draw.text((cx,cy+55), "suministro maximo", font=f2, fill=(*MUTED,200), anchor="mm")


def draw_visual(draw, vtype, cx, cy):
    c = ORANGE
    if   vtype == "network":   draw_network(draw, cx, cy, c)
    elif vtype == "lightning":
        glow(draw, cx, cy, 30, c, 6)
        draw_lightning_bolt(draw, cx, cy, 90, c)
    elif vtype == "coins":     draw_coins(draw, cx, cy, c)
    elif vtype == "halving":   draw_halving_bars(draw, cx, cy, c)
    elif vtype == "shield":    draw_shield(draw, cx, cy, c)
    elif vtype == "circuit":   draw_circuit(draw, cx, cy, c)
    elif vtype == "lock":      draw_lock(draw, cx, cy, c)
    elif vtype == "taproot":   draw_taproot(draw, cx, cy, c)
    elif vtype == "energy":    draw_energy(draw, cx, cy, c)
    elif vtype == "limit":     draw_limit(draw, cx, cy, c)


def generate_card(index, output_path=None):
    card = CARDS[index % len(CARDS)]
    base = Image.new("RGBA", (W, H), (*BG, 255))
    draw = ImageDraw.Draw(base, "RGBA")

    draw_grid(draw)

    # Panel derecho oscuro
    for i in range(20):
        x = 520 + i*35
        draw.rectangle([x,0,x+36,H], fill=(17,17,20,min(255,i*18)))

    # Glow + visual
    vcx, vcy = 920, 338
    glow(draw, vcx, vcy, 80, ORANGE, steps=10)
    draw_visual(draw, card["visual"], vcx, vcy)

    # Barra izquierda naranja
    draw.rectangle([0,0,5,H], fill=(*ORANGE,255))

    # Label
    f_lbl = get_font(13, bold=True)
    draw.text((44,44), card["label"], font=f_lbl, fill=(*ORANGE,255))

    # Keyword
    f_kw = get_font(80, bold=True)
    kw_y = 76
    for line in card["keyword"].split("\n"):
        draw.text((40,kw_y), line, font=f_kw, fill=(*FG,255))
        kw_y += 88

    # Linea decorativa
    draw.rectangle([40,kw_y+6,200,kw_y+9], fill=(*ORANGE,255))

    # Tagline
    f_tag = get_font(26, medium=True)
    tag_y = kw_y + 28
    for line in card["tagline"].split("\n"):
        draw.text((40,tag_y), line, font=f_tag, fill=(*MUTED,255))
        tag_y += 38

    # Facts
    f_fact = get_font(18)
    fact_y = tag_y + 20
    for fact in card["facts"]:
        draw.ellipse([40,fact_y+7,48,fact_y+15], fill=(*ORANGE,255))
        draw.text((62,fact_y), fact, font=f_fact, fill=(*FG,210))
        fact_y += 34

    # Stat badge
    if card["stat"]:
        f_stat = get_font(17, bold=True)
        sw = draw.textlength(card["stat"], font=f_stat)
        px, py = 40, fact_y+14
        draw.rounded_rectangle([px-10,py-8,px+sw+10,py+28], radius=6, fill=(*ORANGE,25), outline=(*ORANGE,120), width=1)
        draw.text((px,py), card["stat"], font=f_stat, fill=(*ORANGE,255))

    # Marca
    draw.text((40,H-58), "Bitcoin Sin Ruido", font=get_font(20,bold=True), fill=(*FG,255))
    draw.text((40,H-30), "bitcoinsinruidos.com  @BitcoinSinRuido", font=get_font(13), fill=(*DIM,255))
    draw.rectangle([0,H-4,W,H], fill=(*ORANGE,160))

    out = base.convert("RGB")
    if output_path is None:
        output_path = f"tweet_card_{index}.png"
    out.save(output_path, "PNG", optimize=True)
    return output_path


if __name__ == "__main__":
    idx = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    path = generate_card(idx)
    print(f"Imagen generada: {path}")
