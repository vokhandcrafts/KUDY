# G14.04.b — лакаля `uk` па факце: валідатар і каталог

*Showboat demo for issue #303 (G14.04.b — `uk` як запланаваная лакаля ў схемах пакета/каталога), created 2026-10-01.*

<!-- showboat-id: issue-303-locale-facts -->

Availability-тройкі (`text_locales`/`audio_locales`) — гэта факты змешчанага дрэва, не абяцанні (21 §3.2 «вылічаецца з апублікаванага зместу»; 09 §8: «каталог паказвае наяўныя локалі па факце» — публікацыя пер-лакальная, таму факт тэкставай лакалі тут — апублікаваны `base/stops.json`). Дэма на сінтэтычным дрэве-фіксчуры `fixtures/content/demo-route` (`route.json` мае `published: false` — чарнавік, uk ім пададзены без усякага published-статусу):

1. **Факт:** uk грузіць `uk/base/stops.json` (тэкставая лакаля без аўдыё) — заява `text_locales: [be,en,uk]` на чарнавіку праходзіць валідатар цалкам.
2. **Абяцанне тэксту:** тая ж заява, але каталога `uk/` у дрэве няма — валідатар адказвае іменаваным правілам `text-locale-without-files` са шляхам да канкрэтнай лакалі.
3. **Абяцанне аўдыё:** uk-тэкст ёсць, аўдыё-файлаў няма, а ў заяве `audio_locales: [be,en,uk]` — правіла `audio-locale-without-files`.
4. **Каталог па факце:** публікацыя рэальнымі `build-bundle` + `publish-catalog` паказвае uk у `routes[].locales` толькі пакуль апублікаваны `uk/base/stops.json`; без uk-файлаў uk з каталога знікае, be/en застаюцца.

(`export LD_LIBRARY_PATH` — хоставае патрабаванне node, не частка змены.)

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --no-warnings --input-type=module -e '
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { validatePackage } = await import(pathToFileURL("tools/validate/validate-package.mjs").href);
const makeTree = (mutate) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g1404b-"));
  fs.cpSync("fixtures/content/demo-route", dir, { recursive: true });
  const rel = path.join(dir, "discovery.json");
  const index = JSON.parse(fs.readFileSync(rel, "utf8"));
  index.offers[0].availability = { text_locales: ["be", "en", "uk"], audio_locales: ["be", "en"] };
  fs.writeFileSync(rel, JSON.stringify(index, null, 2));
  if (mutate) mutate(dir);
  return dir;
};
const fact = validatePackage(makeTree(null));
console.log("факт uk тэкст:", fact.ok, JSON.stringify(fact.errors));
const promiseText = validatePackage(makeTree((dir) => fs.rmSync(path.join(dir, "uk"), { recursive: true })));
console.log("абяцанне uk тэкст:", promiseText.ok, promiseText.errors.map((e) => `${e.rule} @ ${e.path}`).join(", "));
const withAudioClaim = (dir) => {
  const rel = path.join(dir, "discovery.json");
  const index = JSON.parse(fs.readFileSync(rel, "utf8"));
  index.offers[0].availability.audio_locales = ["be", "en", "uk"];
  fs.writeFileSync(rel, JSON.stringify(index, null, 2));
};
const promiseAudio = validatePackage(makeTree(withAudioClaim));
console.log("абяцанне uk аўдыё:", promiseAudio.ok, promiseAudio.errors.map((e) => `${e.rule} @ ${e.path}`).join(", "));
'
```

```output
факт uk тэкст: true []
абяцанне uk тэкст: false text-locale-without-files @ discovery.json#offers[0].availability.text_locales#uk
абяцанне uk аўдыё: false audio-locale-without-files @ discovery.json#offers[0].availability.audio_locales#uk
```

Тую самую розніцу «факт/абяцанне» catalogs-слой паказвае праз публікацыю: існуе локаля ў `routes[].locales` толькі калі апублікаваны яе base/stops.json (09 §8), таму hand-edited абяцанне туды проста не трапляе — а хтосьці, хто падправіў availability ў аўтарскім дрэве, спыняецца валідатарам з дэма-блока 1.

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --no-warnings --input-type=module -e '
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { buildBundle } = await import(pathToFileURL("tools/build-bundle/build-bundle.mjs").href);
const { publishCatalog } = await import(pathToFileURL("tools/publish-catalog/publish-catalog.mjs").href);
const catalogLocales = async (withUk) => {
  const author = fs.mkdtempSync(path.join(os.tmpdir(), "g1404b-author-"));
  fs.cpSync("fixtures/content/demo-route", author, { recursive: true });
  if (!withUk) fs.rmSync(path.join(author, "uk"), { recursive: true, force: true });
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "g1404b-stage-"));
  await buildBundle({ inDir: author, outDir: staging });
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "g1404b-target-"));
  await publishCatalog({ staging, target, now: "2026-10-01T00:00:00.000Z" });
  const catalog = JSON.parse(fs.readFileSync(path.join(target, "catalog.json"), "utf8"));
  return catalog.routes.find((r) => r.route_id === "demo-route-a1").locales;
};
console.log("uk файлы апублікаваныя:", JSON.stringify(await catalogLocales(true)));
console.log("uk файлаў няма:       ", JSON.stringify(await catalogLocales(false)));
'
```

```output
uk файлы апублікаваныя: ["be","en","uk"]
uk файлаў няма:        ["be","en"]
```

Доказ, што дэма ганяе прадакшн-модулі: эксперымент на рэверт у сесіі дастаўкі — `git stash push -- tools/validate/validate-package.mjs` перад камітам абарвіў тры тэсты G14.04.b — тэкст- і аўдыё-негатывы і corrupt-availability (чырвоныя пры зеленай астачы сюіту), `git stash pop` вярнуў; тэсты-фіксчуры ў `tools/validate/validate-package.test.mjs` і `tools/publish-catalog/publish-catalog.test.mjs` падаюць пры зняцці праверак.
