# APR-02 — мінімізацыя дазволаў Android

Issue: [#807](https://github.com/vokhandcrafts/KUDY/issues/807). Дата: 2026-10-18.
PR: [#828](https://github.com/vokhandcrafts/KUDY/pull/828).
База: `79abba9`. Стан: **рэалізацыя і Android-прыёмка завершаныя**;
PR чакае рэв'ю і зліцця.

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
| `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` | налады KUDY, MapLibre `13.2.0`, `expo-location:19.0.8` | захаваныя для пазіцыі і карты |
| `FOREGROUND_SERVICE`, `MODIFY_AUDIO_SETTINGS` | налады KUDY, `expo-audio:1.1.1` | захаваныя для лакацыі і аўдыё |
| `INTERNET` | шаблон Expo, MapLibre, `expo-file-system:19.0.24`, RevenueCat `10.20.0`, Google transport CCT `3.1.8` | захаваны для загрузак, карты і праверкі пакупак |
| `ACCESS_NETWORK_STATE` | MapLibre, Media3 `1.8.0`, RevenueCat `10.20.0`, Google transport CCT/runtime `3.1.8` | захаваны для сеткавай карты, плэера і пакупак |
| `ACCESS_WIFI_STATE` | MapLibre `13.2.0` | забаронены; Java-класы і натыўныя бібліятэкі SDK не выклікаюць WiFi API; стан сеткі чытае `ConnectivityManager` |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | `expo-audio:1.1.1` | захаваны для прынятага фонавага прайгравання |
| `com.android.vending.BILLING` | Billing Client `8.3.0` | захаваны для пакупак і аднаўлення доступу |
| `by.kudy.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX Core `1.15.0` | захаваны для абароны дынамічных receiver |

`AudioRecordingService` (`microphone`) адсутнічае ў злітым release-маніфесце.
`AudioControlsService` (`mediaPlayback`, `exported=false`) захаваны паводле
[патрабавання да аўдыё](../../architecture/09_technical_architecture.md), §6.3.
Бягучы адаптар не выклікае `setActiveForLockScreen`: гэты сэрвіс абвешчаны, але яго
актывацыя і lock-screen controls не пацверджаныя. APR-02 іх не дадае; інвентар
перадаецца ў [#811](https://github.com/vokhandcrafts/KUDY/issues/811).
Фактычная перадача: [каментар з інвентаром](https://github.com/vokhandcrafts/KUDY/issues/811#issuecomment-6248274897).

Выдаленне біяметрычных дазволаў не ўключае і не выключае шыфраванне: існы
[адаптар SecureStore](../../../services/device-secure-store.ts) карыстаецца
звычайным Android Keystore без біяметрычнай аўтэнтыфікацыі.

## Завяршальная Android-праверка — 2026-10-18

Першапачатковы блокер ніжэй зняты: выкарыстаны асобны эмулятар
`KUDY_APR02_GOOGLE_API36`, Android 16 / API 36, Google APIs revision 7,
Google Play Services `25.26.35`. Каталог існай аўтаномнай дэма-зборкі дазволіў
выканаць прыёмку без заблакаваных тэставых сервераў.
Location, audio і filesystem — звычайныя натыўныя адаптары з
`controllers/deviceRoot.ts`; дэма замяняе крыніцу кантэнту і выключае натыўную
карту MapLibre. Гэта не праверка загрузкі тайлаў або Play Console.

`:app:assembleRelease` — `BUILD SUCCESSFUL in 5m 30s`, уключна з Android lint.
Гэта лакальны дэма-APK з debug-подпісам, `by.kudy.app.demo`.
SHA-256: `4b83189e2833b32788de7d3129322efc46b5f84fd339e5da2aa0102a75c2c6d7`.
Пасля пераключэння package стары `autolinking.json` яшчэ спасылаўся на
`by.kudy.app.BuildConfig`; выдалены толькі гэты згенераваны файл і зборка паўтораная.
Версіі залежнасцяў і налады праекта для гэтага не мяняліся.

| Сцэнар | Фактычны вынік |
|---|---|
| Загрузка і Start | правераны пакет загружаны; `btn-download` змяніўся на даступны `btn-start`; адкрыўся Run |
| GPS і аўтазапуск | тэставая пазіцыя `54.3480, 18.6530` запусціла першую гісторыю без ручнога Play; статус змяніўся з «гучыць» на «праслухана» |
| Паўза / Працягнуць / Завяршыць | Паўза і Завяршыць вызваляюць доступ да лакацыі; Працягнуць зноў дае `(running)` у Android AppOps; `run-ended` паказаны |
| Яўная адмова ў лакацыі | у Android Settings выбрана `Don’t allow`; усе тры location permissions маюць `granted=false` і `USER_SET`; пасля перазапуску новы Start адкрывае Run |
| Аўдыё пасля адмовы | ручны Play запускае натыўны `AudioTrack`, `state:started`; доступ да лакацыі не мае `(running)` |

У сцэнарыі адмовы банер `run-gps-denied` не з'явіўся; яго UX тут не пазначаны
як правераны. Новы permission UX застаецца ў [#804](https://github.com/vokhandcrafts/KUDY/issues/804).

[Доказы і паўтор праверкі](../../testing/evidence/2026-10-18-apr02/README.md):
сістэмная адмова, экраны, вынікі AppOps і стан натыўнага плэера.
Затым Expo prebuild вернуты да звычайнага `by.kudy.app`;
`:app:processReleaseMainManifest` — `BUILD SUCCESSFUL in 42s`.
[Канчатковы production-маніфест](../../testing/evidence/2026-10-18-apr02/AndroidManifest.xml)
і [вытрымка merger report](../../testing/evidence/2026-10-18-apr02/manifest-merger-permissions.txt)
уваходзяць у PR. У ім няма ўсіх дзевяці забароненых дазволаў і сэрвісу запісу.
Дазволы дэма і production супадаюць, апроч package-прэфікса абароненага receiver.

## Першая натыўная праверка — гісторыя

2026-10-18: GPS і яўная адмова правераныя паўторна ў
[PR #828](https://github.com/vokhandcrafts/KUDY/pull/828); актуальныя вынікі вышэй.
Наступны запіс захоўвае першы няўдалы прагон, а не бягучы стан прыёмкі.

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

### Першы прагон Android

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
| `node --test test/android-release-manifest.test.mjs` | 11 passed, 0 failed |
| `npm test` | Node: 2635 tests, 2563 passed, 0 failed, 72 skipped; Jest: 31 suites, 261 passed; exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run arch:check` | 632 modules, 0 violations |
| `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` | 0 clones |
| `uvx showboat==0.6.1 verify docs/demos/2026-10-18-apr02-android-permissions.md` | exit 0 |

Тэст запускае сапраўдны ланцужок Expo CLI `getPrebuildConfigAsync` →
`compileModsAsync` у introspection-рэжыме. Пустая часовая папка прымушае
генератар узяць чысты шаблон; старыя файлы ў `android/` не маскіруюць адкат.
Няма мокаў генератара або пошуку радкоў у зыходным кодзе.

Паасобнае выдаленне кожнага з дзевяці blockedPermissions і падключэння
плагіна запісу дае адну няўдалую праверку. Усе дзесяць адмоўных эксперыментаў
выкананыя, пасля кожнага зыходныя байты адноўленыя.

Showboat: [выканальны доказ генерацыі](../../demos/2026-10-18-apr02-android-permissions.md).
Ён пацвярджае генерацыю правілаў, а не натыўны прагон GPS.

## Прыёмка і рэв'ю

1. Release-маніфест і merger report атрыманыя; інвентар запісаны вышэй.
2. Непатрэбныя дазволы і сэрвіс запісу выключаныя; location/playback declarations захаваныя.
3. Камітны тэст генерацыі і адмоўныя эксперыменты гатовыя.
4. Android: загрузка, Start, GPS-аўтазапуск, ручное аўдыё пасля яўнай адмовы, Паўза / Працягнуць / Завяршыць правераныя; доказы ў PR.
5. Абодва аўдыёсэрвісы і іх дазволы правераныя ў маніфесце; playback пакінуты з дакладна названым прабелам актывацыі.

Незалежнае рэв'ю кода і паўторнае рэв'ю тэста: 0 critical, 0 high, 0 medium,
0 low. Гэта не вердыкт суддзі і не пацверджанне натыўных сцэнарыяў.

Retest focus: на Android з Google Play Services загрузіць гід, запусціць Run,
праверыць аўдыё, затым адмовіць у доступе да лакацыі — ручны рэжым павінен
застацца даступным без збою. Вяртанне любога забароненага дазволу ў release
або збой playback пасля мінімізацыі азначае рэгрэсію.
