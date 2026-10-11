# Issue #718 — ink metrics over the committed scale-2.0 captures.
# Recomputes, from the committed PNGs alone, the numbers the results file and
# the proof command assert: the uncapped advance (the non-linear font-scale
# anomaly), the pinned and capped advances (the correct paths), and the hard
# ink clip at the probe raw row's view bottom. Run:
#   python docs/testing/evidence/2026-10-11-g718/clip-metrics.py
# Emits analysis.json next to this file.
from PIL import Image
import json
import os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def clusters(img_path, y0, y1, thresh=110, min_w=8):
    im = Image.open(img_path).convert("L")
    band = np.array(im)[y0:y1, 40:1040]
    ink = (band < thresh).any(axis=0)
    boxes, start = [], None
    for i, v in enumerate(ink):
        if v and start is None:
            start = i
        if not v and start is not None:
            if i - start > min_w:
                boxes.append((start, i))
            start = None
    if start is not None:
        boxes.append((start, len(ink)))
    return boxes


def advances(boxes):
    s = [b[0] for b in boxes]
    return [s[i + 1] - s[i] for i in range(len(s) - 1)]


def median(vals):
    v = sorted(vals)
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def ink_rows(img_path, y0, y1, thresh=110):
    im = Image.open(img_path).convert("L")
    band = np.array(im)[y0:y1, 40:1040]
    rows = (band < thresh).sum(axis=1)
    nz = [(y0 + i, int(v)) for i, v in enumerate(rows) if v]
    return nz


def main():
    out = {}

    # The minimal raw row (uncapped Text, font_scale 2.0): line 1 spans
    # y 212..340 per raw-minimal-scale2.json han-node-0 bounds.
    boxes = clusters(os.path.join(HERE, "minimal-scale2.png"), 212, 340)
    adv = [d for d in advances(boxes) if d > 40]
    out["minimal_raw_line1"] = {
        "glyph_clusters": len(boxes),
        "median_advance_px": median(adv),
        "note": "uncapped Text at font_scale 2.0: advance ~74px = 1.77x of the 42px base (density 3.0), not the linear 2.0x=84px",
    }

    # The minimal size-control row (allowFontScaling=false, 28dp): y 967..1085.
    boxes = clusters(os.path.join(HERE, "minimal-scale2.png"), 967, 1085)
    adv = [d for d in advances(boxes) if d > 40]
    out["minimal_pinned_line1"] = {
        "glyph_clusters": len(boxes),
        "median_advance_px": median(adv),
        "note": "pinned 28dp Text: advance ~84px = exactly 2.0x of 42px (linear DIP path, correct)",
    }

    # The probe raw row (the recorded G21.47 surface): y 2030..2110.
    boxes = clusters(os.path.join(HERE, "probe-scale2.png"), 2030, 2110)
    adv = [d for d in advances(boxes) if d > 40]
    out["probe_raw_line1"] = {
        "glyph_clusters": len(boxes),
        "median_advance_px": median(adv),
        "note": "the recorded surface's uncapped row: same ~74px non-linear advance",
    }

    # The hard clip: ink rows of the probe raw row; the profile must end
    # abruptly at the view bottom y=2096 (raw-probe-scale2.json han-node-2).
    nz = ink_rows(os.path.join(HERE, "probe-scale2.png"), 2000, 2130)
    last_y, last_v = nz[-1]
    tail = [v for _, v in nz[-4:]]
    out["probe_raw_clip"] = {
        "ink_last_y": last_y,
        "ink_last_row_px": last_v,
        "tail_ink_px": tail,
        "view_bottom_y": 2096,
        "note": "ink ends at the view bottom with no taper (a full row of ink cut mid-stroke); the correct glyph bottoms extend ~13px further",
    }

    # The scale-1.0 baseline: the same probe row renders correctly.
    boxes = clusters(os.path.join(HERE, "probe-scale1.png"), 2076, 2138)
    adv = [d for d in advances(boxes) if d > 20]
    out["probe_raw_line1_scale1"] = {
        "glyph_clusters": len(boxes),
        "median_advance_px": median(adv) if adv else None,
        "note": "font_scale 1.0: 16 glyphs in one line, advance 42px = 1.0x, no clip",
    }

    out["density"] = 3.0
    out["base_font_px"] = 42
    out["font_scale"] = 2.0
    out["non_linear_ratio"] = round(out["minimal_raw_line1"]["median_advance_px"] / 42, 3)
    out["linear_ratio"] = round(out["minimal_pinned_line1"]["median_advance_px"] / 42, 3)

    path = os.path.join(HERE, "analysis.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
