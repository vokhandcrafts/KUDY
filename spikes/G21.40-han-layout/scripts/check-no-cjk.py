#!/usr/bin/env python3
"""G21.40 (issue #621) - assert no raw CJK bytes in committed spike files.

gitguard blocks Han/Kana/Hangul and U+3000-303F in added lines; the probe
keeps Chinese content as \\uXXXX escapes, so committed text files must be
CJK-free (Belarusian Cyrillic and Polish Latin-Ext are allowed). Screenshots
are binary evidence and runtime/ is generated - both skipped.

Exit 0 prints "cjk in committed files: NONE"; any hit exits 1.
"""
import pathlib
import sys

SPIKE = pathlib.Path(__file__).resolve().parent.parent


def has_cjk(text: str) -> bool:
    return any(
        0x2E80 <= ord(c) <= 0x9FFF  # CJK blocks incl. kana/hangul compat
        or 0x3000 <= ord(c) <= 0x303F  # CJK punctuation
        or 0xE000 <= ord(c) <= 0xF8FF  # private use area
        for c in text
    )


def main() -> int:
    bad = []
    for p in sorted(SPIKE.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(SPIKE)
        if "__pycache__" in rel.parts or "runtime" in rel.parts:
            continue
        if rel.parts[0] == "evidence" and "screenshots" in rel.parts:
            continue
        if p.suffix in (".png", ".pyc"):
            continue
        if has_cjk(p.read_text(encoding="utf-8", errors="ignore")):
            bad.append(str(rel))
    print("cjk in committed files:", bad or "NONE")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
