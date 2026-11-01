# DQ-11: праверка згенераваных выяў супраць брэнд-брыфа

*Showboat demo задачи [#921](https://github.com/vokhandcrafts/KUDY/issues/921)
(DQ-11): тэхнічны скрыпт праверкі выяў — памеры, альфа-канал, памер файла,
SHA-256 і прынуджэнне паходжання (checksum + статус draft/accepted са
спасылкай на рашэнне). Прыняты пакет іконкі #429 праходзіць; чарнавік
супраць дадзенага прыкладу паведамляецца як draft, а не accepted. Створана
2026-11-01. Чэкліст — [docs/design-qa/image-checklist.md](../design-qa/image-checklist.md);
крыніцы прачытаныя на main `2eed39a2`.*

<!-- showboat-id: dq11-image-check -->

Тэхнічны прагон: чатыры прынятыя экспарты пакета `app-icon-copper-framed-v1`
з камічаным `assets/kudy-icon/provenance.json` і сінтэтычны чарнавік
`test/fixtures/image-check/draft-example.png` са сваім provenance
(`status: draft`). Выхадны код скрыпту — 0, кожны радок нясе статус.

```sh
node tools/design/image-check.mjs assets/kudy-icon/icon.png assets/kudy-icon/android-adaptive-foreground.png assets/kudy-icon/android-adaptive-background.png assets/kudy-icon/android-adaptive-square-foreground.png test/fixtures/image-check/draft-example.png
```

```output
PASS assets/kudy-icon/icon.png: PNG 1024x1024, alpha: no, 111177 bytes, sha256 f33e393b102ce07ee6f95cd84f5bcbe9cfb49cced1338ae96c3695bdf73bd0a2, status: accepted (decision: https://github.com/vokhandcrafts/KUDY/issues/429 (owner comment 2026-10-26); geometric bounds update 2026-10-28 without a repaint: docs/demos/2026-10-28-launcher-icon-bounds.md)
PASS assets/kudy-icon/android-adaptive-foreground.png: PNG 1024x1024, alpha: yes, 42577 bytes, sha256 07d9b5108b0b1d789f9745fafda4a4cdb7e10c7e21f77229255094655035f907, status: accepted (decision: https://github.com/vokhandcrafts/KUDY/issues/429 (owner comment 2026-10-26); geometric bounds update 2026-10-28 without a repaint: docs/demos/2026-10-28-launcher-icon-bounds.md)
PASS assets/kudy-icon/android-adaptive-background.png: PNG 1024x1024, alpha: no, 4925 bytes, sha256 bdff7b4e90f5aa916fffd99d67b74c609a07fab4e5cf30cbe298b3993380efe1, status: accepted (decision: https://github.com/vokhandcrafts/KUDY/issues/429 (owner comment 2026-10-26); geometric bounds update 2026-10-28 without a repaint: docs/demos/2026-10-28-launcher-icon-bounds.md)
PASS assets/kudy-icon/android-adaptive-square-foreground.png: PNG 1024x1024, alpha: yes, 47533 bytes, sha256 f72c16ad078ac6c45ced4ed98fbf90ec94c3c24aa5df7f6b46383fe76ed04d65, status: accepted (decision: https://github.com/vokhandcrafts/KUDY/issues/429 (owner comment 2026-10-26); geometric bounds update 2026-10-28 without a repaint: docs/demos/2026-10-28-launcher-icon-bounds.md)
PASS test/fixtures/image-check/draft-example.png: PNG 64x64, alpha: yes, 207 bytes, sha256 62d7895fd3c408a13593a41669f3ef5795f8b31d0e142d737e6043300529b098, status: draft (not accepted — the owner decision link is pending)
```

Proof задачы: тэсты падаюць, калі праверкі checksum і статусу знятыя са
скрыпта. Экспэрымэнт нейтралізуе тры `add(...)`-выклікі (статус + абедзве
галіны checksum-праверкі), праганяе тэсты і аднаўляе файл.

```sh
cp tools/design/image-check.mjs /tmp/dq11-image-check.mjs.bak
node -e '
const fs = require("node:fs");
const before = fs.readFileSync("tools/design/image-check.mjs", "utf8");
const after = before
  .replace(/\n  if \(!STATUSES\.has\(provenance\.status\)\) \{\n    add\("status", `[^`]*`\);\n  \}/, "")
  .replace(/\n      add\("checksum", `[^`]*`\);/g, "");
if (after === before) { console.error("nothing removed"); process.exit(1); }
fs.writeFileSync("tools/design/image-check.mjs", after);
console.log("removed the checksum and status findings");
'
node --test --experimental-strip-types tools/design/image-check.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)'
cp /tmp/dq11-image-check.mjs.bak tools/design/image-check.mjs
```

```output
removed the checksum and status findings
ℹ tests 17
ℹ pass 14
ℹ fail 3
```

Пасля аднаўлення тэсты зелянеюць:

```sh
node --test --experimental-strip-types tools/design/image-check.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

```output
ℹ tests 17
ℹ pass 17
ℹ fail 0
```
