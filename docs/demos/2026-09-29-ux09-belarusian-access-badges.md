# UX 09: бэйджы платнасці па-беларуску (issue #355)

*Showboat demo для эпіка дызайн-выпраўленняў #346, задача #355: бэйдж
`AccessBadge` выводзіў кантрактнае значэнне `free`/`paid`/`mixed`
вербатым (правіла 21 §3.2 у старой рэдакцыі). Згода ўладара на змену
адлюстравання зафіксаваная каментаром у issue #355 (2026-09-29): адлюстраванне
ідзе за мовай інтэрфейсу — у дадатку яна адна, беларуская. Кантрактныя
значэнні ў схемах/індэксе і testID `badge-access-<значэнне>` не мяняюцца.
Змены: слоўнік `ACCESS_LABELS` у агульным кампаненце
`components/guide-card.tsx` (карткі, прэв'ю, месца, мапа — усе ідуць праз
яго), render-тэсты картак і прэв'ю дадаюць сцвярджэнні тэксту.
Па-за scope: a11y-label маркера на мапе (`app/map.tsx`, `NearbyCard`)
усё яшчэ ўбудоўвае сыравае значэнне. Створана 2026-09-29.*

<!-- showboat-id: ux09-belarusian-access-badges -->

Крытэр 2 — бэйдж паказвае беларускія словы; адзін слоўнік у агульным
кампаненце (з G06.05 #280 — у `components/ui-strings.ts` з EN-пары
побач; бэйдж рэндэрыць слова праз `uiStrings(locale).access`), testID
застаюцца кантрактнымі (AC2, AC3):

```sh
grep -n "access: { free\|badge-access-" components/ui-strings.ts components/guide-card.tsx
```

```output
components/ui-strings.ts:82:    access: { free: "Бясплатна", paid: "Платна", mixed: "Змешана" },
components/ui-strings.ts:122:    access: { free: "Free", paid: "Paid", mixed: "Mixed" },
components/guide-card.tsx:174:      testID={`badge-access-${access}`}
```

Крытэр 3 — копій па экранах няма: беларускія словы бэйджа жывуць толькі
у слоўніку `ui-strings.ts`, ніводны экран не мае ўласнай мапы (AC3, jscpd
без новых дубляў):

```sh
grep -rn "Бясплатна\|Платна\|Змешана" --include="*.tsx" --include="*.ts" app/ components/ | grep -v "\.test\."
```

```output
components/ui-strings.ts:82:    access: { free: "Бясплатна", paid: "Платна", mixed: "Змешана" },
```

Крытэр 4 — render-тэсты картак і прэв'ю зелёныя; сцвярджэнні
`getByText("Платна")` / `getByText("Бясплатна")` ёсць рэверт-гардам
(AC4): са знятым слоўнікам падае — праверана адкатам перад push.
Слоўнік пакрыты ва ўсіх трох вітках — фокусны тэст кампанента правярае
free/paid/mixed разам з testID; G06.05 дадаў assertions бэйджу і ў
preview/run-сьюты.

```sh
npx jest --config jest.config.js app/navigation.test.tsx app/preview.test.tsx 2>&1 | grep -E "Tests:|Test Suites:"
```

```output
Test Suites: 2 passed, 2 total
Tests:       35 passed, 35 total
```
