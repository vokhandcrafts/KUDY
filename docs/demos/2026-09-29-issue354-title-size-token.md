# UX 08: токен загалоўка font.size-title у каноне (issue #354)

*Showboat demo для эпіка дызайн-выпраўленняў #346, задача #354: памер
загалоўка экрана 18 быў hardcoded у пяці файлах (шэсць экранаў —
`screen-styles.ts` пакрывае прэв'ю маршруту і дэталі месца). Канон
(`docs/design/visual-language.md`, машынны блок «Дадатак») ужо фіксуе
`font.size-title: 18px` ад G06.07 (#266) — бракавала кодавага токена,
замен на экранах і гарда выкарыстання. Змены: `fontTitleSize` у
`components/design-tokens.ts` з анкерам на канон, замена ўсіх пяці
месцаў, guard-тэст прагулкі па экранах падае пры рэверце на hardcoded
18. Іншыя памеры шрыфтаў (10–12dp_run, 12/13/20 па-за загалоўкамі) —
па-за межамі. Створана 2026-09-29.*

<!-- showboat-id: issue354-title-size-token -->

Крытэр 1 — памер загалоўка ў кодавых токенах, анкераваны на канонавы
`font.size-title` (18, адзінкі паводле канона — px у каноне, лік у кода).

```sh
grep -n "fontTitleSize" components/design-tokens.ts
```

```output
37:  fontTitleSize: 18, // font.size-title — памер загалоўка экрана
```

Крытэр 2 — усе шэсць экранаў ўжываюць токен: Explore, My KUDY, Побач,
«Гіды», а агульны `screenStyles.title` — яшчэ і прэв'ю маршруту
з дэталямі месца.

```sh
for f in "app/(tabs)/explore.tsx" "app/(tabs)/my.tsx" app/map.tsx "app/city/[id]/guides.tsx" components/screen-styles.ts; do grep -Hn "fontTitleSize" "$f"; done
```

```output
app/(tabs)/explore.tsx:21:    fontSize: tokens.fontTitleSize,
app/(tabs)/my.tsx:33:    fontSize: tokens.fontTitleSize,
app/map.tsx:32:    fontSize: tokens.fontTitleSize,
app/city/[id]/guides.tsx:21:    fontSize: tokens.fontTitleSize,
components/screen-styles.ts:17:    fontSize: tokens.fontTitleSize,
```

Крытэр 3 — guard-тэст design-tokens зелёны: канон ↔ код сінхронныя, а
новы тэст «surface styles consume the canon title token» з'яўляецца
рэверт-гардам — `fontSize: 18` на любой паверхні робіць яго чырвоным
(праверана адкатам аднаго экрана перад push).

```sh
node --test test/design-tokens.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 13
ℹ pass 13
ℹ fail 0
```
