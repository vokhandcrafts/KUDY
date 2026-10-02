# G14.04.d — uk UI-радкі дадатку і вэба + пераключэнне мовы UI

*Showboat demo for issue #305 (`components/`, `controllers/`, `app/`, `web/`), created 2026-10-02.*

Усе блокі дэтэрмінаваныя: першыя два друкуць словы каталогаў і паводзіны
крамы пераключэння праз натыўны імпарт TS-модуляў (Node 26), астатнія —
адычаныя радкі рэпарцэраў тэстаў (`grep` па стабільных ℹ/summary-радках,
без таймінгаў). Першы блок — трэці набор радкоў `uk` адказвае побач be/en
з тым жа ключавым наборам (AC1); слова пікера і самаімёны трох моваў
у кожным каталога:

```sh
node --input-type=module -e "
import { uiStrings } from './components/ui-strings.ts';
for (const locale of ['be','en','uk']) {
  const s = uiStrings(locale);
  console.log(locale + ': ' + s.loading + ' | ' + s.currentWalk + ' | ' + s.languageLabel + ' | ' + s.languageSelfNames.uk);
}
" 2>/dev/null
```

```output
be: Загрузка… | Бягучая прагулка | Мова | Українська
en: Loading… | Current walk | Language | Українська
uk: Завантаження… | Поточна прогулянка | Мова | Українська
```

Другі блок — крама пераключэння мовы UI (AC3): `set('uk')` піша праз
durable-порт, апавяшчае падпісчыкаў (праз іх `useUiLocale` перамалёўвае
словы на месцы, бяз restart), а невядомае значэнне — іменаваная памылка
`ui-locale-unknown`, стан не рухаецца:

```sh
node --input-type=module -e "
import { createUiLocaleStore, UiLocaleError } from './controllers/uiLocaleStore.ts';
const events = [];
const store = createUiLocaleStore({ read: () => null, write: (l) => console.log('write: ' + l) });
store.subscribe(() => events.push(store.current()));
console.log('before: ' + store.current());
store.set('uk');
console.log('after: ' + store.current() + ' | events: ' + events.join(','));
try { store.set('ru'); } catch (e) { console.log('rule: ' + (e instanceof UiLocaleError ? e.rule : 'none') + ' | still: ' + store.current()); }
" 2>/dev/null
```

```output
before: be
write: uk
after: uk | events: uk
rule: ui-locale-unknown | still: uk
```

Трэці блок — гарды эквівалентнасці ключоў і фразаў кантролер-слоўнікаў
плюс юніт крамы (AC1: «усе ключы трох файлаў эквівалентныя»; выдаленне
любога uk-ключа валіць парытэт-герд — revert-эксперымент у выніках):

```sh
node --test controllers/strings-parity.test.ts controllers/reason-strings.test.ts controllers/uiLocaleStore.test.ts 2>/dev/null | grep -E '^ℹ (tests|pass|fail)'
```

```output
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

Чацвёрты блок — гард зашытых радкоў (AC2: дадаванне англійскага літарала
у код падае — revert-эксперымент: уставіць `<ScaledText>Coming soon</ScaledText>`
у экран → гард іменуе файл і літарал) і парытэт ui-strings па трох лёкалях:

```sh
npx jest --config jest.config.js components/no-hardcoded-words.test.tsx components/ui-strings.test.tsx 2>&1 | sed -E 's/\x1b\[[0-9;]*m//g' | grep -E "^(Tests|Test Suites):"
```

```output
Test Suites: 2 passed, 2 total
Tests:       6 passed, 6 total
```

Пяты блок — вэб: файл `web/lib/i18n/uk.ts` трыма той жа ключавы набор,
што be/en (парытэт-тэст у pages.test.ts; у жывыя маршруты uk ідзе толькі
з рэліз-адзінкай 6.3 — разам з перакладам першага гіда):

```sh
node --test web/lib/content/pages.test.ts 2>/dev/null | grep -E '^ℹ (tests|pass|fail)'
```

```output
ℹ tests 9
ℹ pass 9
ℹ fail 0
```
