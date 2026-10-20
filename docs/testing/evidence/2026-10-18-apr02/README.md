# APR-02 — натыўны доказ Android

Дата: 2026-10-18. [PR #828](https://github.com/vokhandcrafts/KUDY/pull/828).
[Вынік задачы](../../../agent-tasks/results/APR-02.md).

`AndroidManifest.xml` атрыманы з `:app:processReleaseMainManifest` для звычайнага
`by.kudy.app`. `manifest-merger-permissions.txt` — вытрымка ўсіх вузлоў
`uses-permission`, `permission` і аўдыёсэрвісаў з Gradle merger report;
абсалютныя шляхі хоста замененыя на `<checkout>` і `<gradle-cache>`.

`native-proof.json` захоўвае SHA-256 усталяванага дэма-APK, сапраўдныя адказы
Android Package Manager / AppOps і стан натыўнага аўдыё. Усе маршруты,
гісторыі і каардынаты сінтэтычныя. Хост — Windows, Node `v24.13.0`,
JDK `17.0.20.1`, Gradle `8.14.3`; эмулятар — Android 16, Google APIs revision 7.

Існая [аўтаномная дэма-зборка](../../../demo-preview.md) выкарыстоўвае
звычайныя location/audio/filesystem адаптары і ўбудаваны каталог.
Яна паказвае схему замест натыўнай карты MapLibre. Здымкі не пацвярджаюць
загрузку тайлаў, lock-screen controls або прыняцце дадатку Google Play.

## Паўтор праверкі

1. Збяры APK паводле `docs/demo-preview.md` з `EXPO_NO_DOTENV=1` і `EXPO_NO_TELEMETRY=1`.
2. Усталюй яго камандай `adb install -r android/app/build/outputs/apk/release/app-release.apk` на чысты тэставы Android з Google Play Services; не дадавай `-g`.
3. Адкрый KUDY Demo → «Тры гісторыі старога горада · дэма» → «Загрузіць». Дачакайся «Пачаць» і запусці прагулку.
4. Адкрый Android Settings → App info → KUDY Demo → Permissions → Location. Выберы `Allow all the time`.
5. Перазапусці KUDY Demo, завяршы старую сесію і націсні «Пачаць» для новай. Перадай `adb emu geo fix 18.6530 54.3480`: першая гісторыя павінна запусціцца без ручнога Play і перайсці ў «праслухана».
6. Націсні «Прыпыніць прагулку», затым «Працягнуць». У `adb shell cmd appops get by.kudy.app.demo MONITOR_LOCATION` пазнака `(running)` знікае і вяртаецца адпаведна.
7. Завяршы прагулку з пацверджаннем. Экран паказвае завершаную сесію, а AppOps больш не мае `(running)`.
8. У сістэмным экране Location для KUDY Demo выберы `Don’t allow`; перазапусці дадатак і пачні новую прагулку.
9. Адкрый картку кропкі і націсні «Граць». У `adb shell dumpsys audio` плэер працэсу KUDY Demo мае `state:started`; `MONITOR_LOCATION` не мае `(running)`, а location permissions у `adb shell dumpsys package by.kudy.app.demo` маюць `granted=false`.

Банер `run-gps-denied` у гэтым прагоне не з'явіўся. Праверка пацвярджае
адмову Android, адсутнасць доступу да лакацыі і даступны ручны Play;
новы permission UX належыць [#804](https://github.com/vokhandcrafts/KUDY/issues/804).

## Здымкі

- [Пакет загружаны, Start даступны](download-ready.png).
- [Яўная сістэмная адмова](system-location-denied.png).
- [Новая прагулка і ручное аўдыё пасля адмовы](denied-start-and-play.png).
- [Гісторыя праслуханая пасля GPS-аўтазапуску](gps-autoplay.png).
- [Завершаная прагулка](ended.png).
