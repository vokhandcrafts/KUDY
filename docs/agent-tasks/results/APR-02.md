# APR-02 — мінімізацыя дазволаў Android

Issue: [#807](https://github.com/vokhandcrafts/KUDY/issues/807). Дата: 2026-10-18.
База: `79abba9`. Стан: **blocked-external**; праўка падрыхтаваная, яўная адмова
ў дазволе на лакацыю яшчэ не правераная. PR застаецца чарнавіком.

## Змены і паходжанне дазволаў

`app.json` выкарыстоўвае падтрыманы Expo `android.blockedPermissions`.
`with-playback-only.cjs` выключае толькі сэрвіс запісу праз Android
`tools:node="remove"`. Залежнасці і location-адаптар не мяняліся.

Паходжанне зверанае са злітым release-маніфестам і справаздачай Gradle
`manifest-merger-release-report.txt`:

| Дазвол | Крыніца | Рашэнне |
|---|---|---|
| `RECORD_AUDIO` | `expo-audio:1.1.1` | забаронены; запісу ў KUDY няма |
| `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` | шаблон Expo, `expo-file-system:19.0.24` | забаронены; загрузкі выкарыстоўваюць прыватнае сховішча дадатку |
| `SYSTEM_ALERT_WINDOW` | шаблон Expo | забаронены ў release; debug-маніфест асобна пакідае яго для dev client |
| `FOREGROUND_SERVICE_MICROPHONE` | неабавязковая магчымасць плагіна `expo-audio`; у release-залежнасці не запытваецца | забаронены; фонавы запіс выключаны |
| `VIBRATE` | шаблон Expo | забаронены; выклікаў вібрацыі няма |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | `androidx.biometric:biometric:1.1.0`, праз SecureStore | забаронены; адаптар не ўключае `requireAuthentication` |
| `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION` | налады KUDY | захаваныя для фонавай прагулкі |
| `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` | налады KUDY, MapLibre `13.2.0` | захаваныя для пазіцыі і карты |
| `FOREGROUND_SERVICE`, `MODIFY_AUDIO_SETTINGS` | налады KUDY, `expo-audio:1.1.1` | захаваныя для лакацыі і аўдыё |
| `INTERNET` | шаблон Expo, MapLibre | захаваны для загрузак і сеткавых сэрвісаў |
| `ACCESS_NETWORK_STATE` | MapLibre, Media3 `1.8.0` | захаваны для сеткавай карты і плэера |
| `ACCESS_WIFI_STATE` | MapLibre `13.2.0` | захаваны з SDK карты; асобная неабходнасць у бягучым сцэнарыі яшчэ не пацверджаная |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | `expo-audio:1.1.1` | захаваны для прынятага фонавага прайгравання |
| `com.android.vending.BILLING` | Billing Client `8.3.0` | захаваны для пакупак і аднаўлення доступу |
| `by.kudy.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX Core `1.15.0` | захаваны для абароны дынамічных receiver |

`AudioRecordingService` (`microphone`) адсутнічае ў злітым release-маніфесце.
`AudioControlsService` (`mediaPlayback`, `exported=false`) захаваны паводле
[патрабавання да аўдыё](../../architecture/09_technical_architecture.md), §6.3.
Бягучы адаптар не выклікае `setActiveForLockScreen`: гэты сэрвіс абвешчаны, але яго
актывацыя і lock-screen controls не пацверджаныя. APR-02 іх не дадае; інвентар
перадаецца ў [#811](https://github.com/vokhandcrafts/KUDY/issues/811).

Выдаленне біяметрычных дазволаў не ўключае і не выключае шыфраванне: існы
[адаптар SecureStore](../../../services/device-secure-store.ts) карыстаецца
звычайным Android Keystore без біяметрычнай аўтэнтыфікацыі.

## Натыўны доказ

Хост: Windows, Node `v24.13.0`, JDK `17.0.20.1`, Gradle `8.14.3`, Android API 36,
эмулятар `KUDY_API36`, `emulator-5568`, Android 16. Тэставы кантэнт сінтэтычны.

Expo prebuild і `:app:assembleDebug` выкананыя пасля апошняй праўкі.
SHA-256 усталяванага APK:
`cea8fd5e00d4ddc280cc3ab6c78c2610a803dcddb80dab3dfbff6ae9c2b13d64`.

`:app:processReleaseMainManifest` завяршыўся паспяхова, `BUILD SUCCESSFUL in 2m 4s`.
Усе восем забароненых дазволаў адсутнічаюць у канчатковым XML.
SHA-256 злітага release-маніфеста:
`e1e67d96c0250e76470268f93ef5cd9bb2a58a4e01b93301352f1150a1a6ce8a`.

Арыгіналы доказаў захаваныя лакальна ў ігнараваным `android/`:
`app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml`
і `app/build/outputs/logs/manifest-merger-release-report.txt`. Яны не ўваходзяць
у PR; табліца вышэй запісвае праверанае паходжанне і рашэнне па кожным дазволе.

Кэш зборкі не меў патрэбных архіваў. Уладальнік дазволіў Maven Central і
`repo.reactnative.dev`; версіі Apollo `4.3.1`, Composables `1.37.0`, React Native
і Hermes `0.81.5` загружаныя па HTTPS і звераныя з апублікаванымі SHA-256.
Gradle выкарыстоўваў лакальны Maven-каталог і `--offline`. Версіі праекта
і рэпазіторыі залежнасцяў у кодзе не мяняліся.

## Прагон Android

Каманда:

```text
node tools/e2e-android/run-e2e.mjs --suite walk --serial emulator-5568 --metro-port 8097 --origin-port 8897
```

Вынік: **3 passed, 2 failed**, exit 1.

| Сцэнар | Вынік |
|---|---|
| Explore, каталог і preview | pass |
| Загрузка праверанага пакета і даступнасць Start | pass |
| GPS, аўтазапуск, Pause, Back | fail: `location listeners did not start` |
| End і гісторыя | fail пасля папярэдняга збою: `the live session row was not captured` |
| Start без свежай пазіцыі і ручны Play | pass; натыўны плэер актыўны |
| Яўная адмова ў location permission | not-run; застаецца крытэрыем прыёмкі |

Лог натыўнага прайгравання не замяняе доказ фонавага playback.
У эмулятары няма Google Play Services; журнал дае `SERVICE_INVALID` і
`by.kudy.app requires the Google Play Store, but it is missing.` Падпіска
спыняецца з `Location request failed due to unsatisfied device settings`.
Гэта не пазначана як паспяховая праверка GPS.

Артыфакты прагону:
`tools/e2e-android/artifacts/2026-10-18T01-45-49-438Z/` — лакальныя, gitignored.
Паўторны запуск эмулятара і лакальных тэставых сервераў заблакаваны
аўтаматычнай праверкай дазволу з адказам `blocked by policy`, без тлумачэння
прычыны. Абход не выконваўся.

## Камітныя праверкі

| Каманда | Вынік |
|---|---|
| `node --test test/android-release-manifest.test.mjs` | 10 passed, 0 failed |
| `npm test` | Node: 2562 passed, 0 failed, 72 skipped; Jest: 31 suites, 261 passed; exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run arch:check` | 632 modules, 0 violations |
| `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` | 0 clones |
| `uvx showboat==0.6.1 verify docs/demos/2026-10-18-apr02-android-permissions.md` | exit 0 |

Тэст запускае сапраўдны ланцужок Expo CLI `getPrebuildConfigAsync` →
`compileModsAsync` у introspection-рэжыме. Пустая часовая папка прымушае
генератар узяць чысты шаблон; старыя файлы ў `android/` не маскіруюць адкат.
Няма мокаў генератара або пошуку радкоў у зыходным кодзе.

Паасобнае выдаленне кожнага з васьмі blockedPermissions і падключэння
плагіна запісу дае адну няўдалую праверку. Усе дзевяць адмоўных эксперыментаў
выкананыя, пасля кожнага зыходныя байты адноўленыя.

Showboat: [выканальны доказ генерацыі](../../demos/2026-10-18-apr02-android-permissions.md).
Ён пацвярджае генерацыю правілаў, а не натыўны прагон GPS.

## Прыёмка і рэв'ю

1. Release-маніфест і merger report атрыманыя; інвентар запісаны вышэй.
2. Непатрэбныя дазволы і сэрвіс запісу выключаныя; location/playback declarations захаваныя.
3. Камітны тэст генерацыі і адмоўныя эксперыменты гатовыя.
4. **Не завершана:** яўная адмова ў location permission; поўны GPS-прагон патрабуе прыдатнага эмулятара або прылады.
5. Абодва аўдыёсэрвісы і іх дазволы правераныя ў маніфесце; playback пакінуты з дакладна названым прабелам актывацыі.

Незалежнае рэв'ю кода і паўторнае рэв'ю тэста: 0 critical, 0 high, 0 medium,
0 low. Гэта не вердыкт суддзі і не пацверджанне натыўных сцэнарыяў.

Retest focus: на Android з Google Play Services загрузіць гід, запусціць Run,
праверыць аўдыё, затым адмовіць у доступе да лакацыі — ручны рэжым павінен
застацца даступным без збою. Вяртанне любога забароненага дазволу ў release
або збой playback пасля мінімізацыі азначае рэгрэсію.
