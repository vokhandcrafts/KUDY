# G21.17 (issue #551): адбор гідаў па мове інтэрфейсу без падстаноўкі кантэнту

*Showboat дэма задачи #551: селектар discovery адбірае прапановы па
апублікаваным тэксце выбранай мовы інтэрфейсу; каталогі адлюстроўваюць
факт `text_locales`; новыя словы пустога/unavailable стана жывуць у
кананічных запісах і рэндэрацца з генераваных каталогаў. Створана
2026-10-04.*

*Заўвага да асяроддзя: на гэтым хасце голы `node` патрабуе
`LD_LIBRARY_PATH=$HOME/.local/lib` (зрух libsimdjson 2026-09-30) — блокі
нясуць экспарт самастойна.*

<!-- showboat-id: g2117-text-locale-filter -->

Свежасць праекцый: wire-тыпы і каталогі паведамленняў — з схемы і кананічнай
крыніцы, двайны праверачны прагон дае той самы вывад:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node tools/contracts/generate-wire-types.mjs --check
node tools/i18n/generate-messages.mjs --check 2>/dev/null
node tools/i18n/generate-messages.mjs --check 2>/dev/null
```

```output
wire-types: OK (fresh)
generated messages: 10 files fresh
generated messages: 10 files fresh
```

Правіла адбору ў ядрі (той самы гейт `localeOk` селектара): сінтэтычны
фіксчарны індэкс з апублікаванымі тэкстамі be/en/uk — у інтэрфейсах be і en
адказ поўны, у uk толькі гід з фактычна апублікаваным uk-тэкстам, у fr
нямая — нічога, і гэта не памылка службы:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types --input-type=module -e "
import { readFileSync } from 'node:fs';
const { selectDiscovery } = await import('./core/discovery/selectDiscovery.ts');
const index = JSON.parse(readFileSync('fixtures/discovery-contract/index-valid.json', 'utf8'));
for (const locale of ['be', 'en', 'uk', 'fr']) {
  const r = selectDiscovery(index, { city_id: index.city_id, content_locale: locale, theme_ids: [] });
  console.log(locale, 'exact:', r.exact.length);
}
" 2>/dev/null
```

```output
be exact: 6
en exact: 6
uk exact: 1
fr exact: 0
```

Новыя словы трох каталогаў рэндэрацца з генераванага модуля — тлумачэнне
адсутнасці тэксту (be/uk) і недаступны стан прамой спасылкі без
падстаноўкі (en):

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types --input-type=module -e "
const { UI_STRINGS } = await import('./components/ui-strings.generated.ts');
console.log(UI_STRINGS.be.textLocaleEmpty);
console.log(UI_STRINGS.uk.textLocaleEmpty);
console.log(UI_STRINGS.en.previewTextUnavailable);
" 2>/dev/null
```

```output
Гідаў з тэкстам на гэтай мове яшчэ няма.
Гідів з текстом цією мовою ще немає.
This guide is not available in the selected interface language.
```
