"""Gera icones placeholder do PWA (serao substituidos por arte do Canva na Fase 6)."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (255, 200, 87)   # amarelo quente, amigavel
FG = (255, 255, 255)


def draw_star(draw, cx, cy, r_outer, r_inner, color):
    import math
    points = []
    for i in range(10):
        angle = math.pi / 5 * i - math.pi / 2
        r = r_outer if i % 2 == 0 else r_inner
        points.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    draw.polygon(points, fill=color)


def make_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = int(size * 0.12) if maskable else 0
    draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=int(size * 0.22),
        fill=BG,
    )
    cx = cy = size // 2
    r_outer = size * (0.30 if maskable else 0.34)
    r_inner = r_outer * 0.45
    draw_star(draw, cx, cy, r_outer, r_inner, FG)
    return img


for size in (192, 512):
    make_icon(size).save(os.path.join(OUT, f"icon-{size}.png"))

make_icon(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
make_icon(180).save(os.path.join(OUT, "apple-touch-icon.png"))

print("Icones gerados em", os.path.abspath(OUT))
