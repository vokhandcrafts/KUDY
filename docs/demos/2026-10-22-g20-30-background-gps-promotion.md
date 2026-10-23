# G20.30 (#792) — перадача GPS пасля позняга дазволу на фон

Дэманстрацыя рэгрэсійнай праверкі PR [#841](https://github.com/vokhandcrafts/KUDY/pull/841). Прыкладныя фіксы GPS сінтэтычныя; каманды запускаюць сапраўдныя `LocationService` і `ExpoLocationOsPort`, замяняючы толькі мяжу Expo. Гэта **не** фізічны Android-тэст.

## Дэтэрмінаваная праверка перадачы

Сцэнарыі: халодны Run і city → Run з чаканнем адказу дазволу; захаванне foreground-watch да паспяховага `startLocationUpdatesAsync`; выдаленне старога watch і адхіленне яго позніх callbacks; нязменнасць падпіскі пры native-start failure; паўза або новы дазвол падчас гонкі.

Запускаць з кораня рэпазіторыя на галіне PR #841 пасля `npm ci`:

```bash
set -o pipefail; node --no-warnings --test --experimental-strip-types --experimental-test-module-mocks --test-reporter=tap services/location/expo/expo-location-port.test.ts 2>/dev/null | grep -E '^# (tests|pass|fail) '
```

```output
# tests 25
# pass 25
# fail 0
```

Вынік **25/25** засведчаны незалежным код-рэв'ю для HEAD `90aebce31820`; гэты output-блок неабходна перазахапіць і верыфікаваць на фінальным HEAD. Ён не паходзіць ад лакальнага запуску ў сесіі аўтара.

## Існая ахова ад адкату

Гэты guard падмяняе цалкам production-адаптар у ізаляванай праверцы, выдаляе ахову ад запозненага `watchPositionAsync` і патрабуе падзення рэгрэсійнага тэсту. Ён не замяняе праверку ўзроўню прылады.

```bash
set -o pipefail; node --no-warnings --test --test-reporter=tap tools/ci/adapter-revert-guard.test.mjs 2>/dev/null | grep -E '^# (tests|pass|fail) '
```

```output
# tests 5
# pass 5
# fail 0
```

Вынік **5/5** узяты з незалежнага код-рэв'ю, а не з запуску гэтага дакумента.

## Верыфікацыя Showboat

З кораня рэпазіторыя выканаць:

```sh
uvx showboat==0.6.1 verify docs/demos/2026-10-22-g20-30-background-gps-promotion.md
```

**Стан на 2026-10-22:** выкананне гэтай каманды і перазахоп output-блокаў **не пацверджаны**. Аддалены shell KUDY праз MCP недаступны; у ізаляваным кантэйнеры `uvx --offline` паведамляе, што `showboat==0.6.1` няма ў кэшы і сетка адключана. Таму нельга называць гэты дакумент Showboat-верыфікаваным або закрываць знаходку [#848](https://github.com/vokhandcrafts/KUDY/issues/848) да запуску на рэальным runner.

## Асобная натыўная прыёмка

На фізічнай Android-прыладзе трэба праверыць позні дазвол на фон падчас Run (без страты GPS-фіксаў), адмову (foreground працягваецца), паўторны grant (без дублявання background-task) і Pause/End у час чакання дазволу ды запуску native-task (ніякага аднаўлення пасля stop). Аўтаматычныя тэсты Expo з заглушкамі гэтай праверкі не замяняюць.
