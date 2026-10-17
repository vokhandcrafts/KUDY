# G20.34 — праверка пракруткі каталога на Android

17.10.2026: Android Emulator 36 (`kudy-e2e`, 1080×2340), dev client і Metro з гэтай галіны. Лакальны `catalog-origin.mjs` аддаў 100 сінтэтычных гідаў `guide-001`…`guide-100` з тэкстам `be`. Гэта праверка інтэрфейсу; сінтэтычны каталог не з'яўляецца публікацыяй кантэнту. Дакумента гіда ў ім няма, таму прэв'ю пасля пераходу паказвае `route-doc-unavailable`.

## Паўтор

У двух тэрміналах з кораня рэпазіторыя запусціць:

```sh
node docs/testing/evidence/2026-10-17-g2034/catalog-origin.mjs
EXPO_PUBLIC_CATALOG_ORIGIN=http://10.0.2.2:8796 CI=1 npx expo start --dev-client --host localhost --port 8096
```

Другі тэрмінал павінен працаваць асобна ад першага. На запушчаным эмулятары з dev client выканаць `adb reverse tcp:8096 tcp:8096` і адкрыць `exp+kudy://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8096`. На Explore паўтарыць рух уверх па спісе да `guide-100` і націснуць картку. З прэв'ю адкрыць `kudy://city/gdansk/guides`, паўтарыць той жа рух і націснуць апошнюю картку. Для прайгравання вялікага шрыфту ўсталяваць `adb shell settings put system font_scale 2.0`, перазапусціць дадатак, праверыць Explore і вярнуць `font_scale 1.0`.

Здымкі з фактычнага запуску:

- [Explore уверсе](explore-top.png), [у канцы](explore-bottom.png), [павялічаны шрыфт](explore-large-text.png);
- [Guides уверсе](guides-top.png), [у канцы](guides-bottom.png);
- [прэв'ю пасля націску на `guide-100`](last-guide-preview.png).

У абодвух спісах `uiautomator dump` паказаў `guide-card-guide-100`, а пасля націску — `screen-Route preview` і тэкст `guide-100`. Пры `font_scale 2.0` на вузкім экране загаловак і карткі засталіся чытэльнымі. Вымярэння FPS і памяці не праводзіліся.
