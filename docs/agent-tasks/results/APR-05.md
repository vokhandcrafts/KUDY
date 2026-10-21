# APR-05 — edge-to-edge на Android 15 і 16

Дата: 2026-10-18. Задача: [#810](https://github.com/vokhandcrafts/KUDY/issues/810). Вынік: дзевяць экранаў атрымалі ніжні сістэмны inset. З іх Explore, preview, карта і My KUDY маюць здымкі з эмулятараў Android 15 і 16; Guides, Place, Feedback, Collection і Discovery правераны render-тэстамі без асобных прыладавых здымкаў. Run, дыялог і экран памылкі таксама ёсць у прыладавай матрыцы; перасабраны release APK правераны на Android 16 у вузкім акне.

## Артэфакт і асяроддзе

- `EXPO_PUBLIC_DEMO_MODE=1 npx expo prebuild --platform android --no-install`
- `EXPO_PUBLIC_DEMO_MODE=1 ANDROID_HOME=/home/viktar/Android/Sdk ANDROID_SDK_ROOT=/home/viktar/Android/Sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk GRADLE_USER_HOME=/tmp/kudy-810-gradle ./gradlew :app:assembleRelease -PreactNativeArchitectures=x86_64 --no-daemon --max-workers=2` — `BUILD SUCCESSFUL`.
- `aapt dump badging android/app/build/outputs/apk/release/app-release.apk` — `package: name='by.kudy.app.demo'`, `targetSdkVersion:'36'`, `compileSdkVersion='36'`.
- SHA-256 першай зборкі APK: `b21b55d846bf3ea82cc494c41c0cb34c094bf79418c5895f452abbaf44ccec96`. Яна была ўсталявана на абодвух эмулятарах і дала першую матрыцу з 28 здымкаў.
- SHA-256 зборкі пасля рэв’ю: `46f207121a6beb787d3e6b33c2962a063f8bc09b9276566971483c3197b9909d`. Яна ўсталявана на Android 16 для дадатковай праверкі ў вузкім акне. APK не каміціцца.
- Android 15: AVD `kudy-apr05-api35`, API 35, 1080×2400. Android 16: AVD `kudy-e2e`, API 36, 1080×2340. Абодва — Google APIs, x86_64. `settings get secure navigation_mode` вярнуў `2` для жэстаў і `0` для трох кнопак. На Android 15 трохкнопкавая панэль займала 126 px, на Android 16 — 132 px паводле `dumpsys window`.

Правераныя значэнні з тэрмінала:

```text
Android 15: adb shell getprop ro.build.version.release  → 15
Android 16: adb shell getprop ro.build.version.release  → 16
adb shell settings get secure navigation_mode          → 2 (жэсты), 0 (тры кнопкі)
Android 15: dumpsys window navigationBars frame         → [0,2274][1080,2400]
Android 16: dumpsys window navigationBars frame         → [0,2208][1080,2340]
aapt dump badging app-release.apk                        → targetSdkVersion:'36'
```

Гэта лакальная release-зборка з дэманстрацыйным каталогам і тэставым package id, а не файл з Play Console. Яна правярае адступы і дасяжнасць дзеянняў у release-рэжыме.

## Скрыншоты

Усе PNG зроблены праз `adb exec-out screencap -p` 2026-10-18. Першая матрыца знята з першай зборкі APK; новыя здымкі вузкага акна — са зборкі пасля рэв’ю. Файлы знаходзяцца ў [каталогу доказаў](../../testing/evidence/2026-10-18-apr05/README.md).

| Экран | Android 15, жэсты | Android 15, 3 кнопкі | Android 16, жэсты | Android 16, 3 кнопкі |
| --- | --- | --- | --- | --- |
| Explore | [PNG](../../testing/evidence/2026-10-18-apr05/android15-gesture-explore.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android15-threebutton-explore.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-gesture-explore.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-threebutton-explore.png) |
| Preview | [PNG](../../testing/evidence/2026-10-18-apr05/android15-gesture-preview.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android15-threebutton-preview.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-gesture-preview.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-threebutton-preview.png) |
| Run | [PNG](../../testing/evidence/2026-10-18-apr05/android15-gesture-run.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android15-threebutton-run.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-gesture-run.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-threebutton-run.png) |
| Карта «Побач» | [PNG](../../testing/evidence/2026-10-18-apr05/android15-gesture-map.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android15-threebutton-map.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-gesture-map.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-threebutton-map.png) |
| My KUDY | [PNG](../../testing/evidence/2026-10-18-apr05/android15-gesture-my.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android15-threebutton-my.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-gesture-my.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-threebutton-my.png) |
| Дыялог завяршэння | [PNG](../../testing/evidence/2026-10-18-apr05/android15-gesture-dialog.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android15-threebutton-dialog.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-gesture-dialog.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-threebutton-dialog.png) |
| Недаступны гід | [PNG](../../testing/evidence/2026-10-18-apr05/android15-gesture-error.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android15-threebutton-error.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-gesture-error.png) | [PNG](../../testing/evidence/2026-10-18-apr05/android16-threebutton-error.png) |

На ўсіх гэтых экранах бачныя сістэмная панэль і асноўнае дзеянне або паведамленне. Preview і Run маюць ніжнія дзеянні над панэллю; пракрутка спісу preview засталася даступнай. Экран недаступнага гіда адкрыты праз `kudy://route/no-such-route`.

Пасля рэв’ю APK перасабраны і ўсталяваны на Android 16. Каманды `adb shell wm size 720x1280`, `adb shell wm density 360` задалі вузкае акно 320 dp; `settings get secure navigation_mode` вярнуў `0`, а `dumpsys window` паказаў ніжнюю панэль `[0,1172][720,1280]` вышынёй 108 px. [Пачатак preview](../../testing/evidence/2026-10-18-apr05/android16-threebutton-720x1280-preview-start.png) паказвае, што першая картка абразаецца ніжнім краем акна; пасля двух пракрутак [апошняя картка і кнопка «Загрузіць»](../../testing/evidence/2026-10-18-apr05/android16-threebutton-720x1280-preview-end.png) бачныя цалкам над панэллю. Гэтыя два здымкі правяраюць менавіта дасяжнасць канца пракруткі; яны не з’яўляюцца параўнаннем APK да і пасля праўкі.

Клавіятурны сцэнар не прымяняецца да гэтага APK: пошук `TextInput`, `KeyboardAvoidingView` і `keyboard` у `app/` і `components/` не знайшоў палёў уводу або экраннай клавіятуры. Увод праз сістэмныя налады і знешнюю клавіятуру адносіцца да адаптыўнага аб'ёму APR-10.

## Рэгрэсійныя праверкі

- `app/safe-area.test.tsx`: пры `top=50`, `bottom=34`, шырыні 320 dp правярае ніжні inset Explore, Guides, Preview, Map, My KUDY, Place, Collection, Discovery і Feedback. Пры часовым адкаце першых пяці runtime-файлаў да `origin/main` атрымана `5 failed, 8 passed`; пасля вяртання — `13 passed`. Новыя чатыры праверкі перад праўкай далі `4 failed, 16 passed`, пасля праўкі — `20 passed`. Верхні inset правяраецца тым жа наборам; Run — `app/run.test.tsx`.
- `npm run typecheck` — прайшоў.
- `npm test` — Node: 2593 пройдзена, 31 прапушчаны, 0 памылак; Jest: 31 набор, 273 тэсты пройдзены.
- `npm run arch:check` — 0 парушэнняў на лакальным Linux; колькасць прааналізаваных модуляў залежыць ад асяроддзя.
- `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` — 0 клонаў.
- [Showboat](../../demos/2026-10-18-apr05-edge-to-edge.md) захоўвае дэтэрмінаваны вывад render-тэстаў і візуальны прыклад.

Межы: скрыншоты пацвярджаюць эмулятары і дэманстрацыйны змест. Play-публікацыя, рэальныя прылады, арыентацыя і планшэтная раскладка тут не правяраліся.
