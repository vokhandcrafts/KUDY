# Кольца іконкі на мяжы: пераўстаноўка дэмапакета (2026-11-01)

Заўвага ўладара 2026-11-01: на прыладзе меднае абрамленне «вісяць» усярэдзіне
круга, з крэмавым абадком да краю іконкі. Гэта рэндэр экспартаў **да**
геаметрычнай праўкі 2026-10-28 (`6ccfed86`, PR #872): медальён з кольцам
складае 58,4 % палатна (63 dp з 108 dp), а стандартная маска лаўнчара выдае
72 dp — таму звонку медальёна застаецца крэмавае кольца, а тонкае меднае
акантоўка медальёна на малым памеры змешваецца ў пэрсікавы абадок.

Асэты ў main ужо маюць кольца на ўзроўні маскі (медальён 678/1024 ≈ 71,5 dp):
ніякай новай змены малюнка не патрабуецца. Фіксацыя на прыладзе — новая
натыўная зборка і паўторная ўстаноўка APK.

Жывая праверка на AVD `kudy-test` (emulator-5554, Android 36):

1. устаноўлены дэмапакет меў `lastUpdateTime=2026-10-27 23:44` — да фікса;
   лаўнчар паказвае кольца ўсярэдзіне
   (`docs/testing/evidence/2026-11-01-issue429-reinstall/launcher-before-reinstall.png`);
2. перазборка dev-client з дрэва main (`expo prebuild -p android` →
   `JAVA_HOME=java-21 gradlew assembleDebug`) і `adb install -r` — лаўнчар
   паказвае кольца на самой мяжы круга
   (`launcher-after-reinstall.png`, крупы `dock-icon-before.png` /
   `dock-icon-after.png`, параўнанне `dock-icon-before-after.png`).

Гэтыя праверкі фіксуюць склад рэсурсаў і кантракт, а не заменяюць агляд на
рэальнай прыладзе ўладара; для тэлефона патрэбны тыя самыя перазборка і
усталёўка.

<!-- showboat-id: icon-ring-reinstall-2026-11-01 -->

Гард-тэсты кантракту іконкі на дрэве main:

```sh
node --test --test-reporter=tap test/app-icon-config.test.mjs test/app-icon-bounds.test.mjs tools/android-build/with-shape-aware-icons.test.mjs 2>&1 | grep -E '^# (tests|pass|fail) '
```

```output
# tests 7
# pass 7
# fail 0
```

Згенераваныя prebuild-ам рэсы лаўнчара супадаюць байт-у-байт з прынятымі
экспартамі (парадак: спачатку `npx expo prebuild --platform android --no-install`):

```sh
cmp android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp assets/kudy-icon/native-android/ic_launcher-xxxhdpi.webp && echo legacy-identical
cmp android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round_foreground.webp assets/kudy-icon/native-android/ic_launcher_round_foreground-xxxhdpi.webp && echo round-fg-identical
```

```output
legacy-identical
round-fg-identical
```
