#!/usr/bin/env python3
"""G21.40 (issue #621) - regenerate the cmap coverage evidence JSONs.

Produces (ASCII-escaped, gitguard-safe):
  evidence/app-fonts-cmap.json   - the four approved KUDY faces vs the probe set
  evidence/noto-cjk-members.json - NotoSansCJK-Regular.ttc members vs the probe set

The probe set is the fixed 67-codepoint battery below (simplified /
traditional representatives, shared regional-form codepoints, Polish
Latin-Ext, digits and CJK punctuation, audio-UI characters), stored as
unicode escapes so this source file carries no raw CJK bytes. Run:

  python3 spikes/G21.40-han-layout/scripts/scan-cmap.py \
      --node-modules <repo>/node_modules \
      [--noto-ttc /usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc]
"""
import argparse
import json
import pathlib

from fontTools.ttLib import TTCollection, TTFont

PROBE_SET = {
    "simplified_only": "\u95e8\u53d1\u4e66\u8bed\u5e7f\u5bfc\u5386\u542c\u56e2\u5e01",
    "traditional_only": "\u9580\u767c\u66f8\u8a9e\u5ee3\u5c0e\u6b77\u807d\u5718\u5e63",
    "shared_regional": "\u9aa8\u76f4\u4ee4\u8fc7\u8fb9\u8bf7\u51c0\u6e29\u6d77\u8349",
    "polish_latin": "\u0141\u0142\u017b\u017c\u0179\u017a\u0104\u0105\u0118\u0119\u00d3\u00f3\u0144\u015b\u0107",
    "digits_punct": "09\u00a5\u3002\uff0c\uff1a\uff01\uff1f\u300c\u300d\uff5e\u00b7",
    "audio_ui": "\u5206\u79d2\u64ad\u653e\u6682\u505c\u4e0b\u8f7d\u7968\u5bfc\u89c8",
}

FACES = [
    ("@expo-google-fonts/golos-text/400Regular/GolosText_400Regular.ttf", "GolosText_400Regular"),
    ("@expo-google-fonts/golos-text/600SemiBold/GolosText_600SemiBold.ttf", "GolosText_600SemiBold"),
    ("@expo-google-fonts/alegreya/600SemiBold/Alegreya_600SemiBold.ttf", "Alegreya_600SemiBold"),
    ("@expo-google-fonts/caveat/400Regular/Caveat_400Regular.ttf", "Caveat_400Regular"),
]


def probe_charset() -> dict:
    flat = {}
    for group, chars in PROBE_SET.items():
        for ch in chars:
            flat.setdefault(ch, []).append(group)
    return flat


def coverage(cmap, flat):
    missing = [ch for ch in flat if ord(ch) not in cmap]
    return len(flat) - len(missing), "".join(missing)


def dump(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=1) + "\n", encoding="ascii")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--node-modules", required=True)
    ap.add_argument("--noto-ttc", default="/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc")
    args = ap.parse_args()

    nm = pathlib.Path(args.node_modules)
    spike = pathlib.Path(__file__).resolve().parent.parent
    ev = spike / "evidence"
    flat = probe_charset()
    total = len(flat)

    faces = []
    for rel, label in FACES:
        font = TTFont(str(nm / rel), lazy=True)
        covered, missing = coverage(font.getBestCmap(), flat)
        faces.append({
            "label": label,
            "file": rel,
            "total_glyphs": font["maxp"].numGlyphs,
            "covered_of_%d" % total: covered,
            "missing": missing,
        })
    dump(ev / "app-fonts-cmap.json", {
        "probe_set_size": total,
        "probe_set_groups": {k: len(v) for k, v in PROBE_SET.items()},
        "note": "KUDY app faces vs the 67-codepoint probe set; missing lists the uncovered codepoints",
        "faces": faces,
    })

    coll = TTCollection(args.noto_ttc, lazy=True)
    members = []
    for i, font in enumerate(coll.fonts):
        covered, missing = coverage(font.getBestCmap(), flat)
        members.append({
            "index": i,
            "name": font["name"].getDebugName(4),
            "covered_of_%d" % total: covered,
            "missing": missing,
        })
    dump(ev / "noto-cjk-members.json", {
        "file": args.noto_ttc,
        "probe_set_size": total,
        "members": members,
    })
    print("probe set: %d codepoints; wrote app-fonts-cmap.json, noto-cjk-members.json" % total)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
