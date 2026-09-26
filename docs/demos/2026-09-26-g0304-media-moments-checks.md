# G03.04 — медыя-правы, locked-прэв'ю, ручныя Moments і мяжа тэкст/аўдыё

*Showboat demo для issue #301 (`tools/validate`, `tools/build-bundle`), створана 2026-09-26.*

<!-- showboat-id: g0304-media-moments-checks -->

Агентная частка G03.04 — праверкі, якія ловяць парушэнні крытэрыяў на крывым пакеце, а не вачыма. `media.json` — маніфест правоў: кожны медыя-файл пакета мусіць мець запіс з `license` і `credit`, а `sha256` запісу мусіць супадаць з байтамі файла. `moments.json` — ручны маніфест тэйзераў: схема Moment забараняе любыя аўта-трыгерныя палі. Зборшчык public-пласта адхіляе гісторыю, чый `tier` супярэчыць свайму пласту, і прэв'ю, што змяшчае поўны тэкст сваёй гісторыі. `availability` сабранага індэкса не можа заяўляць аўдыё ў лакалі без тэксту, а каталог па-ранейшаму пералічвае лакалі па факце апублікаванага тэксту — аўдыё-праўда жыве толькі ў індэксе. Усе дэма-блокі печатаюць дыягностыкі праз API інструментаў, без змесціва гісторый.

Валідны дэма-пакет з абодвума маніфестамі праходзіць чыста; тры сабраныя крывыя пакеты ў `fixtures/content/g0304-*` адхіляюцца з адной іменаванай дыягностыкай кожны:

```sh
node --input-type=module -e '
import { validatePackage } from "./tools/validate/validate-package.mjs";
for (const dir of ["fixtures/content/demo-route", "fixtures/content/g0304-unlicensed-media"]) {
  const result = validatePackage(dir);
  console.log(dir, JSON.stringify(result));
}'
```

```output
fixtures/content/demo-route {"ok":true,"errors":[],"warnings":[]}
fixtures/content/g0304-unlicensed-media {"ok":false,"errors":[{"severity":"error","rule":"unlicensed-media","path":"be/base/audio/story-2-base.m4a"}],"warnings":[]}
```

Аўта-трыгер на Moment немагчымы ўжо на ўзроўні схемы: невядомае поле — гэта дыягностыка `additionalProperties`, а не цішыня:

```sh
node --input-type=module -e '
import { validatePackage } from "./tools/validate/validate-package.mjs";
const result = validatePackage("fixtures/content/g0304-moment-auto");
console.log(JSON.stringify(result.errors));'
```

```output
[{"severity":"error","rule":"additionalProperties","path":"moments.json[0]#$.auto_trigger"}]
```

Зборшчык public-пласта — апошняя мяжа: дэма-пакет, дзе прэв'ю заблакаванай кропкі змяшчае ўвесь тэкст яе ж платнай гісторыі, валідатар прапускае, а зборка рве з кодам `preview-reveals-full-text`:

```sh
rm -rf /tmp/kudy-g0304-demo-out && node --input-type=module -e '
import { buildBundle } from "./tools/build-bundle/build-bundle.mjs";
try {
  await buildBundle({ inDir: "fixtures/content/g0304-preview-leak", outDir: "/tmp/kudy-g0304-demo-out" });
  console.log("BUILD PASSED (unexpected)");
} catch (error) {
  console.log(`caught: ${error.code} ${JSON.stringify(error.ids)}`);
}'
```

```output
caught: preview-reveals-full-text {"stop_id":"stop-2","locale":"be","field":"announce"}
```

Крытэрый 4. Аўдыё без тэксту ў `availability` — дыягностыка `audio-without-text` (інварыянт 1 з `09`, разд. 3): бяром валідны індэкс-фікстуру і забіраем у гіда-прапановы тэкставую локалю `en`, пакінуўшы `en` у `audio_locales`:

```sh
node --input-type=module -e '
import { validateDiscoveryIndex } from "./tools/validate/validate-package.mjs";
import fs from "node:fs";
const index = JSON.parse(fs.readFileSync("fixtures/discovery-contract/index-valid.json", "utf8"));
index.offers.find((o) => o.offer_id === "offer-b1-guide").availability.text_locales = ["be"];
console.log(JSON.stringify(validateDiscoveryIndex(index).errors));'
```

```output
[{"severity":"error","rule":"audio-without-text","path":"discovery.json#offers[1].availability.audio_locales#en"}]
```

І сцэнар першага гіда цалкам: EN-тэкст перакладзены, EN-аўдыё яшчэ не запісанае. Зборка з дэма-пакета без EN-аўдыё дае індэкс, дзе `en` ёсць у `text_locales` і няма ў `audio_locales`, і каталог, што пералічвае лакалі па факце тэксту (`09`, разд. 8) — ніводная паверхня не выдае EN-тэкст за наяўнае EN-аўдыё:

```sh
rm -rf /tmp/kudy-g0304-demo && node --input-type=module -e '
import fs from "node:fs";
import { buildBundle } from "./tools/build-bundle/build-bundle.mjs";
import { deriveInterimCatalog } from "./web/lib/content/interim-catalog.ts";
const dir = "/tmp/kudy-g0304-demo";
fs.cpSync("fixtures/content/demo-route", dir, { recursive: true });
fs.rmSync(dir + "/en/base/audio", { recursive: true, force: true });
fs.rmSync(dir + "/en/extended/audio", { recursive: true, force: true });
await buildBundle({ inDir: dir, outDir: dir + "/out" });
const revision = JSON.parse(fs.readFileSync(dir + "/discovery.json", "utf8")).revision;
const index = JSON.parse(fs.readFileSync(dir + "/out/public/discovery/demo-city/" + revision + "/index.json", "utf8"));
const guide = index.offers.find((o) => o.ref.kind === "guide");
console.log("index availability:", JSON.stringify(guide.availability));
const catalog = deriveInterimCatalog(dir + "/out/public");
console.log("catalog route locales:", JSON.stringify(catalog.routes[0].locales));'
```

```output
index availability: {"audio_locales":["be"],"text_locales":["be","en","uk"]}
catalog route locales: ["be","en","uk"]
```
