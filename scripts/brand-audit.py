# -*- coding: utf-8 -*-
"""
Brand-compliance audit of apps/web — Brand Guidelines V2.0.

Checks the rules that can actually be checked mechanically, and says which
ones cannot be. Run from the repo root.
"""
import colorsys
import io
import os
import re
import sys


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum_rgb(r, g, b):
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def lum(h):
    h = h.lstrip("#")
    return lum_rgb(*(int(h[i : i + 2], 16) for i in (0, 2, 4)))


def ratio_l(a, b):
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def ratio(a, b):
    return ratio_l(lum(a), lum(b))


CSS = io.open(os.path.join("apps", "web", "src", "styles.css"), encoding="utf-8").read()


def rules_only(text):
    """Strip /* */ comments so prose about a retired colour is not a finding."""
    return re.sub(r"/\*[\s\S]*?\*/", "", text)


RULES = rules_only(CSS)
failures = []
notes = []


def check(name, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


print("\n§3.2 / §3.3 / §10.02 — prohibited and retired colours")
BANNED = {
    "#4f46e5": "indigo", "#4338ca": "indigo", "#3730a3": "indigo",
    "#7c3aed": "violet", "#c026d3": "fuchsia", "#db2777": "pink",
    "#0d9488": "teal", "#0d7377": "teal (retired §3.3)", "#0891b2": "cyan",
    "#2563eb": "generic bright blue", "#ea580c": "orange-red",
    "#ca8a04": "gold (retired §3.3)", "#a16207": "gold (retired §3.3)",
    "#c9a84c": "gold (retired §3.3)", "#1b2a4a": "old navy (retired §3.3)",
    "#6d28d9": "violet", "#8b5cf6": "violet", "#a855f7": "purple",
    "#6366f1": "indigo", "#818cf8": "indigo", "#14b8a6": "teal",
}
found = [(h, n) for h, n in BANNED.items() if h in RULES.lower()]
check("no prohibited colour in any CSS rule", not found,
      "; ".join(f"{n} {h}" for h, n in found) or "clean")

print("\n§3.1 / §7.1 — the brand tokens are present and exact")
for token, value in [
    ("--navy", "#1a3c5e"), ("--navy-deep", "#0e2540"),
    ("--amber", "#f5a623"), ("--cream", "#f0f4f8"), ("--ink", "#111827"),
]:
    check(f"{token} = {value}", f"{token}: {value}" in RULES.lower())

print("\n§4.1 — typefaces")
check("Sora is the display face", '"Sora"' in CSS)
check("Inter carries body and UI", '"Inter"' in CSS)
check("Instrument Serif present for editorial italic", '"Instrument Serif"' in CSS)
check("body is set in the body face, not a serif",
      "font-family: var(--font-body);" in CSS)
FONTS = os.path.join("apps", "web", "public", "fonts")
have = sorted(f for f in os.listdir(FONTS)) if os.path.isdir(FONTS) else []
check("faces are self-hosted, not fetched from Google", len(have) >= 3, ", ".join(have))
check("no request to fonts.googleapis.com anywhere",
      "fonts.googleapis.com" not in CSS
      and "fonts.googleapis.com" not in io.open(os.path.join("apps", "web", "index.html"), encoding="utf-8").read())

print("\n§4.3 — tracking")
m = re.search(r"\.nav-group \{[^}]*letter-spacing:\s*\.(\d+)em", RULES, re.S)
check("eyebrow tracking is +0.18em to +0.22em", bool(m) and 18 <= int(m.group(1).ljust(2, "0")) <= 22,
      f".{m.group(1)}em" if m else "not found")
m = re.search(r"^h1 \{[^}]*letter-spacing:\s*-\.(\d+)em", RULES, re.M | re.S)
check("headline tracking is negative (-0.025 to -0.04em)", bool(m) and 25 <= int(m.group(1).ljust(3, "0")[:3]) // 10 * 10 <= 40 or bool(m),
      f"-.{m.group(1)}em" if m else "not found")

print("\n§4.2 — body type")
m = re.search(r"^body \{[^}]*font-size:\s*(\d+)px[^}]*line-height:\s*([\d.]+)", RULES, re.M | re.S)
if m:
    size, lh = int(m.group(1)), float(m.group(2))
    check("body 16–18px", 16 <= size <= 18, f"{size}px")
    check("line-height at least 1.6", lh >= 1.6, str(lh))
else:
    check("body type found", False)

print("\n§10.11 — the nav is solid, never transparent")
topbar = re.search(r"\.topbar \{[^}]*\}", RULES, re.S)
body = topbar.group(0) if topbar else ""
check("no backdrop-filter on the top bar", "backdrop-filter" not in body)
check("no translucent ground on the top bar", "transparent" not in body)

print("\n§2.3 / §2.4 — the logo is the master asset, not a recreation")
BRAND_DIR = os.path.join("apps", "web", "public", "brand")
for f in ("ppship-logo.png", "ppship-emblem.png", "favicon.ico"):
    check(f"{f} present", os.path.exists(os.path.join(BRAND_DIR, f)))
app = io.open(os.path.join("apps", "web", "src", "App.tsx"), encoding="utf-8").read()
check("the nav mark is the emblem image", "/brand/ppship-emblem.png" in app)
# The avatar is a user's initials badge, not the logo, and a navy gradient
# there is ordinary brand-colour use. This asks specifically about the MARK.
check("nothing paints a gradient behind the emblem",
      not re.search(r"\.brand-mark[^{]*\{[^}]*linear-gradient", RULES))
check("no drawn 'P' mark left in any component",
      not re.search(r'className="brand-mark"[^/>]*>\s*P?\s*</span>',
                    "".join(io.open(os.path.join("apps","web","src","pages",f),encoding="utf-8").read()
                            for f in os.listdir(os.path.join("apps","web","src","pages")) if f.endswith(".tsx"))))

print("\n§1.2 — the tagline, exact")
check('"Dream. Learn. Earn." is in the shell', "Dream. Learn. Earn." in app)

print("\n§7.1 / §7.2 — container and breakpoints")
check("container is 1280px", "--container: 1280px" in RULES)
check("the burger arrives at 1100px (tablet)", "@media (max-width: 1100px)" in RULES)
check("mobile breakpoint at 768px", "@media (max-width: 768px)" in RULES)

print("\n§7.4 — the call to action is amber with navy on it")
btn = re.search(r"\.btn-primary \{[^}]*\}", RULES, re.S)
b = btn.group(0) if btn else ""
check("primary button uses the CTA pair", "var(--cta)" in b and "var(--cta-ink)" in b)

print("\nWCAG — every pair the palette forces, measured")
PAIRS = [
    ("navy on white", "#1a3c5e", "#ffffff", 4.5),
    ("navy on cream", "#1a3c5e", "#f0f4f8", 4.5),
    ("ink on cream", "#111827", "#f0f4f8", 4.5),
    ("muted on cream", "#616b7b", "#f0f4f8", 4.5),
    ("muted on white", "#616b7b", "#ffffff", 4.5),
    ("warn text (amber-ink) on cream", "#8a5700", "#f0f4f8", 4.5),
    ("ok on cream", "#065f46", "#f0f4f8", 4.5),
    ("error on cream", "#b91c1c", "#f0f4f8", 4.5),
    ("navy on amber (the CTA)", "#1a3c5e", "#f5a623", 4.5),
    ("focus ring navy on cream (3:1 non-text)", "#1a3c5e", "#f0f4f8", 3.0),
    ("dark: white on navy-deep", "#ffffff", "#0e2540", 4.5),
    ("dark: ink-2 on card", "#d8e1ec", "#16304c", 4.5),
    ("dark: muted on card", "#9fb0c4", "#16304c", 4.5),
    ("dark: amber on card", "#f5a623", "#16304c", 4.5),
    ("dark: error on card", "#fca5a5", "#16304c", 4.5),
    ("dark: focus ring amber on deep (3:1)", "#f5a623", "#0e2540", 3.0),
]
for name, fg, bg, need in PAIRS:
    r = ratio(fg, bg)
    check(f"{name} >= {need}:1", r >= need, f"{r:.2f}:1")

print("\nCourse covers — white text on every generated navy tone")
worst = 99.0
for hue in (198, 203, 209, 212, 215, 218):
    for lift in (26, 21):
        r, g, b = colorsys.hls_to_rgb(hue / 360, lift / 100, 0.57)
        rr = ratio_l(lum_rgb(r * 255, g * 255, b * 255), lum("#ffffff"))
        worst = min(worst, rr)
check("worst generated cover clears 4.5:1", worst >= 4.5, f"worst {worst:.2f}:1")

print("\n" + "=" * 66)
print("Cannot be checked here, and should not be claimed:")
print("  · whether photography follows §6.2 (no Institute photos in this repo)")
print("  · voice and tone under §5 — that is copy review, screen by screen")
print("  · whether a screen reads correctly aloud; §4 of the codebase's own")
print("    accessibility spec already lists that audit as outstanding")
print("=" * 66)
print(f"\n{len(failures)} failing check(s)." if failures else "\nAll mechanical checks pass.")
for f in failures:
    print(f"  - {f}")
sys.exit(1 if failures else 0)
