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
па-за межамі. Створана 2026-09-29. Output-блокі перазахопленыя
2026-10-01 у PR issue #435 (зрух радкоў пасля зліццяў + split
screen-styles; rule 11).*

<!-- showboat-id: issue354-title-size-token -->

Крытэр 1 — памер загалоўка ў кодавых токенах, анкераваны на канонавы
`font.size-title` (18, адзінкі паводле канона — px у каноне, лік у кода).

```sh
grep -n "fontTitleSize" components/design-tokens.ts
```

```output
41:  fontTitleSize: 18, // font.size-title — памер загалоўка экрана
```

Крытэр 2 — усе шэсць экранаў ўжываюць токен: My KUDY, Побач, а агульны
`screenStyles.title` — прэв'ю маршруту з дэталямі месца; загалоўкі Explore
і «Гіды» з G06.05 (#280) жывуць у агульным `CityCatalogBody`
(`components/guide-card.tsx`), таму ў самых экранах больш няма ніякага
памеру загалоўка.

```sh
for f in "app/(tabs)/my.tsx" app/map.tsx components/screen-styles.ts components/guide-card.tsx; do grep -Hn "fontTitleSize" "$f"; done
```

```output
app/(tabs)/my.tsx:38:    fontSize: tokens.fontTitleSize,
app/map.tsx:35:    fontSize: tokens.fontTitleSize,
components/screen-styles.ts:15:  fontSize: tokens.fontTitleSize,
components/guide-card.tsx:126:    fontSize: tokens.fontTitleSize,
```

Крытэр 3 — guard-тэст design-tokens зелёны: канон ↔ код сінхронныя, а
новы тэст «surface styles consume the canon title token» з'яўляецца
рэверт-гардам — `fontSize: 18` на любой паверхні робіць яго чырвоным
(праверана адкатам аднаго экрана перад push).

```sh
node --test test/design-tokens.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 18
ℹ pass 18
ℹ fail 0
```
