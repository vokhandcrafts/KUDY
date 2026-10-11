#!/usr/bin/env python3
# G21.47 (issue #671) — the pixel-metrics pass over the captured screenshots.
# uiautomator bounds report accessibility boxes, not glyph sizes (RN expands
# touch targets), so the scaling ratios come from the ink itself: for each
# scaling row the content band (from the scroll-end dump bounds) is cropped
# from the scroll-end screenshot and the dark-pixel row profile gives the
# rendered glyph height. Reproduction:
#   python3 docs/testing/evidence/2026-10-11-g2147/glyph-metrics.py
import json
import re
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
RUNTIME = HERE / "runtime"

ROWS = {
    "scaled-cap": "ScaledText (cap 1.25)",
    "raw-full": "Text, no cap",
    "pinned-off": "allowFontScaling=false",
}
# the scroll-end dump/screenshot per scale (the position where the scaling
# rows are fully visible)
END_POS = {1: 1, 2: 2}
X0, X1 = 42, 1038
DARK = 120  # ink #22262b on paper #faf7f2
MIN_DARK = 3


def bands(dump: Path):
    xml = dump.read_text(encoding="utf-8")
    nodes = [
        (m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)))
        for m in re.finditer(r'text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
    ]
    out = {}
    for key, caption in ROWS.items():
        for i, (t, x1, y1, x2, y2) in enumerate(nodes):
            if t != caption:
                continue
            after = [n for n in nodes[i + 1 :] if n[0] and n[2] >= y2]
            if after:
                _, bx1, by1, bx2, by2 = after[0]
                # The accessibility box can be smaller than the painted text
                # (RN touch-target and overflow behavior), so the ink window
                # extends to the next ASCII caption below — the next row's
                # label — or the screen bottom for the last row.
                nxt = next((n for n in nodes[i + 1 :] if n[0] and n[0].isascii() and n[2] >= y2), None)
            # keep the window clear of the gesture-nav zone at the bottom
            out[key] = (by1, min(nxt[2] if nxt else 2400, 2400 - 50))
            break
    return out


def ink_height(img: Image.Image, y0: int, y1: int) -> int:
    g = img.convert("L")
    px = g.load()
    rows = [
        y
        for y in range(max(0, y0), min(img.height, y1))
        if sum(1 for x in range(X0, min(X1, img.width), 2) if px[x, y] < DARK) >= MIN_DARK
    ]
    if not rows:
        return 0
    # The largest contiguous ink run: the gesture-nav handle at the screen
    # bottom is dark too and must not extend a text measurement.
    runs = []
    for y in rows:
        if runs and y - runs[-1][1] <= 3:
            runs[-1][1] = y
        else:
            runs.append([y, y])
    best = max(runs, key=lambda r: r[1] - r[0])
    return best[1] - best[0] + 1


result = {"method": "ink-row profile over the content band cropped from the scroll-end screenshot", "rows": {}}
for scale, pos in END_POS.items():
    dump = RUNTIME / f"dump-scale{scale}-pos{pos}.xml"
    shot = RUNTIME / f"probe-scale{scale}-pos{pos}.png"
    img = Image.open(shot)
    for key, (y0, y1) in bands(dump).items():
        result["rows"].setdefault(key, {})[f"h{scale}"] = ink_height(img, y0, y1)

for key in ROWS:
    h1 = result["rows"][key].get("h1")
    h2 = result["rows"][key].get("h2")
    result["rows"][key]["ratio"] = round(h2 / h1, 2) if h1 and h2 else None

result["expected"] = {
    "scaled-cap": "~1.25 (font.big-text-factor cap on ScaledText)",
    "raw-full": "~2.0 (system font_scale, no cap)",
    "pinned-off": "1.0 (allowFontScaling=false)",
}

out = HERE / "glyph-metrics.json"
out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(f"OK -> {out}")
for key, v in result["rows"].items():
    print(f"  {key:12} h1={v['h1']} h2={v['h2']} ratio={v['ratio']}")
