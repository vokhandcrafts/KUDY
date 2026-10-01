# G15.04 — скразная прыёмка падбору

*Showboat demo для issue #71 (G15.04 — D01–D07/L01–L02 над рэальным стэкам, адкат публікацыі, гейт згоды), створана 2026-10-01.*

Драйвер ідзе прадакшн-шляхам: каталог-канверт → указальнік → sha256+bytes пін →
шэйп-гейт → снапшот → кантролер падбору над чыстым ядром выбару; падзеі
паказаў — у рэальную чаргу G09.01 за гейтам згоды G09.02. Сінтэтычны горад
аднаго сямейства з фікстуры `tests/discovery/fixture.ts`: платны гід з
украінскім тэкстам бяз украінскага аўдыё, два месцы (адно толькі be) і
змяшаная падборка. (`export LD_LIBRARY_PATH` — хоставае патрабаванне node,
не частка змены.)

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types tests/discovery/g1504-demo-driver.ts 2>/dev/null
```

```output
D01 revision: r-g15-1 exact: offer-g15-guide-90,offer-g15-place-30,offer-g15-place-45,offer-g15-collection
D03 exact@60: offer-g15-place-30,offer-g15-place-45
D03 alts: offer-g15-guide-90:over_time,offer-g15-collection:over_time
D05 exact@winter: 0 guide90: over_time,season_unassessed
L01 text: be/en/uk audio: be/en
interrupted: r-g15-1 stale: true reason: index-fetch-failed snapshot-identical: true
corrupt: r-g15-1 stale: true reason: index-pin-mismatch
flush-no-consent marked: 0 batches: 0
flush-granted marked: 2 types: discovery_offer_shown,discovery_offer_shown payload-keys: content_locale,discovery_revision,kind,offer_id,surface
D07 session untouched: true locale: be
```

Праводка новай тэчкі ў ранер: глоб у `npm test` і адлюстраванне ў гардзе
праводкі сюітаў (implementation-rules 1/7) — прыбраць з іх глоб нельга
нулявым коштам, гард чырвоны (эксперымент у results/G15.04.md).

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types --input-type=module -e '
import fs from "node:fs";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
console.log("glob wired:", pkg.scripts.test.includes("tests/discovery/*.test.ts"));
const guard = fs.readFileSync("tools/build-bundle/test-wiring.test.mjs", "utf8");
console.log("guard maps the glob:", guard.includes("tests/discovery/*.test.ts"));
console.log("suites on disk:", fs.readdirSync("tests/discovery").filter((f) => f.endsWith(".test.ts")).sort().join(","));
' 2>/dev/null
```

```output
glob wired: true
guard maps the glob: true
suites on disk: discovery-acceptance.test.ts,discovery-analytics.test.ts,discovery-publication.test.ts
```
