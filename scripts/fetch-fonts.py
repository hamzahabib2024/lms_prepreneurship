"""
Downloads the brand typefaces as latin-subset VARIABLE woff2 and writes a
local @font-face sheet. Self-hosted on purpose — see the note in fonts.css.

Variable, not static instances: nine static cuts came to 342 KB, which is more
than the whole application bundle after gzip. Two variable files covering the
same weight range come to a fraction of that.
"""

import glob
import os
import re
import urllib.request

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
OUT = os.path.join("apps", "web", "public", "fonts")
os.makedirs(OUT, exist_ok=True)

# Clear the static cuts from the previous attempt.
for old in glob.glob(os.path.join(OUT, "*.woff2")):
    os.remove(old)

WANT = [
    ("Sora", "wght@300..700", "sora", "normal", "300 700"),
    ("Inter", "wght@400..700", "inter", "normal", "400 700"),
    ("Instrument+Serif", "ital@1", "instrument-serif", "italic", "400"),
]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=60).read()


faces = []
total = 0

for family, axis, slug, style, weight_range in WANT:
    css = get(f"https://fonts.googleapis.com/css2?family={family}:{axis}&display=swap").decode("utf-8")

    blocks = re.split(r"/\*\s*([\w-]+)\s*\*/", css)
    for i in range(1, len(blocks) - 1, 2):
        if blocks[i] != "latin":
            continue
        body = blocks[i + 1]
        m_u = re.search(r"src:\s*url\(([^)]+)\)", body)
        m_r = re.search(r"unicode-range:\s*([^;]+);", body)
        if not m_u:
            continue
        fname = f"{slug}.woff2"
        data = get(m_u.group(1))
        with open(os.path.join(OUT, fname), "wb") as f:
            f.write(data)
        total += len(data)
        print(f"  {fname:<24} {len(data) / 1024:6.1f} KB   weights {weight_range}")
        faces.append(
            {
                "family": family.replace("+", " "),
                "style": style,
                "weights": weight_range,
                "file": fname,
                "range": m_r.group(1).strip() if m_r else "U+0000-00FF",
            }
        )
        break

print(f"\n{len(faces)} files, {total / 1024:.1f} KB total")

header = '''/*
 * The brand typefaces — Sora for display, Inter for body and UI, Instrument
 * Serif for the one editorial italic. Brand Guidelines V2.0 §4.1 and §7.1.
 *
 * SELF-HOSTED, and that is the whole reason this file exists.
 *
 * The previous pass removed Inter and argued for the system stack: a webfont
 * costs a request to a third party on every page load, makes an institute on
 * a poor connection wait for a font before the page settles, and tells Google
 * every time a student opens the System. Every one of those objections is
 * about GOOGLE'S SERVERS, not about the typefaces — and the brand book names
 * the typefaces. The objection and the requirement were never in conflict.
 *
 * These are latin-subset VARIABLE woff2 files served from our own origin. No
 * third-party request, nothing told to anybody, one file per family rather
 * than one per weight, and `font-display: swap` so text is readable in the
 * fallback while the face arrives rather than invisible until it does.
 *
 * GENERATED — do not hand-edit. Regenerate with scripts/fetch-fonts.py.
 */
'''

lines = [header]
for f in faces:
    lines.append(
        "@font-face {\n"
        f'  font-family: "{f["family"]}";\n'
        f"  font-style: {f['style']};\n"
        f"  font-weight: {f['weights']};\n"
        "  font-display: swap;\n"
        f'  src: url("/fonts/{f["file"]}") format("woff2-variations");\n'
        f"  unicode-range: {f['range']};\n"
        "}\n"
    )

with open(os.path.join("apps", "web", "src", "fonts.css"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("wrote apps/web/src/fonts.css")
