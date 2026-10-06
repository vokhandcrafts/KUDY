#!/usr/bin/env python3
"""G21.40 (issue #621) - build runtime/ assets for the han-layout probe.

Generates (gitignored) runtime/ contents:
  - copies the four approved KUDY faces from node_modules (@expo-google-fonts)
  - subsets Noto Sans CJK SC and TC members to exactly the probe charset

Run from anywhere:
  python3 spikes/G21.40-han-layout/scripts/build-subsets.py \
      --repo-root /path/to/repo --node-modules /path/to/node_modules

The Noto TTC path defaults to /usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc
(host fontconfig layout); override with --noto-ttc. Requires fontTools.
"""
import argparse
import json
import pathlib
import shutil
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

FACE_FILES = [
    ("@expo-google-fonts/golos-text/400Regular/GolosText_400Regular.ttf", "GolosText_400Regular.ttf"),
    ("@expo-google-fonts/golos-text/600SemiBold/GolosText_600SemiBold.ttf", "GolosText_600SemiBold.ttf"),
    ("@expo-google-fonts/alegreya/600SemiBold/Alegreya_600SemiBold.ttf", "Alegreya_600SemiBold.ttf"),
    ("@expo-google-fonts/caveat/400Regular/Caveat_400Regular.ttf", "Caveat_400Regular.ttf"),
]
NOTO_SC_MEMBER = 2  # TTC member index measured in evidence (0=JP 1=KR 2=SC 3=TC 4=HK)


def probe_charset(fixture_path: pathlib.Path) -> str:
    text = fixture_path.read_text(encoding="ascii")
    payload = text.split("window.PROBE_FIXTURES = ", 1)[1].rsplit(";", 1)[0]
    strings = json.loads(payload)

    def walk(node):
        if isinstance(node, str):
            yield node
        elif isinstance(node, dict):
            for v in node.values():
                yield from walk(v)
        elif isinstance(node, list):
            for v in node:
                yield from walk(v)

    chars = set()
    for s in walk(strings):
        chars.update(s)
    # дадаткова: лацінка/лічбы інтэрфейсу і ўзоры S2 (агульныя кодпойнты)
    chars.update("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:!?%()-")
    chars.update("\u9AA8\u76F4\u4EE4\u8FC7\u8FB9\u8BF7\u51C0\u6E29\u6D77\u8349")
    chars.discard("\\")  # ад зваротных слэшаў эскейп-фікстураў
    return "".join(sorted(c for c in chars if not c.isspace() or c == " "))


def build_subset(noto_ttc: pathlib.Path, member: int, text: str) -> bytes:
    f = TTFont(str(noto_ttc), fontNumber=member, lazy=True)
    ss = subset.Subsetter(options=subset.Options(hinting=True, desubroutinize=True, drop_tables=[]))
    ss.populate(text=text)
    ss.subset(f)
    buf = io_bytes()
    f.save(buf)
    return buf.getvalue()


def io_bytes():
    import io
    return io.BytesIO()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", default=None, help="repo root (default: two levels up from this script)")
    ap.add_argument("--node-modules", default=None, help="node_modules with @expo-google-fonts (default: <repo-root>/node_modules)")
    ap.add_argument("--noto-ttc", default="/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc")
    args = ap.parse_args()

    spike = pathlib.Path(__file__).resolve().parent.parent
    repo_root = pathlib.Path(args.repo_root).resolve() if args.repo_root else spike.parent.parent
    nm = pathlib.Path(args.node_modules).resolve() if args.node_modules else repo_root / "node_modules"
    runtime = spike / "runtime"
    runtime.mkdir(exist_ok=True)

    for rel, name in FACE_FILES:
        src = nm / rel
        if not src.is_file():
            print(f"FAIL missing app face: {src}", file=sys.stderr)
            return 1
        shutil.copyfile(src, runtime / name)
        print(f"copied {name} ({(runtime / name).stat().st_size} bytes)")

    noto = pathlib.Path(args.noto_ttc)
    if not noto.is_file():
        print(f"FAIL missing Noto TTC: {noto}", file=sys.stderr)
        return 1
    text = probe_charset(spike / "fixtures.js")
    print(f"subset charset: {len(text)} chars")
    for member, out in ((NOTO_SC_MEMBER, "kudy-subset-sc.otf"), (NOTO_SC_MEMBER + 1, "kudy-subset-tc.otf")):
        data = build_subset(noto, member, text)
        (runtime / out).write_bytes(data)
        print(f"built {out} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
