# UX 05: чалавечыя назвы і даты (issue #351)

*Showboat demo для эпіка дызайн-выпраўленняў #346, задача #351: экраны
паказвалі сыравыя ідэнтыфікатары — стопы прэв'ю мелі `place-*`, радкі
«My KUDY» — сыравы `routeId`, подпісы POI на мапе Run — сыравыя значэнні
`kind`, даты сесій — UTC-дзень. Змены: `PreviewStop.placeName` (назва месца
з discovery-індэкса, адно чытанне ў loadPreview), тытул гіда з гатовай
праекцыі каталога на My KUDY з сумленным fallback на id, слоўнік
`poiKind` у радках run-экрана (невядомы вид — подпіс схаваны), мясцовы
каляндарны дзень у My KUDY. Створана 2026-09-28.*

<!-- showboat-id: issue351-human-names-dates -->

Рэндэр-сьюты прэв'ю, My KUDY, Run і навігацыйнай рамы: назвы месцаў
замест `place-*` (AC1), назва гіда з fallback на id (AC2), беларускія
подпісы POI праз слоўнік (AC3), мясцовы дзень `1969-12-31` для
`1970-01-01T00:00:05Z` (AC4; зона jest-воркера запінаваная ў
jest.config.js на America/Anchorage, бо CI ганяе ў UTC).

```sh
node_modules/.bin/jest --config jest.config.js app/preview.test.tsx app/my.test.tsx app/run.test.tsx app/navigation.test.tsx 2>&1 | grep -E "^(Test Suites:|Tests:|Snapshots:)"
```

```output
Test Suites: 4 passed, 4 total
Tests:       43 passed, 43 total
Snapshots:   0 total
```

Сэрвісны сьют каталога: далучэнне назваў месцаў да стопаў (адно чытанне
індэкса), схаваны радок для месца без офера або без назвы, пераможца
дэдуплікацыі сярод офераў аднаго месца (21 §4, правіла 6; правіла 14:
ізаляваны адмоўны кейсы).

```sh
node --experimental-strip-types --test services/catalog/catalogService.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 37
ℹ pass 37
ℹ fail 0
```

Эксперымент па зняцці фіксаў (implementation-rules 1) выкананы ў гэтай
сесіі, кожны — асобным адкатам адной радкі з наступным аднаўленнем:

- прэв'ю вяртае `{stop.placeId}` у подпіс стопа → упадае тэст «the stop
  rows show the place's human title from the catalog»;
- My KUDY губляе разгортку `catalogState?.surface` → упадае тэст «the
  ready catalog names the route»;
- Run вяртае `?? poi.kind` у подпісе POI → упадае тэст «AC1: the map
  renders the engine's marker states live» (сыравы `cafe` бачны);
- `localDay` вяртаецца да `toISOString()` → упадае тэст «My KUDY shows the
  live walk and the previous runs» (чакаецца `1969-12-31`);
- пін `process.env.TZ` здымаецца з jest.config.js → той жа тэст падае і на
  хасце не ў UTC.

Дзевайс-праверка праз дэв-сцяжыну фэйкавага каталога
(EXPO_PUBLIC_FAKE_CATALOG=1) у гэтай сесіі не знята: сцяжына — некамічаны
лакальны скарт іншай сесіі, AVD на хасце няма. Паводзіны доказаныя
рэндэр- і сэрвіснымі сютамі вышэй і поўным `npm test`.
