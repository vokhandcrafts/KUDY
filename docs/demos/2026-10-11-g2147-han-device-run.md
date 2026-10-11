# G21.47 — Han-тэкст праз RN Text на Android dev client: прагон 100%/200%

*2026-10-11T12:00:19Z by Showboat 0.6.1*
<!-- showboat-id: 3b239eed-f248-46cf-a537-60f727cef9ad -->

Dev-only проба `app/han-probe.tsx` (рашырэнне `kudy://han-probe`) малюе фікстуры G21.40 праз уласны тэкставы стэк дадатку. Два прагоны драйвера на AVD (font_scale 1.0 і 2.0) зыходзяць у машынны JSON: bounds усіх 19 радкоў на абедзвух шкалах, скан кліпінгу, інвентарызацыя CJK-шрыфтоў прылады. Проба-каманда правярае з committed доказаў: скан кліпінгу пусты на абедзвух шкалах, асобнага CJK-твару Bold на прыладзе няма (fonts.xml абвяшчае зменную вось wght 100–900 — мэханізм моцу не даказваецца гэтым прагонам), у committed машынных файлах няма raw CJK-байтаў.

```bash
node -e "const a=require('node:assert/strict');const r=require('./docs/testing/evidence/2026-10-11-g2147/han-probe-results.json');const g=require('./docs/testing/evidence/2026-10-11-g2147/glyph-metrics.json');a.deepEqual(r.clippingScan.scale1,[]);a.deepEqual(r.clippingScan.scale2,[]);a.equal(r.rows.length,19);a.equal(r.deviceCjkFontFiles.length,2);a.ok(r.deviceCjkFontFiles.every(f=>f.includes('Regular')));a.equal(g.rows['pinned-off'].ratio,1);a.ok(g.rows['scaled-cap'].ratio>1.15&&g.rows['scaled-cap'].ratio<1.3);const src=require('node:fs').readFileSync('./app/han-probe.tsx','utf8');a.ok(!/\p{Script=Han}/u.test(src));console.log('G21.47 evidence proof: OK')"
```

```output
G21.47 evidence proof: OK
```

Паводзіны маштабавання на 200% (піксельныя вышыні чарніла, `glyph-metrics.json`): ScaledText капіруе на 1.25 (фактар канону), `allowFontScaling=false` трымае роўна 1.0, а uncapped Text — дэфект (#718). Моцная вага CJK маляе ўзбагачаныя штрыхі пры аднолькавых формах гліфаў; мэханізм (зменны instance wght ці сінтэзаваны bold) гэты прагон не вызначае.

```bash
node -e "const r=require('./docs/testing/evidence/2026-10-11-g2147/han-probe-results.json');const g=require('./docs/testing/evidence/2026-10-11-g2147/glyph-metrics.json');console.log('clipping scan 100%:',JSON.stringify(r.clippingScan.scale1));console.log('clipping scan 200%:',JSON.stringify(r.clippingScan.scale2));console.log('CJK font files:',r.deviceCjkFontFiles.join(', '));console.log('scaled-cap ratio:',g.rows['scaled-cap'].ratio,'| pinned-off:',g.rows['pinned-off'].ratio,'| raw-full:',g.rows['raw-full'].ratio,'(defect #718)')"
```

```output
clipping scan 100%: []
clipping scan 200%: []
CJK font files: NotoSansCJK-Regular.ttc, NotoSerifCJK-Regular.ttc
scaled-cap ratio: 1.23 | pinned-off: 1 | raw-full: 1.35 (defect #718)
```
