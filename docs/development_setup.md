# Development setup — каркас KUDY (G00.04.b)

Мінімальны агульны scaffold: адзін набор SDK для аўдыё/лакацыі/карты/крамы, развядзенне асяроддзяў і ўзгодненыя каманды. Стэк — кандыдатны набор з [ADR G00.04-stack-baseline](architecture/decisions/G00.04-stack-baseline.md) §1, піны зафіксаваныя ў §6; натыўная зборка на прыладзе ўсё яшчэ не правераная (статус .b/.c — `blocked-external`), але ўсталяванне з lockfile, праверкі і генерация натыўнага праекта Android пацверджаныя на чыстай копіі (гл. [result G00.04.c](agent-tasks/results/G00.04.c.md)).

## Патрабаванні

| Інструмент | Версія | Заўвага |
|---|---|---|
| Node.js | дыяпазон `engines` `>=22.12.0 <27` (афіцыйная падлога стэку — Node `>= 20.19.4`, поле `engines` react-native `0.81.5`; пін 22 LTS пашыраны 2026-09-24 — ADR [G00.04-stack-baseline](architecture/decisions/G00.04-stack-baseline.md) §6) | правераныя практыкай лініі: 22.23 (спайк), 24.13 (сесіі `.b`/`.c` — чысты `npm ci`, doctor 18/18), 26.8 — дэв-хост CachyOS, на ім першы лакальны натыўны build; EBADENGINE не з'яўляецца |
| npm | `>= 10.9.8 < 12` | лініі 10.9.8 і 11.x правераныя практыкай |
| EAS CLI | `>= 16.0.0` | толькі для натыўных зборак; праверка `npx eas-cli --version` |
| Android-зборка | JDK + Android SDK альбо EAS build | 2026-09-24: дэв-хост CachyOS мае поўны набор — JDK 21, Android SDK (cmdline-tools 23.0.0, platform android-36, build-tools 36.0.0, emulator, platform-tools, NDK 27.1 пацягнуты gradle'ам) у `~/Android/Sdk`, `ANDROID_HOME` у `~/.zshenv`; першы лакальны development build (`expo run:android` на эмулятары) — **BUILD SUCCESSFUL in 21m 26s** на Node 26.8.2, дадатак `by.kudy.app` устаноўлены і запушчаны (expo-dev-client), манифест мае ўсе 5 дазволаў лакацыі + `RECORD_AUDIO`. На хостах G00.04.b/.c SDK па-за гэтым няма |
| iOS-зборка | macOS + Xcode альбо EAS build | натыўна немагчыма на Linux-хасце — толькі EAS build (облак) ці Mac; Expo Go на рэальным iPhone не раўназначна development build |

## Устаноўка

```sh
git clone https://github.com/vokhandcrafts/KUDY.git
cd KUDY
npm ci
```

Чакана: `added ~734 packages` (лік ротавацца з платформы — OS-спецыфічныя optional-пакеты: Windows-хост даваў 733, Linux у рэв'ю — 734 — і з патчамі transitive), `node_modules/` створаны. `package-lock.json` у рэпазітары, таму `npm ci`, не `npm install` — ён строгі да lockfile.

## Праверкі

| Каманда | Чаканы вынік |
|---|---|
| `npm run typecheck` | `tsc --noEmit` без вываду, exit 0 |
| `npm test` | **572 pass / 0 fail**: суіты `node --test` (563) + кампанентныя тэсты маршрутаў `app/` праз jest-expo (9) — лік рухавы, звярай са свежым проганам |
| `node docs/run-model/check-regressions.mjs` | **21/21 reviewed regressions rejected. Repository model unchanged.** (вырасла з 16 па той самай прычыне) |
| `npx expo install --check` | **Dependencies are up to date** (піны адпавядаюць чаканым дыяпазонам SDK 54) |
| `npx expo-doctor` | **18/18 checks passed. No issues detected!** |
| `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` | **Found 0 clones** (0.00%) |

`npm test` — два тэставыя рантаймы: `node --test` для кантрактнай мадэлі, інструментарыя і сэрвісаў і jest-expo (`app/**/*.test.tsx`) для кампанентных тэстаў маршрутаў. Ніводзін з іх не правярае натыўны runtime — тое робіць толькі development build на прыладзе.

## Лакальны запуск без натыўнай зборкі

```sh
npx expo start
```

Metro bundler; прэв'ю ў Expo Go або эмулятары. **Абмежаванне:** Expo Go не з'яўляецца доказам стэку — background location, background audio і натыўны рэндэр карты патрабуюць development build (ADR §2). Дадатак мантуецца праз Expo Router (`app/`): маршруты `19` §2.5 — заглушки з імем экрана і яго params, рэальнага прадуктовага UI яшчэ няма (G06.06–G06.08); выклікаў SDK у ім няма.

## Натыўныя зборкі (development build)

Прадумова: профіль `development` мае `developmentClient: true` — EAS патрабуе залежнасць `expo-dev-client` у `package.json` (у каркасе: `~6.0.21`).

```sh
npx eas-cli build --profile development --platform android
npx eas-cli build --profile development --platform ios
```

Пасля ўстаноўкі build-а на прыладу: `npm start` (`expo start --dev-client`).

EAS-зборка патрабуе акаўнта; найбліжэйшы лакальна дасяжны натыўны доказ — генерация натыўнага праекта без зборкі:

```sh
npx expo prebuild --platform android --no-install
```

Чакана: `android/` створаны; у `android/app/src/main/AndroidManifest.xml` прысутнічаюць усе пяць кантрактных дазволаў лакацыі (`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`) і аўдыё (`RECORD_AUDIO`), ланцуг плагінаў expo-location → expo-audio → @maplibre/maplibre-react-native → expo-asset прымяняецца без памылак — праверана на чыстай копіі (G00.04.c). Для iOS тая ж каманда на Windows адмаўляецца («Run … again from macOS or Linux») — платформавая мяжа генератара; поўная зборка з натыўным рантаймам даказваецца толькі development build на прыладзе.

Чакана: каркас адкрываецца на прыладзе. Каркас сам не выклікае нілакацыю, ні аўдыё — дазволы толькі аб'яўленыя ў `app.json` як кандыдаты; спайкавыя канстанты (dwell, accuracy, bundle id) не перанесеныя. Профілі адрозніваюцца толькі application IDs — набор канфігаў адзін.

## Профілі і асяроддзі

| Профіль `eas.json` | application ID (iOS `bundleIdentifier` = Android `package`) | Прызначэнне |
|---|---|---|
| `development` | `by.kudy.app.dev` | development client, internal distribution |
| `sandbox` | `by.kudy.app.sandbox` | sandbox-праверка пакупкі/restore; ASC sandbox-тэстэры / Google Play internal testing — эксплуатацыйныя налады G08 |
| `production` | `by.kudy.app` | стор; дэплой толькі па асобным даручэнні |

Спайкавы `by.kudy.g0001a` наўмысна не выкарыстоўваецца (ADR §1: «bundle id `by.kudy.g0001a` — толькі спайкавы»).

## Зменныя асяроддзя

```sh
cp .env.example .env
```

Шаблон змяшчае толькі кліенцкія кананічныя назвы — `REVENUECAT_PUBLIC_SDK_KEY`, `GRANT_SERVER_BASE_URL` (даслоўна з ADR §3). Серверных назваў у кліенцкім шаблоне няма наўмысна: кліент не атрымлівае серверных зменных (`09` §5). `.env*` gitignored (`!.env.example`). Для EAS-зборак значэнні задаюцца сакрэтамі профіля, не ў `eas.json`.

## Дзе што мяняць

| Змяненне | Файл |
|---|---|
| версіі SDK | `package.json` + `npm install` для lockfile |
| дазволы, плагіны, New Architecture | `app.json` |
| application IDs, профілі зборкі | `eas.json` |
| кананічныя назвы env | толькі праз рашэнне ў ADR (гл. ніжэй) |
| цэлевы Node/npm | `engines` у `package.json` (абгрунтаванне піну — ADR §6; любая змена — разам з перагенераваным lockfile) |

Кандыдатныя дазволы і plugin-налады (expo-location, expo-audio) перанесеныя даслоўна з ADR [G00.01-platform-evidence](architecture/decisions/G00.01-platform-evidence.md) §5.2 як кандыдаты: прыладавай верыфікацыі няма (матрыца спайку G00.01.b — 37/37 not-run). Кананічныя назвы env мяняюцца толькі праз ADR: рэстатэмент кантракту — даслоўная копія, не парафраз (implementation-rules §2).

## Натыўныя змены супраць JS-update

Любы зрух `expo`, `react-native`, `expo-audio`, `expo-location`, `@maplibre/maplibre-react-native`, `react-native-purchases`, змена плагінаў або дазволаў у `app.json`, налад профіляў — гэта новая натыўная зборка. OTA (EAS Update) пакрывае толькі JS; ён тут не наладжаны і не выпраўляе натыўна-несумяшчальны runtime.

## Вядомыя станы і абмежаванні

- `npm audit`: 19 уразлівасцяў (10 moderate, 9 high), у тым ліку без dev-залежнасцей — усе тры дзёркавыя transitive (`uuid@7.0.3`, `postcss@8.4.49`, `image-size@1.2.1`) ляглі пад expo-інструмантарыяй (`@expo/config-plugins` → xcode, `@expo/metro-config`, `@expo/metro` → metro); прапанаваны `npm audit fix` пераставіў бы expo `57.0.23` — скачок SDK-лініі, адхілены. `audit fix --force` — не запускаць; перагляд разам з чарговай верыфікацыяй SDK-лініі.
- Натыўныя зборкі Android/iOS — not-run на хостах G00.04.b/.c: няма Android SDK/ADB (`adb`, `ANDROID_HOME` адсутнічаюць), macOS/Xcode і прылад; JDK 25 (Temurin) на хосце .c з'явіўся, але сам па сабе зборкі не дае. Гэта знешні блокер таго самага класа, што ва ўсіх трох спайках.
- Піны зафіксаваныя ў ADR [G00.04-stack-baseline](architecture/decisions/G00.04-stack-baseline.md) §6 (G00.04.c): MapLibre RN `11.3.10` і react-native-purchases `10.9.1` — актуальныя latest рэестра з выкананымі peers; expo `~54.0.37` — вяршыня праверанай лініі SDK 54 (даступны SDK 57 наўмысна не браліся); Supabase-пакета ў дрэве няма — пін упершыню запатрабуецца з production-бэкендам (G08).
