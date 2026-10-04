# G21.16 (issue #550): восем кантэнтных лакаляў без выдуманай даступнасці

*Showboat дэма задачи #550: allowlist кантэнтных лакаляў пашыраны да
be/en/uk/de/es/fr/cs/sv у схемах-уладарах; wire-праекцыя выводзіцца з уладара;
новая тэкставая лакаля дае вынік толькі са сваімі файламі, `audio_locales`
застаецца абмежаванай фактам. Створана 2026-10-04.*

*Заўвага да асяроддзя: на гэтым хасце голы `node` патрабуе
`LD_LIBRARY_PATH=$HOME/.local/lib` (зрух libsimdjson 2026-09-30) — блокі
нясуць экспарт самастойна.*

<!-- showboat-id: g2116-content-locales -->

Уладар алоўліста і свежасць выведзенай праекцыі: перачыт з схемы-уладара,
двайны `--check` запар дае той самы вывад:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node -e "console.log('allowlist:', require('./contracts/schemas/localized-text.schema.json').propertyNames.enum.join('/'))"
node tools/contracts/generate-wire-types.mjs --check
node tools/contracts/generate-wire-types.mjs --check
```

```output
allowlist: be/en/uk/de/es/fr/cs/sv
wire-types: OK (fresh)
wire-types: OK (fresh)
```

Паводзіны на сінтэтычным дрэве: `fr` тэкставая лакаля з пастаўленымі файламі
дае `fr` у `text_locales` збудаванага індэкса, а `audio_locales` застаецца
`be/en` — ніякай выдуманай даступнасці; тая ж мяжа адхіляе заяву fr-аўдыё без
апублікаваных аўдыёфайлаў іменаванай дыягностыкай:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --input-type=module -e "
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { buildBundle } = await import('./tools/build-bundle/build-bundle.mjs');
const { validatePackage } = await import('./tools/validate/validate-package.mjs');
const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'g2116-'));
await fsp.cp('fixtures/content/demo-route', work, { recursive: true });
await fsp.cp(path.join(work, 'uk', 'base'), path.join(work, 'fr', 'base'), { recursive: true });
const voices = JSON.parse(await fsp.readFile(path.join(work, 'voices.json'), 'utf8'));
voices.push({ id: 'voice-fr-1', locale: 'fr', narrator_credit: 'Synthétique voix démo', character: 'Le Dragon' });
await fsp.writeFile(path.join(work, 'voices.json'), JSON.stringify(voices, null, 2) + '\n');
const stops = JSON.parse(await fsp.readFile(path.join(work, 'fr', 'base', 'stops.json'), 'utf8'));
for (const s of stops) {
  s.voice_id = 'voice-fr-1';
  s.text = 'Texte démo synthétique pour la vérification de la collecte.';
  s.transcript = 'Transcription démo synthétique de la couche libre.';
}
await fsp.writeFile(path.join(work, 'fr', 'base', 'stops.json'), JSON.stringify(stops, null, 2) + '\n');
const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'g2116out-'));
await buildBundle({ inDir: work, outDir: out });
const idx = JSON.parse(fs.readFileSync(path.join(out, 'public/discovery/demo-city/r-demo-1/index.json'), 'utf8'));
const guide = idx.offers.find((o) => o.offer_id === 'offer-guide-demo');
console.log('guide availability:', JSON.stringify(guide.availability));
const disc = JSON.parse(fs.readFileSync(path.join(work, 'discovery.json'), 'utf8'));
disc.offers[0].availability = { text_locales: ['be', 'en', 'uk', 'fr'], audio_locales: ['be', 'en', 'fr'] };
await fsp.writeFile(path.join(work, 'discovery.json'), JSON.stringify(disc, null, 2) + '\n');
const v = validatePackage(work);
console.log('boundary diag:', JSON.stringify(v.errors.find((e) => e.rule === 'audio-locale-without-files')));
"
```

```output
guide availability: {"audio_locales":["be","en"],"text_locales":["be","en","fr","uk"]}
boundary diag: {"severity":"error","rule":"audio-locale-without-files","path":"discovery.json#offers[0].availability.audio_locales#fr"}
```
