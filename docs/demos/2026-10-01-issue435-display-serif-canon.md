# Дыплей-серыф толькі ў межах канона: тытулы рубрык і месцаў на UI-шрыфце (issue #435)

*Showboat demo для эпіка дызайн-выпраўленняў #346, задача #435. Жывы прагляд
01.10: дыплей-серыф (Alegreya) трапляў на тытул рубрыкі «Чым заняцца» і назвы
месцаў у дэталі — па-за дазволенымі канонам §3 назвамі гідаў і гісторый.
Варыянт (а): тытул рубрыкі, назва месца і тытул падборкі вярнуліся на
UI-сямейства (Golos); дыплей-роля — асобны стыль `screenStyles.displayTitle`,
законны спажывец адзін — route preview (назва гісторыі). Створана 2026-10-01.*

<!-- showboat-id: issue435-display-serif-canon -->

Крытэр 1 — ролі ў адным файле: `title` на UI-сямействе, `displayTitle` на
дыплейным; значэнні — з mirror-токенаў канона.

```sh
grep -n "fontFamily" components/screen-styles.ts
```

```output
28:    fontFamily: tokens.fontFamilyUi,
34:    fontFamily: tokens.fontFamilyDisplay,
```

Крытэр 2 — тытулы рэндзяцца паводле зафіксаванага правіла: рэндэр-тэсты
рубрыкі, падборкі і месцаў мацяродзяць UI-сямейства; дыплей на route preview
трымае ранейшы G06.10.b-тэст (`app/preview.test.tsx`).

```sh
npx jest app/discovery.test.tsx app/place/place.test.tsx -t "issue #435" 2>&1 | grep -E "Test Suites:|Tests:"
```

```output
Test Suites: 2 passed, 2 total
Tests:       12 skipped, 3 passed, 15 total
```

Крытэр 3 — гард шрыфтавых роляў: спажывец `displayTitle` — толькі route
preview, экраны не маю права цягнуць дыплейны токен напрамую. Адкат (рубрыка
або месца зноў на дыплейнай ролі, або `fontFamilyDisplay` у экране) рабіць
гард чырвоным — праверана двума адкатамі перад push.

```sh
node --test test/design-tokens.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 18
ℹ pass 18
ℹ fail 0
```

Жывая праверка (AVD `kudy-test`, Metro з `EXPO_PUBLIC_FAKE_CATALOG=1` на
порце 8084, фейкавы каталог на 8787): тытул «Чым заняцца» рэндзіцца
UI-сансам (Golos), назва гісторыі на прэв'ю гіда — дыплей-серыфам Alegreya.
Скрыншоты: `.scratch/issue-435/screens/discovery-chym-zanyacca-ui-font.png`
і `.scratch/issue-435/screens/preview-history-name-display-font.png`
(untracked).
