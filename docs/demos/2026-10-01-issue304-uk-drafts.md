# G14.04.c — uk-драфты першага гіда праз G03.01

*Showboat demo for issue #304 (G14.04.c — завершаны uk-пераклад першага гіда), created 2026-10-01.*

<!-- showboat-id: issue-304-uk-drafts -->

Першы uk-гід — тры бясплатныя гісторыі пілотнай прагулкі (`gdansk-first-walk`): ратуша, двор Артура, касцёл Св. Марыі. Першы uk-паказ — толькі base, платнае пашырэнне той жа маршруту не ўваходзіць (рашэнне ўладара §6.2 у issue #302). Пераклад — новы Draft тых жа claims і крыніц: свой `source_draft_id`, свой запіс рэвю (`pending` — носьбіт-рэв'ю ўладара, §6.4), поўнае пакрыццё блокаў крыніцы. Разам з ім валідатар прапасторы дадае дзве межы моў (Proof issue: «змешанне моў у ключах падае валідацыю»):

1. **Пераклад перасякае мяжу мовы:** `source_draft_id` на драфт тае ж лакаляі — правіла `translation-same-locale`.
2. **Ключ адпавядае лакаляі:** суфікс `draft_id` са слоўніка be/en/uk мусіць супадаць з полем `locale` — правіла `locale-id-mismatch`.

(`export LD_LIBRARY_PATH` — хоставае патрабаванне node, не частка змены.)

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node tools/validate/validate-authoring.mjs --in authoring/gdansk
```

```output
{"ok":true,"errors":[],"warnings":[]}
```

Абяедзве новыя правілы страляюць на ізаляваных фікстурах — роўна адна дыягностыка на фікстуру:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --no-warnings --input-type=module -e '
import { pathToFileURL } from "node:url";
const { validateAuthoring } = await import(pathToFileURL("tools/validate/validate-authoring.mjs").href);
for (const dir of ["fixtures/authoring-pipeline/invalid-translation-same-locale", "fixtures/authoring-pipeline/invalid-locale-id-mismatch"]) {
  const r = validateAuthoring(dir);
  console.log(dir.replace("fixtures/authoring-pipeline/", ""), r.ok, r.errors.map((e) => `${e.rule} @ ${e.path}`).join(", "));
}
'
```

```output
invalid-translation-same-locale false translation-same-locale @ drafts/uk2.json#locale#uk
invalid-locale-id-mismatch false locale-id-mismatch @ drafts/en.json#locale
```

Поўнае пакрыццё перакладу: кожны uk-драфт мае столькі ж блокаў, колькі яго be-крыніца, цытуе той самы набор claims і чакае ўласнага рэвю:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --no-warnings --input-type=module -e '
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const pairs = [
  ["gdansk-townhall-base-uk", "gdansk-townhall-base-be"],
  ["gdansk-artushof-base-uk", "gdansk-artushof-base-be"],
  ["gdansk-stmary-uk", "gdansk-stmary-be"],
];
for (const [uk, be] of pairs) {
  const u = read(`authoring/gdansk/drafts/${uk}.json`);
  const b = read(`authoring/gdansk/drafts/${be}.json`);
  const claims = (d) => d.blocks.filter((x) => x.kind === "fact").flatMap((x) => x.claims).sort().join(",");
  const same = claims(u) === claims(b) ? "той самы набор" : "РОЗНЫЯ!";
  console.log(`${uk}: блокаў ${u.blocks.length}/${b.blocks.length}, claims ${same}, рэвю ${u.review.decision}`);
}
'
```

```output
gdansk-townhall-base-uk: блокаў 6/6, claims той самы набор, рэвю pending
gdansk-artushof-base-uk: блокаў 6/6, claims той самы набор, рэвю pending
gdansk-stmary-uk: блокаў 7/7, claims той самы набор, рэвю pending
```

Доказ, што гарды маюць зубы — рэверт-эксперыменты ў сесіі дастаўкі (усе на закамічаным HEAD, аднаўленне праз `git checkout --`): зварот uk-тытула да be-формы валіць тэст «criterion 2» (2 чырвоныя); адключэнне кожнага з новых правілаў валіць роўна свой фікстурны тэст (па 1 чырвонаму); выдаленне uk-драфта валіць шэсць тэстаў (пакрыццё, формы, сцэнар, некапійнасць, сінхран рэв'ю-аглядаў). Пры ўсіх аднаўленнях — 51/51 зелёныя.
