# DQ-03 — visual:check: здымак, параўнанне, справаздача

*2026-11-01 by Showboat 0.6.1*
<!-- showboat-id: 6f4a2c1e-3b7d-4e89-9a05-dq03visualcheck -->

Задача [#913](https://github.com/vokhandcrafts/KUDY/issues/913). Тул
`npm run visual:check` здымае матрыцу V1 на эмульятары, параўноўвае з узорамі
праз pixelmatch (парог DQ-01: 0.1, максімальная доля розных пікселяў 0.05%,
статусбар выключаны crop-ам 100 px) і піша `report.md` + `manifest.json`.
Узоры пішуцца толькі з `--update`. Усе блокі ідуць з кораня рэпазітарыя і на
эмульятар не спадзяюцца.

Першы блок — падкладзеная змена +2 px (спец §9.2): сее базавую лінію і
бягучы здымак, дзе кантэнт сунуты на 2 px ніжэй, і праганяе параўнанне
праз тул. Вярджат — `DIFF`.

```bash
node -e '
const { PNG } = require("pngjs"), fs = require("fs");
const w = 108, h = 240;
const base = new PNG({ width: w, height: h });
for (let i = 0; i < w * h; i++) { const x = i % w, y = (i / w) | 0; const band = y >= 110 && y < 130; base.data[i*4] = band ? 60 : x < 54 ? 230 : 210; base.data[i*4+1] = band ? 60 : 200; base.data[i*4+2] = band ? 60 : 180; base.data[i*4+3] = 255; }
const cur = new PNG({ width: w, height: h });
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sy = Math.max(0, y - 2); for (let k = 0; k < 4; k++) cur.data[(y*w+x)*4+k] = base.data[(sy*w+x)*4+k]; }
fs.rmSync("/tmp/dq03-demo", { recursive: true, force: true });
fs.mkdirSync("/tmp/dq03-demo/captures", { recursive: true });
fs.mkdirSync("/tmp/dq03-demo/baselines", { recursive: true });
fs.writeFileSync("/tmp/dq03-demo/baselines/explore-a@font1-be.png", PNG.sync.write(base));
fs.writeFileSync("/tmp/dq03-demo/captures/explore-a_font1-be.png", PNG.sync.write(cur));
fs.writeFileSync("/tmp/dq03-demo/baselines/explore-a@font1.5-be.png", PNG.sync.write(base));
fs.writeFileSync("/tmp/dq03-demo/captures/explore-a_font1.5-be.png", PNG.sync.write(base));
console.log("seeded: the capture content sits 2 px lower than the baseline");
' && node tools/e2e-android/visual-check.mjs --from /tmp/dq03-demo/captures --baselines-dir /tmp/dq03-demo/baselines --out /tmp/dq03-demo/out --surface explore-a 2>/dev/null | head -1
```

```output
seeded: the capture content sits 2 px lower than the baseline
visual:check — PASS 1 · DIFF 1 · FAIL 0 · NOT-VERIFIED 0
```

Другі блок — выява розніцы напісаная побач са справаздачай.

```bash
test -s /tmp/dq03-demo/out/explore-a_font1-be.diff.png && printf 'diff image written: explore-a_font1-be.diff.png\n'
```

```output
diff image written: explore-a_font1-be.diff.png
```

Трэці блок — унітарная сюіта тулу: параўнанне (ідэнтычныя → PASS, блок →
DIFF з выявай, розны памер → FAIL), гвард `--update` (без флага базавыя не
пішуцца) і выхад без прылады ў non-zero з прычынай (крытэрыі 2, 3, 5).

```bash
node --test --experimental-strip-types tools/e2e-android/visual-check.test.mjs 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 21
ℹ pass 21
ℹ fail 0
```

Чацвёрты блок — хуткі тэст брыгады (крытэрый 4): кожная гісторыя матрыцы V1
мае ўзор у `docs/design-qa/baselines/`; выдаленне ўзору робіць сюіту
чырвонай.

```bash
node --test --experimental-strip-types tools/e2e-android/visual-baselines.test.mjs 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 1
ℹ pass 1
ℹ fail 0
```
