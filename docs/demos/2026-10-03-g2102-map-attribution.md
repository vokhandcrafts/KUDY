# Issue #535: подпісы MapLibre больш не накрываюць карту і ODbL-радок

*Showboat дэма задачи #535 (G21.02): кампанент карты ўвогуле не імпартаваў
стыль maplibre-gl — кантрол юрыдычнай атрыбуцыі жыў у статым патоку,
вылезаў з кантэйнера карты (на 390px: y=523..577 пры мяжы 518) і накрываў
сэрверны радок «Даныя карты © удзельнікі OpenStreetMap» — двойчытэльная
каша. Цяпер pinned `maplibre-gl/dist/maplibre-gl.css` імпартуецца ў
адзінай мяжы `web/components/city-map.tsx`, кантрол стаіць паўдобна
знізу-справа ўнутры карты, а ODbL-радок чытаецца асобна на 320/390/1440px.
Створана 2026-10-03.*

<!-- showboat-id: g2102-map-attribution -->

Зборка статычнага экспарту (трэба перад праверкай; CSS-чанк эмітуецца і
лінкуецца ў `/map`):

```sh
(cd web && npm run build) 2>&1 | grep -E "rendered-output scan|Failed to compile"
```

```output
rendered-output scan: clean
```

Дэтэрміністычная браўзерная рэгрэсія (map_css_loaded + map_attribution_bounds):
статсэрвер на 127.0.0.1, усе знешнія запыты перарываюцца — правайдэр тайлаў
кантактуецца, таму праверка не залежыць ад сеткі; чаканы `data-map-error` і ёсць
сігнал уладкаванага стану. Пазіцыя кантрола і межы на 320/390/1440px:

```sh
node tools/web/map-attribution-regression.mjs 2>&1 | grep -E '"(mode|widths|width|ok|failures)"'
```

```output
  "mode": "deterministic",
  "widths": [
  "failures": [],
      "mode": "deterministic",
      "width": 320,
      "ok": true,
      "mode": "deterministic",
      "width": 390,
      "ok": true,
      "mode": "deterministic",
      "width": 1440,
      "ok": true,
```

Статычны гвард мяжы імпарту ў стандартным прагоне (`web/**/*.test.ts` у
`npm test`); адкат імпарту або страта правілаў у dist CSS пакета чырваніць
яго:

```sh
node --test web/map-css.test.ts 2>&1 | grep -E 'ℹ (tests|pass|fail)'
```

```output
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

Revert-эксперымент (implementation-rules 1, прагнаны 2026-10-03 у гэтай
сесіі): `git stash push -- web/components/city-map.tsx` → перазборка →
рэгрэсія завяршаецца exit=1 з `map_css_loaded` на ўсіх трох шырынях →
`git stash pop`, перазборка — зноў exit=0. Два прагоны блокаў вышэй
байт-ідэнтычныя.

Жывы прагноз (асобна ад дэтэрміністычных праверак, патрабуе сеткі):
`node tools/web/map-attribution-regression.mjs --live` чакае
`data-map-ready="fitted"` ад рэальнага стылю OpenFreeMap і правярае
захаваныя крытыкі ды даступныя спасылкі (maplibre.org, openfreemap.org,
openmaptiles.org, openstreetmap.org/copyright). Прагнана 2026-10-03 —
усе тры шырыні зелёныя. Скрыншоты: `docs/testing/evidence/
2026-10-03-g2102-map-attribution/` — `before-overlap-390.png` (рэпрадукцыя
накладкі да фікса, жывая мапа, 390px), `after-live-{320,390,1440}.png`
(пасля фікса, жывы правайдэр). Для прагону патрэбны chromium:
`npx playwright install chromium` (сам пакет — у root devDeps; рэгрэсія не
завязаная на стандартны прагон, як і жывыя кампаніі зборшчыка).
