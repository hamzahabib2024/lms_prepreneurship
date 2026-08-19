# -*- coding: utf-8 -*-
"""
Cuts the emblem out of the master lockup.

§2.3 forbids recreating the logo — "always use the master asset" — and §2.4
wants the emblem alone at favicon and nav-mark sizes with the wordmark dropped
out. So the mark is CUT FROM the master file rather than redrawn, which is the
difference between using the logo and imitating it.

The crop is found by locating the orange circle rather than hard-coded, so a
re-issued master with different padding still yields the right box.
"""
import os

from PIL import Image

SRC = os.path.join("apps", "web", "public", "brand", "ppship-logo.png")
OUT = os.path.join("apps", "web", "public", "brand")

img = Image.open(SRC).convert("RGBA")
w, h = img.size
px = img.load()

# The emblem is the only strongly orange region; the wordmark is black and the
# tagline grey, so neither can be mistaken for it.
minx, miny, maxx, maxy = w, h, 0, 0
step = 2
for y in range(0, h, step):
    for x in range(0, w, step):
        r, g, b, a = px[x, y]
        if a < 40:
            continue
        if r > 190 and 90 < g < 200 and b < 130:
            minx, miny = min(minx, x), min(miny, y)
            maxx, maxy = max(maxx, x), max(maxy, y)

print(f"orange bounds: ({minx},{miny}) -> ({maxx},{maxy})")

# The sparkles sit above and right of the circle and belong to the emblem, so
# the box is squared around the whole thing rather than tight to the disc.
pad = int(max(maxx - minx, maxy - miny) * 0.04)
minx, miny = max(0, minx - pad), max(0, miny - pad)
maxx, maxy = min(w, maxx + pad), min(h, maxy + pad)

# Squared by growing UPWARD, never downward. The wordmark begins immediately
# under the circle, so a box centred on the emblem and expanded symmetrically
# swallows the top of the script — which is exactly what the first run did.
side = max(maxx - minx, maxy - miny)
cx = (minx + maxx) // 2
# Stopped just short of the circle's foot: the script's ascender reaches up
# into the corner of a box that ends exactly on it.
bottom = maxy - int(side * 0.035)
box = (cx - side // 2, bottom - side, cx + side // 2, bottom)
emblem = img.crop(box).copy()

# The script wordmark's ascender still reaches into the bottom-left corner of
# any square box tight enough to be a usable mark. The emblem contains no dark
# pixels at all — its darkest orange is around #E06A1E and the arrows are pale
# — so anything genuinely dark in this crop is the wordmark, and keying it out
# removes the intruder without touching the logo.
ep = emblem.load()
removed = 0
for yy in range(emblem.size[1]):
    for xx in range(emblem.size[0]):
        r, g, b, a = ep[xx, yy]
        if a > 0 and r < 110 and g < 110 and b < 110:
            ep[xx, yy] = (r, g, b, 0)
            removed += 1
print(f"emblem crop: {box} -> {emblem.size[0]}x{emblem.size[1]}, keyed out {removed} wordmark px")

emblem.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, "ppship-emblem.png"))
print("wrote ppship-emblem.png (256x256)")

# A favicon at the sizes a browser actually asks for. §2.4 puts the floor at
# 32px for a favicon.
ico = os.path.join(OUT, "favicon.ico")
emblem.resize((64, 64), Image.LANCZOS).save(
    ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
)
print("wrote favicon.ico (16/32/48/64)")

for f in ("ppship-emblem.png", "favicon.ico", "ppship-logo.png"):
    print(f"  {f:<24} {os.path.getsize(os.path.join(OUT, f)) / 1024:7.1f} KB")
