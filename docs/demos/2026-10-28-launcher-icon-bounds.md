# Межы абразкоў запуску KUDY (2026-10-28)

Заўвага заснавальніка: раней Android паказваў медны круг унутры вялікага
крэмавага дыска, а квадратная рамка таксама мела лішнія палі. Цяпер
квадратная рамка даходзіць да краю квадратнага экспарту; круглая — да
межаў Android adaptive mask. Экспарты для круглых і квадратных сістэмных
форм асобныя і захоўваюцца пасля Expo prebuild.

<!-- showboat-id: launcher-icon-bounds-2026-10-28 -->

Праверка рэсурсаў, кантракту Expo і рэсурсаў, якія копіюе build plugin:

```sh
node --test test/app-icon-config.test.mjs test/app-icon-bounds.test.mjs tools/android-build/with-shape-aware-icons.test.mjs 2>&1 | grep -E '^✔ '
```

```output
✔ square launcher frame reaches the output edges (not an inset painted frame)
✔ round adaptive border occupies the Android masked viewport edge
✔ square adaptive foreground is not the round image and fills its square mask
✔ Expo config carries the accepted brand icon, adaptive layers and splash
✔ every configured brand asset file exists in the repository
✔ demo build keeps its own icon and does not inherit the production adaptive icon
✔ native prebuild install uses distinct square/round launcher images and foregrounds
```

Праверка рэальнай рэгенерацыі натыўных рэсурсаў: `npx expo prebuild --platform android --no-install`;
затым параўнаць `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp`
з `assets/kudy-icon/native-android/ic_launcher-xxxhdpi.webp` і адпаведны
`ic_launcher_round.webp`. Для `mipmap-anydpi-v26/ic_launcher_round.xml`
павінен быць `@mipmap/ic_launcher_round_foreground`, у
`ic_launcher.xml` — `@mipmap/ic_launcher_foreground`.

Гэтыя праверкі фіксуюць склад native-рэсурсаў, а не замяняюць агляд на
рэальнай прыладзе. Для ўбачанай на тэлефоне іконкі неабходная новая
натыўная зборка і паўторная ўстаноўка APK.
