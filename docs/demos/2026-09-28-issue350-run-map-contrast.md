# UX 04: экран Run чытальны — кантраст маркераў, атрыбуцыя, цэлі дотыку (issue #350)

*Showboat demo для эпіка дызайн-выпраўленняў #346, задача #350: маркер pending
быў белай кропкай на белай мапе, кантраст трэка прагрэсу 1.5:1 і кропкі
available 1.6:1 (ніжэй non-text 3:1 WCAG 1.4.11), peek-бар перакрываў
атрыбуцыю ODbL, подпісы POI — 10dp. Змены: фону мапы — канонавы color.map,
запаўненні маркераў — канонавыя color.marker.* (5 станаў ADR G01.01 §4.5,
кожны ≥3:1 да color.map), кропка маркера — size.marker 34px з белым абводам
2px і ценем, трэк прагрэсу — 6px accent-на-line з мяжой color.muted
(≥3:1 да карткі), атрыбуцыя — Pressable з accessibilityRole="link" і
hitSlop, якая сядзіць у peek-бары, калі бар адкрыты (не перакрываецца),
подпісы маркераў і POI і атрыбуцыя — ≥12dp, цэль дотыку маркера —
minHeight 44dp. Новыя колеры не ўводзіліся — толькі існыя токены канона.
Створана 2026-09-28.*

<!-- showboat-id: issue350-run-map-contrast -->

Дэма ганяе guard-набор тэстаў канфігурацыі статусных колераў (крытэрый 6) і
тэсты рэндэра экрана: фон мапы — канонавы color.map, усе 5 статусаў —
канонавыя color.marker.* з кантрастам ≥3:1, трэк прагрэсу мае мяжу ≥3:1 да
карткі, атрыбуцыя — лінк унутры peek-бара ў адным экзэмпляры, цэль дотыку
маркера ≥44dp, подпісы ≥12dp. Зняцце любога элемента канфігурацыі валіць
свой тэст.

```sh
node --test --test-reporter=spec test/run-map-contrast.test.mjs 2>&1 | grep -E "✔|✖|ℹ (tests|pass|fail)" | sed 's/ ([0-9.]*ms)//'
```

```output
✔ the Run map background is the canon color.map, not card white
✔ every marker status carries its canon color.marker.* fill
✔ every marker fill keeps ≥3:1 against the canon map background (WCAG 1.4.11)
✔ the peek bar progress strip stays identifiable on the card (≥3:1 edge)
✔ guard is wired into npm test (implementation-rules 1 and 7)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

```sh
node_modules/.bin/jest app/run.test.tsx 2>&1 | grep -E "^(Test Suites:|Tests:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       18 passed, 18 total
```

Эксперымент па зняцці фіксу (implementation-rules 1) выкананы ў гэтай
сесіі: у `app/run/[id].tsx` часова вернутыя старыя значэнні
(`available: tokens.colorNoticeBorder`, фон мапы `colorCard`) — guard
зачырвонеў трыма падзеннямі («must resolve to canon color.map, got
color.card», «STATUS_COLOR.available must be the canon token
color.marker.available», «marker available #e6c98c on map #eef3ee: 1.43:1
< 3:1»); асобна атрыбуцыя вернутая ў flow пад бар — jest-тэст «the
attribution is a link inside the peek bar» зачырвонеў адзіным упалым тэстам.
Пасля аднаўлення фіксу той жа запуск — зелёны.

Жывая AVD-праверка з скрыншотам Run з адкрытым peek-барам (Proof ішуя) у
гэтай сесіі не знята: на хасце няма adb і эмулятара (`which adb emulator`
→ not found), таму візуальная прыёмка не праводзілася. Кантрасты доказаныя
разлікам у наборы тэстаў кантрасту (тыя ж формулы WCAG 2.x, што і ў каноне),
размяшчэнне атрыбуцыі і памеры цэляў дотыку — тэстамі рэндэра вышэй і поўным
`npm test`.
