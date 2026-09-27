# Прэв'ю гіда: «← Назад» у `<Text>` (issue #343)

*Showboat demo для фіксу дэфекту #343: голы радок «← Назад» як дзіця
`<Pressable>` у `app/route/[id].tsx` даваў LogBox «Text strings must be
rendered within a <Text> component». Створана 2026-09-28.*

<!-- showboat-id: issue343-preview-back-text -->

Дэма ганяе guard-тэст з `app/preview.test.tsx`: тэкставы запыт RNTL дасягае
толькі радкоў усярэдзіне `<Text>`-хаста, таму зняцце абгорткі валіць тэст.
Эксперымент па зняцці абгорткі (implementation-rules 1) выкананы ў гэтай
сесіі: на голым радке тэст даваў чырвоны `1 failed, 7 skipped`, пасля
аднаўлення абгорткі — ніжэйшы вывод; два прагону запар байт-у-байт
ідэнтычныя.

```sh
node_modules/.bin/jest app/preview.test.tsx -t "Text host" 2>&1 | grep -E "^(Test Suites:|Tests:|Snapshots:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       7 skipped, 1 passed, 8 total
Snapshots:   0 total
```

Жывая праверка ўбудовы (таго ж дня, AVD `kudy-test`, Metro з
`EXPO_PUBLIC_FAKE_CATALOG=1`, фэйкавы каталог-сервер на 8787): халодны старт
→ націск на запіс сервера `10.0.2.2:8081` → каталог «Гданьск» з карткамі
гідаў → прэв'ю «Гісторыі сукнараў: ад мытні да порта» — LogBox не з'яўляецца,
Metro-лог бяз «Text strings must be rendered», «← Назад» рэндэрыцца як
стылізаваны тэкст колеру акцэнту і націсканнем вяртае на каталог.
Скрыншоты: `.scratch/issue343/` (untracked). Той самы клас дэфекту на
суседніх экранах (`app/city/[id]/guides.tsx` — голы «← Горад»,
`app/run/[id].tsx` — `{strings.back}` у недаступным стане) па-за межамі
гэтай задачы і зарэгістраваны асобна.
