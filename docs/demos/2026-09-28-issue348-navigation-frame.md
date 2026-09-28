# UX 02: адзіная навігацыйная рама (issue #348)

*Showboat demo для эпіка дызайн-выпраўленняў #346, задача #348: натыўны
хедар Stack выводзіў сыравыя назвы рутаў (`(tabs)/explore`, `route/[id]`)
і дубліраваў уласныя back-кнопкі; на «Побач» back не было ўвогуле; голыя
радкі ў Pressable (гэты ж клас, што #343/#344) былі нябачнымі і кідалі
LogBox-папярэджанне. Створана 2026-09-28.*

<!-- showboat-id: issue348-navigation-frame -->

Дэма ганяе чатыры гард-сюты (гэта рэчыва змены): вытворчы лэйаўт мантуе
Stack з `headerShown: false`; на кожным не-стартавым экране роўна адзін
back-элемент і яго подпіс жыве ў `<Text>` (механізм гарда #344:
`within().getByText()` дасягае толькі `<Text>`-хастоў — вернуты голы радок
у Pressable валіць свой тэст); кантэнт кожнага экрана пачынаецца ніжэй
зашпіленага top-інсэта (50 + 16 = 66); агульны кампанент трыма a11y-праводку
і цэль дотыку ≥44×44dp.

```sh
node_modules/.bin/jest app/layout-header.test.tsx app/back-navigation.test.tsx app/safe-area.test.tsx components/back-button.test.tsx 2>&1 | grep -E "^(Test Suites:|Tests:|Snapshots:)"
```

```output
Test Suites: 4 passed, 4 total
Tests:       18 passed, 18 total
Snapshots:   0 total
```

Эксперымент па зняцці фікса (implementation-rules 1) выкананы ў гэтай
сесіі: `app/_layout.tsx` адкінуты да HEAD праз stash — гард вытворчага
лэйаўта зачырвонеў адзіным упалым тэстам; `app/city/[id]/guides.tsx`
адкінуты да HEAD (голы радок «← Горад» у Pressable) — свой радок
тэбліцы зачырвонеў, астатнія 6 засталіся зелёнымі. Пасля `stash pop`
той жа запуск — зелёны.

Жывая праверка ўбудовы (таго ж дня, AVD `kudy-test`, роздум 1080×2400
420dpi): Metro з галінкі задачы, халодны старт праз дэв-лаунчар на
`http://10.0.2.2:8081`, астатнія экраны — праз дып-лінкі `kudy://<шлях>`
(map, my, city/gdansk/guides, route/r1, place/p1, run/r1). На гэтай
зборцы каталог і run-порты не прыбылі — экраны паказваюць сумленныя
недаступныя станы; рама (хедар, back, інсэты) ад гэтага не залежыць.
Сям экранаў: нідзе няма сыравай назвы рута; стартавы «Агляд» — без back,
рэшта — з адным бачным «← Назад»; кантэнт ніжэй статус-бара і выразкі.
Ніжні інсэт панэляў Run на жывой прагулцы не правяраўся — run-порты на
гэтай зборцы не сканструяваныя; пакрыццё — юніт-гвард
`app/safe-area.test.tsx` і змены `app/run/[id].tsx` (paddingBottom
панэляў = spaceM + insets.bottom).
Скрыншоты: `.scratch/ux02-frame/screens/` (untracked): `01-explore.png`,
`02-map.png`, `03-my.png`, `04-guides.png`, `05-preview.png`,
`06-place.png`, `07-run.png`.
