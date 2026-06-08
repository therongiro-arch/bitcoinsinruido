"""Bitcoin Sin Ruido — generador de imágenes Open Graph por artículo.

Lee el frontmatter (title, description, capa, slug, draft) de cada
`.mdx` en `src/content/articulos/` y produce un PNG 1200×630 por
artículo en `public/og/{slug}.png` con identidad de marca BSR.

También genera `public/og-default.png` para todas las páginas que no
sean artículos (home, /sobre, /glosario, /comparativas, pillars, etc.).

Se invoca automáticamente en `deploy.yml` antes de `npm run build` para
que el bundle final contenga las imágenes. No requiere commits manuales.

Dimensiones: 1200×630 es la recomendación de Open Graph y la dimensión
que X, LinkedIn, Facebook, WhatsApp y Telegram usan para "rich card".
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).parent
ARTICLES_DIR = ROOT / "src" / "content" / "articulos"
OUT_DIR = ROOT / "public" / "og"
OUT_DEFAULT = ROOT / "public" / "og-default.png"
BUNDLED_INTER = ROOT / "assets" / "fonts" / "Inter-Bold.ttf"

W, H = 1200, 630

# Brand palette (coincide con el sitio en modo oscuro).
BG = (10, 10, 11)
BG_SOFT = (18, 18, 20)
ORANGE = (247, 147, 26)
ORANGE_DIM = (168, 100, 18)
INK = (245, 245, 244)
INK_MUTED = (168, 168, 163)
INK_DIM = (110, 110, 105)
LINE = (38, 38, 43)

# Padding general.
PAD_X = 80
PAD_Y = 70

# Etiqueta de capa (chip) -> color del fondo y del texto.
CAPA_COLORS = {
    "protocolo": (ORANGE, BG),
    "L2": ((59, 130, 246), (255, 255, 255)),
    "privacidad": ((139, 92, 246), (255, 255, 255)),
    "futuro": ((16, 185, 129), (255, 255, 255)),
    "glosario": (INK_MUTED, BG),
}


# ---------------------------------------------------------------------------
# Fonts
# ---------------------------------------------------------------------------

FONT_PATHS_BOLD = [
    str(BUNDLED_INTER),  # bundled Inter Bold — has proper ₿ glyph
    "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/calibrib.ttf",
]
FONT_PATHS_MEDIUM = [
    "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/calibri.ttf",
]
FONT_PATHS_REGULAR = [
    "/usr/share/fonts/truetype/google-fonts/Poppins-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/calibri.ttf",
]
FONT_PATHS_MONO = [
    "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Medium.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf",
    "C:/Windows/Fonts/consolab.ttf",
    "C:/Windows/Fonts/consola.ttf",
]


def get_font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    paths = {
        "bold": FONT_PATHS_BOLD,
        "medium": FONT_PATHS_MEDIUM,
        "regular": FONT_PATHS_REGULAR,
        "mono": FONT_PATHS_MONO,
    }[weight]
    for p in paths:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Frontmatter parsing (lightweight, no YAML lib dependency)
# ---------------------------------------------------------------------------

def parse_frontmatter(text: str) -> dict[str, str]:
    """Naïve YAML frontmatter parser tailored to BSR articles.

    Handles title, description, capa, draft. Ignores complex types (lists,
    multiline) because we don't need them for the OG image.
    """
    if not text.startswith("---"):
        return {}
    end = text.find("---", 3)
    if end < 0:
        return {}
    body = text[3:end]
    data: dict[str, str] = {}
    for line in body.splitlines():
        m = re.match(r'^([a-zA-Z_]+):\s*(.+?)\s*$', line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        # Strip surrounding quotes.
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        data[k] = v
    return data


# ---------------------------------------------------------------------------
# Text wrapping (manual, respects max width by measuring each candidate)
# ---------------------------------------------------------------------------

def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
    max_lines: int,
) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for w in words:
        candidate = (current + " " + w).strip()
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = w
        if len(lines) == max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    # If we ran out of room mid-text, suffix the last line with an ellipsis.
    if len(lines) == max_lines:
        consumed = " ".join(lines)
        if consumed.split() != words[: len(consumed.split())]:
            pass  # we already kept first words only
        remaining = words[len(" ".join(lines).split()) :]
        if remaining:
            # Try to fit "…" at the end of the last line, trimming words as needed.
            last = lines[-1]
            while draw.textlength(last + " …", font=font) > max_width and " " in last:
                last = last.rsplit(" ", 1)[0]
            lines[-1] = last + " …"
    return lines


# ---------------------------------------------------------------------------
# Visual primitives
# ---------------------------------------------------------------------------

def draw_background(img: Image.Image) -> None:
    """Solid dark BG + decorative PCB-style circuit traces + brand stripe.

    The circuit pattern lives on the left and right sides of the card,
    out of the way of the title text in the centre. Faint gold lines
    with junction dots evoke the Bitcoin-as-protocol aesthetic without
    competing with the typography.
    """
    draw = ImageDraw.Draw(img)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    o = ImageDraw.Draw(overlay)

    # Very faint global dot grid for paper-like texture.
    for x in range(40, W, 60):
        for y in range(40, H, 60):
            o.ellipse([x - 1, y - 1, x + 1, y + 1], fill=(255, 255, 255, 10))

    # PCB-style circuit traces on the left and right sides. Symmetric
    # decoration that suggests "protocol", "chip", "infrastructure"
    # without distracting from the title.
    trace_color = (*ORANGE, 80)  # dim orange, partly transparent
    dot_color = (*ORANGE, 140)
    trace_w = 3

    def draw_trace_cluster(start_x: int, direction: int) -> None:
        """Draw a fan of traces flowing horizontally from start_x.
        `direction`=+1 flows to the right, -1 to the left.
        """
        ys = [195, 235, 275, 365, 405, 445]
        for y in ys:
            # Main horizontal trace
            length = 180 + (abs(hash(y)) % 60)
            end_x = start_x + direction * length
            # Sometimes the trace ends in a right-angle bend
            bend = (hash(y) % 3) == 0
            if bend:
                mid_x = start_x + direction * (length - 40)
                bend_y = y + ((hash(y) >> 4) % 30 - 15)
                o.line([(start_x, y), (mid_x, y)], fill=trace_color, width=trace_w)
                o.line([(mid_x, y), (mid_x, bend_y)], fill=trace_color, width=trace_w)
                o.line([(mid_x, bend_y), (end_x, bend_y)], fill=trace_color, width=trace_w)
                # Junction dot at the bend
                o.ellipse([mid_x - 5, y - 5, mid_x + 5, y + 5], fill=dot_color)
            else:
                o.line([(start_x, y), (end_x, y)], fill=trace_color, width=trace_w)
            # Endpoint pad
            o.ellipse([end_x - 6, y - 6, end_x + 6, y + 6], fill=dot_color)
            # Inner hole on the pad
            o.ellipse([end_x - 3, y - 3, end_x + 3, y + 3], fill=(*BG, 220))

    draw_trace_cluster(start_x=W, direction=-1)  # right side flows left
    # Soft glow under the right-side traces.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    for y in [195, 235, 275, 365, 405, 445]:
        g.ellipse([W - 80, y - 22, W - 20, y + 22], fill=(*ORANGE, 18))
    overlay = Image.alpha_composite(glow, overlay)

    img.paste(overlay, (0, 0), overlay)
    # Top accent stripe (full-bleed, brand orange).
    draw.rectangle([0, 0, W, 8], fill=ORANGE)


def draw_btc_badge(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int) -> None:
    """Orange circle + Bitcoin ₿ symbol rendered with Inter Bold.

    Inter Bold (bundled in assets/fonts) has a faithful ₿ glyph — same
    proportions and stroke style as the official Bitcoin logo. We use
    the actual U+20BF character so the symbol always renders with the
    correct shape regardless of OS.
    """
    # 1. Orange circle background.
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ORANGE)

    # 2. Render U+20BF (Bitcoin currency symbol) centred on the badge.
    f = get_font(int(r * 1.65), "bold")
    bbox = draw.textbbox((0, 0), "₿", font=f)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    text_x = cx - tw / 2 - bbox[0]
    text_y = cy - th / 2 - bbox[1] - 2
    draw.text((text_x, text_y), "₿", font=f, fill=BG)


def draw_brand_header(img: Image.Image) -> None:
    """₿ badge + 'Bitcoin Sin Ruido' word-mark + tagline, top-left."""
    draw = ImageDraw.Draw(img)
    cx, cy, r = PAD_X + 28, PAD_Y + 28, 28
    draw_btc_badge(draw, cx, cy, r)
    # Word-mark.
    f_brand = get_font(32, "bold")
    draw.text((cx + r + 16, PAD_Y + 8), "Bitcoin Sin Ruido", font=f_brand, fill=INK)
    # Tagline below.
    f_tag = get_font(18, "mono")
    draw.text((cx + r + 16, PAD_Y + 36), "PROTOCOLO · NO PRECIO · LATAM", font=f_tag, fill=INK_DIM)


def draw_capa_chip(draw: ImageDraw.ImageDraw, capa: str, x: int, y: int) -> int:
    """Draw a small pill with the article's 'capa' tag. Returns x past the chip."""
    bg, fg = CAPA_COLORS.get(capa, (ORANGE, BG))
    label = f"CAPA · {capa.upper()}"
    f = get_font(20, "mono")
    pad_x, pad_y = 18, 10
    tw = draw.textlength(label, font=f)
    h = 36
    draw.rounded_rectangle(
        [x, y, x + tw + pad_x * 2, y + h],
        radius=18,
        fill=bg,
    )
    draw.text((x + pad_x, y + pad_y - 2), label, font=f, fill=fg)
    return int(x + tw + pad_x * 2)


def draw_url(img: Image.Image) -> None:
    """Brand URL at the bottom-right corner."""
    draw = ImageDraw.Draw(img)
    f = get_font(22, "mono")
    text = "bitcoinsinruidos.com"
    tw = draw.textlength(text, font=f)
    draw.text((W - PAD_X - tw, H - PAD_Y - 10), text, font=f, fill=INK_DIM)


# ---------------------------------------------------------------------------
# Card composition
# ---------------------------------------------------------------------------

def compose_card(
    title: str,
    description: str,
    capa: str | None = None,
    is_default: bool = False,
) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw_background(img)
    draw_brand_header(img)

    draw = ImageDraw.Draw(img)
    inner_w = W - PAD_X * 2

    # Reserve a fixed bottom band for the separator + URL so the description
    # can never collide with them. The band starts at FOOTER_TOP (separator
    # line) and the URL sits below it.
    FOOTER_TOP = H - 90
    FOOTER_GAP_ABOVE = 28  # vertical breathing room between content and separator
    content_max_bottom = FOOTER_TOP - FOOTER_GAP_ABOVE

    # Content cursor starts below the brand header.
    cursor_y = 220

    # 1) Capa chip (only for articles).
    if capa and not is_default:
        draw_capa_chip(draw, capa, PAD_X, cursor_y)
        cursor_y += 58

    # 2) Title — wraps up to 3 lines. Slightly smaller font + line-height
    # so even a 3-line title leaves room for at least one description line.
    title_font_size = 58
    title_line_h = 70
    title_font = get_font(title_font_size, "bold")
    title_lines = wrap_text(draw, title, title_font, inner_w, max_lines=3)
    for i, line in enumerate(title_lines):
        draw.text((PAD_X, cursor_y + i * title_line_h), line, font=title_font, fill=INK)
    cursor_y += title_line_h * len(title_lines) + 14

    # 3) Description — fit as many lines as still fit before the footer
    # band, capped at 2. If a 3-line title used up the room, description
    # is dropped silently (the title alone is enough information).
    desc_font_size = 26
    desc_line_h = 36
    desc_font = get_font(desc_font_size, "regular")
    available_h = max(0, content_max_bottom - cursor_y)
    max_desc_lines = min(2, available_h // desc_line_h)
    if description and max_desc_lines > 0:
        desc_lines = wrap_text(draw, description, desc_font, inner_w, max_lines=int(max_desc_lines))
        for i, line in enumerate(desc_lines):
            draw.text((PAD_X, cursor_y + i * desc_line_h), line, font=desc_font, fill=INK_MUTED)

    # 4) Footer band: thin separator + URL right-aligned underneath.
    draw.rectangle([PAD_X, FOOTER_TOP, W - PAD_X, FOOTER_TOP + 1], fill=LINE)
    url_font = get_font(22, "mono")
    url_text = "bitcoinsinruidos.com"
    url_w = draw.textlength(url_text, font=url_font)
    draw.text((W - PAD_X - url_w, FOOTER_TOP + 22), url_text, font=url_font, fill=INK_DIM)
    # Bottom-left: a small tagline so the footer feels intentional.
    tag_font = get_font(20, "mono")
    draw.text((PAD_X, FOOTER_TOP + 22), "Lee el articulo completo  >", font=tag_font, fill=INK_DIM)

    return img


# ---------------------------------------------------------------------------
# Drivers
# ---------------------------------------------------------------------------

def generate_article(slug: str, fm: dict[str, str]) -> Path:
    title = fm.get("title", slug.replace("-", " ").title())
    description = fm.get("description", "")
    capa = fm.get("capa", "protocolo")
    img = compose_card(title, description, capa=capa, is_default=False)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{slug}.png"
    img.save(out, "PNG", optimize=True)
    return out


def generate_default() -> Path:
    img = compose_card(
        title="Bitcoin desde el protocolo, sin ruido de precio",
        description="Lightning, Taproot, BitVM, covenants y futuro. Referencia técnica en español.",
        capa=None,
        is_default=True,
    )
    img.save(OUT_DEFAULT, "PNG", optimize=True)
    return OUT_DEFAULT


def main() -> int:
    if not ARTICLES_DIR.exists():
        print(f"!! Articles directory not found: {ARTICLES_DIR}", file=sys.stderr)
        return 1

    # Default first (covers home, /sobre, /glosario, pillars…).
    default_out = generate_default()
    print(f"  default -> {default_out}")

    count = 0
    for path in sorted(ARTICLES_DIR.glob("*.mdx")):
        text = path.read_text(encoding="utf-8")
        fm = parse_frontmatter(text)
        if fm.get("draft", "").lower() == "true":
            continue
        slug = path.stem
        out = generate_article(slug, fm)
        print(f"  {slug:40s} -> {out.name}")
        count += 1

    print(f"\nGenerated {count} article OG images + 1 default.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
