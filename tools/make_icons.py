"""App icons: writes app/icons/icon.svg, icon-192.png, icon-512.png and apple-touch-icon.png from one drawing.
A dark tile, the Moon's disk, a terrain horizon clipped to the disk, the Sun (gold) and Earth (blue).
The PNGs are drawn at 4x and downsampled, so edges are anti-aliased. The disk (radius 200 of 512) stays inside
the maskable-icon safe zone (radius 204.8), so the same PNG serves as the maskable icon.
Usage: python3 tools/make_icons.py"""
import os
import numpy as np
from PIL import Image, ImageDraw
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'icons')
BG, DISK, LAND, SUN, EARTH = (11, 16, 32), (26, 34, 56), (138, 147, 168), (242, 179, 61), (57, 135, 229)
C, R = 256, 200                      # disk centre and radius on the 512 grid
RIDGE = [(40, 330), (150, 285), (250, 262), (350, 240), (472, 210)]   # skyline, extended past the disk; clipped below
hexc = lambda c: '#%02x%02x%02x' % c

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><clipPath id="d"><circle cx="{C}" cy="{C}" r="{R}"/></clipPath></defs>'
       f'<rect width="512" height="512" rx="112" fill="{hexc(BG)}"/><circle cx="{C}" cy="{C}" r="{R}" fill="{hexc(DISK)}"/>'
       f'<path clip-path="url(#d)" d="M{" L".join(f"{x} {y}" for x, y in RIDGE)} L472 472 L40 472Z" fill="{hexc(LAND)}"/>'
       f'<circle cx="360" cy="150" r="46" fill="{hexc(SUN)}"/><circle cx="150" cy="150" r="34" fill="{hexc(EARTH)}"/></svg>\n')
open(os.path.join(OUT, 'icon.svg'), 'w').write(svg)

K = 4                                # supersampling factor
def draw(n):
    s = n * K / 512
    im = Image.new('RGB', (n * K, n * K), BG); d = ImageDraw.Draw(im)
    disk = [(C - R) * s, (C - R) * s, (C + R) * s, (C + R) * s]
    d.ellipse(disk, fill=DISK)
    land = Image.new('L', im.size, 0); ImageDraw.Draw(land).polygon([(x * s, y * s) for x, y in RIDGE] + [(472 * s, 472 * s), (40 * s, 472 * s)], fill=255)
    mask = Image.new('L', im.size, 0); ImageDraw.Draw(mask).ellipse(disk, fill=255)
    im.paste(LAND, mask=Image.fromarray(np.minimum(np.array(land), np.array(mask))))   # terrain inside the disk only
    d.ellipse([314 * s, 104 * s, 406 * s, 196 * s], fill=SUN); d.ellipse([116 * s, 116 * s, 184 * s, 184 * s], fill=EARTH)
    return im.resize((n, n), Image.LANCZOS)

for n in (192, 512):
    draw(n).save(os.path.join(OUT, f'icon-{n}.png'), optimize=True)
draw(180).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)   # iOS ignores transparency: opaque tile
print('icons written to', os.path.normpath(OUT))
