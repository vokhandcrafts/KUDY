# APR-01 — лакальная праверка Android AAB

Дата: 2026-11-02. Задача: [#806](https://github.com/vokhandcrafts/KUDY/issues/806). Зыходны каміт зборкі: `2b29970e`. Статус: **заблакавана**; production AAB яшчэ не пацверджаны.

| Крытэр | Вынік |
| --- | --- |
| 1. Production AAB | Не пацверджаны. Лакальны `release` AAB падпісаны debug-ключом, таму не з'яўляецца пацверджаным production-артэфактам. |
| 2. Target API | У лакальным AAB `targetSdkVersion=36`; production AAB трэба праверыць асобна. Паводле [Google Play](https://developer.android.com/google/play/requirements/target-sdk), з 31.08.2026 для новага выпуску патрэбны API 36 або вышэй. |
| 3. 64-bit і 16 KB | У лакальным AAB ёсць `arm64-v8a`; правераны ELF64, упакоўка і запуск на эмулятары. Гэты вынік не замяняе праверку production AAB. |
| 4. Збоі | Выпраўленняў не рабілі. Патрэбны пацверджаны production AAB; стан Play App Signing тут не вызначаецца. |

## Лакальная зборка

На Windows x64 папярэдняя сесія выканала `npx expo prebuild -p android --no-install`, затым з каталога `android` — `./gradlew :app:bundleRelease --console=plain`. Выкарыстоўваліся JDK 17.0.20.1, Expo `~54.0.37`, React Native `0.81.5` і Android SDK 36. Зборка завяршылася паспяхова. У згенераваным `android/app/build.gradle` для `release` пазначаны `signingConfigs.debug`; эквівалентнасць профілю EAS `production` і падпісанаму для выпуску артэфакту не даказаная.

Файл `app-release.aab`: 101044932 байты; SHA-256 `7e02b48cda27d9fbff292d0e293676127eb1fd2bdbe0ba177a8ee94a07306e25`. Сам AAB застаецца лакальна ў `android/app/build/outputs/bundle/release/` у checkout `KUDY-968`.

## Доказ лакальнага артэфакта

- `bundletool 1.18.3 dump manifest` паказаў package `by.kudy.app` і target SDK 36: [вывад](../../testing/evidence/2026-11-02-apr01/aab-dump-manifest.txt).
- Лакальная праверка ELF паказала 50 ELF64 з мінімальным `p_align` не меншым за 16384, у тым ліку 20 для arm64: [вывад](../../testing/evidence/2026-11-02-apr01/elf-16k-check.txt). Гэта вынік аднаразовага скрыпта, які прапускаў ELF32; паўтары праверку production AAB афіцыйным інструментам.
- `bundletool dump config` паказаў `PAGE_ALIGNMENT_16K`; `zipalign -c -P 16 -v 4 universal.apk` вярнуў `Verification successful` для APK, створанага з гэтага AAB і асобна падпісанага debug-ключом.
- Android 16 x86_64 эмулятар паказаў `getconf PAGE_SIZE` = 16384. APK усталяваны і запушчаны, `MainActivity` была ў фокусе: [журнал](../../testing/evidence/2026-11-02-apr01/emulator-16k-run.txt), [скрыншот](../../testing/evidence/2026-11-02-apr01/app-by-kudy-16k.png). Гэта правярае запуск на эмулятары, а не ўсе сцэнары і не запуск arm64 на фізічнай прыладзе.

## Наступны крок

Атрымаць пацверджаны production AAB праз належны профіль і падпісанне без перадачы сакрэтаў у чат; запісаць каманду, версіі і SHA-256, затым паўтарыць праверкі target API, 64-bit, 16 KB і запуску менавіта для гэтага артэфакта. Публікацыя ў Play і рэгістрацыя Play Console за межамі гэтай задачы.

## Праверкі checkout

Папярэдняя сесія на `2b29970e` выканала `npm run typecheck` і `npm run arch:check` паспяхова. `npm test` завяршыўся з 6 памылкамі, 2815 паспяховымі і 73 прапушчанымі тэстамі з 2894; тыя ж шэсць назваў памылак ёсць у базавым прагоне гэтага ж каміта. `jscpd` паведаміў пра 0 клонаў; код выхаду асобна не зафіксаваны. Гэта гістарычныя вынікі да запісу гэтага файла, не праверка production AAB.
