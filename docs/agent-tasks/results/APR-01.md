# APR-01 — праверка production AAB перад публікацыяй

- Issue: [#806](https://github.com/vokhandcrafts/KUDY/issues/806)
- Дата падрыхтоўкі: 2026-10-23
- Базавы каміт `main` для гэтай галіны: `1f448f00534838070fc6489660a5b65eb7c1278b`
- Стан: **заблакавана праверка фактычнага AAB і эмулятара**. Гэты запіс не з'яўляецца справаздачай пра праходжанне Android-прыёмкі.

## Крыніцы і межы наяўнага доказу

У `eas.json` профіль `production.android.package` задае `by.kudy.app`. У `app.json` таксама вызначаны `by.kudy.app`, `newArchEnabled=true` і натыўныя Expo/MapLibre залежнасці. Гэта пацвярджае намер production-канфігурацыі, **але не** эфектыўны target SDK, спіс ABI і выраўноўванне скампіляванага AAB.

У Git няма канчатковага `android/app/build.gradle`: `android/` генеруецца Expo prebuild. Таму значэнні з лакальнага згенераванага Gradle-файла і дэма-APK з [APR-02](APR-02.md) не пераносяцца на production AAB.

Для звычайнага Android-дадатку новыя выпускі ў Google Play з 2026-08-31 патрабуюць target API **36 або вышэй**. Арыгінальная крыніца: [Google Play target API](https://developer.android.com/google/play/requirements/target-sdk). Патрабаванні і каманды для 16 KB: [Android Developers](https://developer.android.com/guide/practices/page-sizes).

## Фактычная матрыца прыёмкі

| Крытэрый #806 | Назіранне на 2026-10-23 | Стан |
| --- | --- | --- |
| AC1 — production AAB, каманда, toolchain, SHA | Профіль production існуе; сам AAB не атрыманы. Версіі фактычнага release toolchain і SHA невядомыя. | Не выканана |
| AC2 — target SDK з AAB / release manifest | Google Play патрабуе API ≥36; значэнне сабранага AAB не прачытана. | Не выканана |
| AC3 — arm64, ELF / APK alignment, запуск на 16 KB | Няма AAB, `bundletool`-вынікаў, APK з гэтага AAB або запуску на эмулятары `PAGE_SIZE=16384`. | Не выканана |
| AC4 — праўкі і рэгрэсійная праверка | Фактычны дэфект AAB пакуль не выяўлены, таму няма што выпраўляць. Play App Signing па лакальных файлах не сцвярджаецца. | Чакае AC1–AC3 |

## Узнаўленне на хосце са зборачнымі інструментамі

Выконваць толькі ў асобным чыстым checkout адпаведнага каміта, без `EXPO_PUBLIC_DEMO_MODE=1`. Не капіраваць у вынікі токены, keystore, сертыфікаты падпісання з сакрэтамі і карыстальніцкія каардынаты.

### 1. Production AAB

```sh
git rev-parse HEAD
node --version
npm --version
java -version
# Выкарыстоўваць штатны production EAS-профіль; аўтэнтыфікацыя на наладжаным runner.
npx eas-cli build --platform android --profile production --non-interactive --wait
```

Спампаваць **AAB менавіта гэтай EAS-зборкі** ў лакальны шлях, запісаць яе build ID, toolchain з журнала EAS і вывад:

```sh
AAB=/absolute/path/to/production.aab
test -s "$AAB"
sha256sum "$AAB"
unzip -t "$AAB"
```

Калі EAS непрыдатны, альтэрнатыўная release-зборка Gradle павінна мець асобна пацверджаную production-канфігурацыю і паходжанне падпісання; debug-подпіс Gradle не з'яўляецца доказам production-публікацыі.

### 2. Метадычныя праверкі самога AAB

Пасля ўсталявання актуальнага [bundletool](https://developer.android.com/tools/bundletool) (тут `bundletool` — каманда ў PATH):

```sh
bundletool dump manifest --bundle="$AAB" --module=base --xpath='/manifest/uses-sdk/@android:targetSdkVersion'
bundletool dump config --bundle="$AAB" | grep alignment
unzip -Z -1 "$AAB" | grep '^base/lib/arm64-v8a/.*\.so$'
```

Зафіксаваць фактычны target API (патрабуецца ≥36), усе `base/lib/arm64-v8a/*.so` і вывад выраўноўвання. `PAGE_ALIGNMENT_16K` — патрэбны сігнал для несціснутых бібліятэк, але **сам па сабе не** даказвае выраўноўванне ELF або працу. Для кожнай arm64 і іншай 64-bit `.so` атрымаць байты з AAB і прагледзець `LOAD` у `llvm-readelf -lW <extracted.so>`; значэнне `Align` павінна быць не меншым за `0x4000`. Пералічыць усе бібліятэкі і занесці вынік па кожнай; адсутнасць `arm64-v8a` — памылка прыёмкі, а не «skip».

### 3. APK, атрыманыя з гэтага AAB, на 16 KB эмулятары

Запусціць Android 15+ эмулятар з **16 KB page-size system image**. Да ўсталявання праверы, што выбрана менавіта патрэбная прылада (калі падлучаныя некалькі, задаць `ANDROID_SERIAL`).

```sh
adb shell getconf PAGE_SIZE
# Працягваць толькі калі адказ роўны 16384.
bundletool build-apks --bundle="$AAB" --output=production-test.apks --connected-device --overwrite
mkdir -p /tmp/kudy-apks
unzip -o production-test.apks '*.apk' -d /tmp/kudy-apks
find /tmp/kudy-apks -name '*.apk' -exec zipalign -c -P 16 -v 4 {} \;
bundletool install-apks --apks=production-test.apks
adb shell monkey -p by.kudy.app 1
```

Захаваць вывад праверкі page size, кожнага `zipalign`, устаноўкі і запуску. Праверыць адкрыццё асноўных экранаў, натыўную карту, аўдыё і стабільнасць без 16 KB compatibility mode; толькі запуск splash-screen не пакрывае runtime. Вынікі запісаць асобна ад unit/CI. APK з `production-test.apks` прызначаны для лакальнай праверкі, а не як доказ Play App Signing.

## Блакіроўка і наступная фіксацыя

Пачатковая спроба: праектны камандны MCP `openai_mcp` вярнуў `UNAVAILABLE: McpServerError: Connection failed`; production AAB і эмулятар былі недасяжныя.

**Паўтор 2026-10-23.** Іншы канектар `mcp-projects` дазваляе абмежаваныя каманды Node/npm без сеткі і без доступу да Android-хоста. У лакальным `/home/viktar/Projects/KUDY` ён паказаў checkout **`opencode/793-followup`** (не `codex/806`), у якім ёсць `android/app/build/outputs/apk` і `logs`, але няма `outputs/bundle`. Пошук `*.aab` у межах `/home/viktar/Projects` даў **0** вынікаў. `android/local.properties` адсутнічае. Такім чынам, няма файла production AAB з пацверджаным паходжаннем, а 16 KB эмулятар не даступны праз гэты sandbox.

Дыягнастычныя, **не прыёмачныя** праверкі старонняга checkout `opencode/793-followup`:
- `npm run arch:check` — exit 0, `626 modules cruised, 0 violation(s)`.
- `npm run typecheck` — exit 2, `TS6053: File '/home/viktar/Projects/KUDY/spikes/G00.03-sandbox-grant/server/device-auth.mjs' not found`.
Гэтыя вынікі **не** пацвярджаюць галіну `codex/806` і не замяняюць AC1–AC3. EAS/Gradle, `bundletool`, `zipalign`, Android SDK/ADB і 16 KB эмулятар не запускаліся; `npm test` і `jscpd` таксама не запускаліся. Падключаны GitHub API не адкрыў endpoint спіса Actions artifacts, таму яго наяўнасць не лічыцца доказам, што AAB існуе.

Блакіроўка па-ранейшаму знешняя: патрэбны production AAB і Android-хост з правяральным 16 KB вобразам. Нельга пазначаць зыходныя крытэрыі зялёнымі паводле прагонаў іншай галіны.

Калі камандны доступ да патрэбнага Android-хоста аднавіцца, унесці рэальныя каманды, toolchain, build ID, SHA-256, target API, вынікі па ўсіх `.so`, вывад 16 KB эмулятара і знойдзеныя дэфекты ў матрыцу вышэй. Толькі пасля гэтага вырашаць, ці патрэбныя кодавыя праўкі, рэгрэсійны тэст і Showboat паводле [правіла](../../agent-rules/showboat.md). Пакуль што не адзначаць GP-01/GP-03/GP-04 як закрытыя.
