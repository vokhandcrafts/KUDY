# UX 03: націск бачны (issue #349)

*Showboat demo для эпіка дызайн-выпраўленняў #346, задача #349: ніводзін
націскальны элемент не меў бачнай рэакцыі націску, спасылкі «Побач» і
«Гіды» не выглядалі націскальнымі, дробныя цэлі дотыку. Змены: адна
агульная абгортка `PressableSurface` (android_ripple на Android,
зацямненне ≥10% праз opacity на астатніх шляхах), маркер «→» і
accessibilityRole на «Побач»/«Гіды», hitSlop да ≥44dp на спасылках і
кантроле тэйзера. Back-кнопкі і экран Run не кранутыя (UX 02 #348 / UX 04
#350). Створана 2026-09-28.*

<!-- showboat-id: issue349-pressed-state -->

Дэма ганяе guard-сьют агульнай абгорткі (крытэрый 4): accessibilityRole
даходзіць да націскальнага элемента, pressed-стан зацямняе паверхню на
≥10%, спакойны стан не цямнее, android_ripple зачэплены ў крыніцы
абгорткі. Зняцце pressed-галіны валіць свой тэст.

```sh
node_modules/.bin/jest components/pressable-surface.test.tsx 2>&1 | grep -E "^(Test Suites:|Tests:|Snapshots:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
```

Эксперымент па зняцці фіксу (implementation-rules 1) выкананы ў гэтай
сесіі: з `components/pressable-surface.tsx` часова выдалена галіна
`state.pressed && styles.pressed` — сьют зачырвонеў адзіным упалым тэстам
«the pressed state dims the surface by ≥10%»; пасля аднаўлення той жа
запуск — зелёны.

Пакрыццё: усе націскальныя элементы асноўных экранаў (кнопка «Прагулка»,
карткі гідаў і месцаў, кантрол прайгравання тэйзера, спасылкі, галоўная
кнопка і кнопкі дыялогу §4.1 прэв'ю) рэндэрацца праз адну абгортку — 12
выклікаў у 6 файлах, ніводнай другой копіі хелпера.

```sh
grep -rln "PressableSurface" app components --include="*.tsx" | grep -v "\.test\." | LC_ALL=C sort
```

```output
app/(tabs)/explore.tsx
app/map.tsx
app/place/[id].tsx
app/route/[id].tsx
components/guide-card.tsx
components/pressable-surface.tsx
components/walk-button.tsx
```

Жывая AVD-праверка з бачным pressed-станам (Proof ішуя) у гэтай сесіі не
знята: на хасце няма adb і эмулятара (`which adb emulator` → not found),
таму візуальная прыёмка не праводзілася. Паводзіны pressed-стану
доказаныя праграмна guard-сьютам вышэй і поўным `npm test`.
