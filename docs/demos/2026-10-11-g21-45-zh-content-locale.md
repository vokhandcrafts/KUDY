# G21.45 (issue #669): дзявяты кантэнтны код zh у кантрактах і гейт вэба

*Showboat дэма задачи #669: allowlist кантэнтных лакаляў пашыраны да
be/en/uk/de/es/fr/cs/sv/zh (рашэнне ўладара G21.42, ADR §4); wire-праекцыя
выводзіцца з уладар-схемы; ліміты маюць роўна 8→9; `zh` прымаюцца схемамі,
але ў рэкламаваныя вэб-паверхні (sitemap, hreflang) не трапляе, пакуль
рэліз-гейт G21.50 яго не адкрые. Створана 2026-10-11.*

*Заўвага да асяроддзя: на гэтым хасце голы `node` патрабуе
`LD_LIBRARY_PATH=$HOME/.local/lib` (зрух libsimdjson 2026-09-30) — блокі
нясуць экспарт самастойна.*

<!-- showboat-id: g2145-zh-content-locale -->

Уладар алоўліста і свежасць выведзенай праекцыі: перачыт з схемы-уладара,
двайны `--check` запар дае той самы вывад:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --no-warnings -e "console.log('allowlist:', require('./contracts/schemas/localized-text.schema.json').propertyNames.enum.join('/'))"
node --no-warnings tools/contracts/generate-wire-types.mjs --check
node --no-warnings tools/contracts/generate-wire-types.mjs --check
```

```output
allowlist: be/en/uk/de/es/fr/cs/sv/zh
wire-types: OK (fresh)
wire-types: OK (fresh)
```

Паводзіны на дазволе: мапа з `zh` прымаецца ўладаром; закладзены код `pl` і
далей застаецца па-за спісам; дзясяты элемент у `text_locales` ловіцца
`maxItems` (ліміт роўна 8→9, не больш); zh-даступнасць у індэксе дыспакавання
валідная; рэкламаваны набор URL-паверхняў фільтруе `zh` праз рэліз-гейт
(рэестр яго яшчэ не зарэгістраваў — G21.46):

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --no-warnings --experimental-strip-types --input-type=module -e "
import fs from 'node:fs';
import { validateSchemaFile } from './contracts/reader.mjs';
const zh = { be: 'x', en: 'x', uk: 'x', de: 'x', es: 'x', fr: 'x', cs: 'x', sv: 'x', zh: '\u4E2D\u6587' };
console.log('zh map ok:', validateSchemaFile('schemas/localized-text.schema.json', zh).ok);
console.log('reserved pl:', JSON.stringify(validateSchemaFile('schemas/localized-text.schema.json', { ...zh, pl: 'x' }).errors[0]));
const index = structuredClone(JSON.parse(fs.readFileSync('fixtures/discovery-contract/index-valid.json', 'utf8')));
index.offers[0].availability = { text_locales: Array(10).fill('be'), audio_locales: Array(10).fill('be') };
console.log('10 locales:', JSON.stringify(validateSchemaFile('schemas/discovery-index.schema.json', index).errors[0]));
index.offers[0].availability = { text_locales: ['be', 'en', 'zh'], audio_locales: ['be', 'en', 'zh'] };
console.log('zh availability ok:', validateSchemaFile('schemas/discovery-index.schema.json', index).ok);
const { advertisedTextLocales } = await import('./web/lib/content/site.ts');
console.log('gate on [zh, be, sv]:', JSON.stringify(advertisedTextLocales(['zh', 'be', 'sv'])));
"
```

```output
zh map ok: true
reserved pl: {"keyword":"enum","rule":"$.<key>","path":"$.<key>"}
10 locales: {"keyword":"maxItems","rule":"$.offers[0].availability.text_locales","path":"$.offers[0].availability.text_locales"}
zh availability ok: true
gate on [zh, be, sv]: ["be","sv"]
```
