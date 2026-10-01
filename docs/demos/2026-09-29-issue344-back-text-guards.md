# Клас #344: подпіс back-кнопкі жыве ў `<Text>` (issue #344)

*Showboat demo закрыцця issue #344. Абодва яго знаходкі — голы «← Горад» у
`app/city/[id]/guides.tsx` і голы `{strings.back}` у `app/run/[id].tsx` —
фізічна знятыя PR #357 (issue #348): агульны `components/back-button.tsx`
трымае подпіс у `<Text>`-дзіцяці, абодва экраны ім карыстаюцца. У целе PR
#357 радок `Closes #344` не фігураваў (толькі проза «закрывае #344»), таму
GitHub не зачыніў issue пры мержы. Гэты запіс перавярае крытэры issue на
main @ 4d24d3a ў гэтай сесіі. Створана 2026-09-29.*

<!-- showboat-id: issue344-back-text-guards -->

Дэма ганяе гарды з `app/back-navigation.test.tsx` і
`components/back-button.test.tsx`: тэкставы запыт `within().getByText()`
дасягае толькі радкоў усярэдзіне `<Text>`-хаста, таму вернуты голы радок у
`<Pressable>` валіць свой радок табліцы (механізм фіксу #343).

```sh
node_modules/.bin/jest app/back-navigation.test.tsx components/back-button.test.tsx 2>&1 | grep -E "^(Test Suites:|Tests:|Snapshots:)"
```

```output
Test Suites: 2 passed, 2 total
Tests:       13 passed, 13 total
Snapshots:   0 total
```

Эксперымент па зняцці фікса (implementation-rules 1) выкананы ў гэтай сесіі:
`<Text style={styles.label}>` прыбраны з `components/back-button.tsx:47` —
`app/back-navigation.test.tsx` зачырвонеў: упалі радкі «guides», «run» і
астатніх экранаў табліцы, зялёным застаўся толькі стартавы «без back».
Пасля аднаўлення абгорткі той жа запуск — зялёны.

Крытэры issue на main @ 4d24d3a:

1. «← Горад» у `<Text>` — `app/city/[id]/guides.tsx:43` ідзе праз
   `BackButton`; расстаноўка фіксу #343: `styles.touch` (водступ, цэль
   дотыку) на Pressable, `styles.label` (колер/шрыфт) на Text
   (`components/back-button.tsx:47`).
2. `{strings.back}` у `<Text>` — `app/run/[id].tsx:343` (недаступны стан),
   `:358` (загрузка), `:428` (гатовы) — усе тры праз `BackButton`.
3. Рэндэр-праверка на зняцце абгорткі — радкі «guides» і «run» у табліцы
   `app/back-navigation.test.tsx:25–38`; эксперымент вышэй.
4. Device-пруф — на хасце гэтай сесіі не выконваўся (стан ніжэй). Жывы
   прагон абодвух экранаў выконваўся 2026-09-28 у сесіі #357 (AVD
   `kudy-test`, дып-лінкі `city/gdansk/guides` і `run/r1` у недаступным
   стане; скрыншоты `04-guides.png`, `07-run.png`) — працэдура і вынік:
   `docs/demos/2026-09-28-issue348-navigation-frame.md`.

Стан хаста гэтай сесіі (implementation-rules 9 — сцвярджэнне пра прыладу
пацвярджаецца выводам, а не прозай):

```sh
command -v adb >/dev/null 2>&1 && adb devices || echo "adb: not found"
```

```output
adb: not found
```
