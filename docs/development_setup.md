# Development setup — каркас KUDY (G00.04.b)

Мінімальны агульны scaffold: адзін набор SDK для аўдыё/лакацыі/карты/крамы, развядзенне асяроддзяў і ўзгодненыя каманды. Стэк — кандыдатны набор з [ADR G00.04-stack-baseline](architecture/decisions/G00.04-stack-baseline.md) §1; ніводная натыўная зборка яшчэ не правераная (статус .b — `blocked-external`, гл. [result G00.04.b](agent-tasks/results/G00.04.b.md)).

## Патрабаванні

| Інструмент | Версія | Заўвага |
|---|---|---|
| Node.js | 22 LTS (мэта `22.23.2` з lock спайку G00.01) | `engines` у `package.json`: `>=22.12.0 <23`; на Node 24 npm паказвае папярэджанне EBADENGINE, не памылку |
| npm | `10.9.8` | `engines`: `>=10.9.8 <11` |
| EAS CLI | `>= 16.0.0` | толькі для натыўных зборак; праверка `npx eas-cli --version` |
| Android-зборка | JDK + Android SDK альбо EAS build | на хосце G00.04.b адсутныя — зборкі not-run |
| iOS-зборка | macOS + Xcode альбо EAS build | на хосце G00.04.b адсутныя — not-run |

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
| `npm test` | suite `docs/run-model/run-model.test.mjs`: **51 pass / 0 fail** |
| `node docs/run-model/check-regressions.mjs` | **16/16 reviewed regressions rejected. Repository model unchanged.** |
| `npx expo-doctor` | **18/18 checks passed. No issues detected!** |
| `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` | **Found 0 clones** (0.00%) |

`npm test` — адзіны тэставы suite рэпазітара (кантрактная run-model). Ён не правярае натыўны runtime — тое робіць толькі development build на прыладзе.

## Лакальны запуск без натыўнай зборкі

```sh
npx expo start
```

Metro bundler; прэв'ю ў Expo Go або эмулятары. **Абмежаванне:** Expo Go не з'яўляецца доказам стэку — background location, background audio і натыўны рэндэр карты патрабуюць development build (ADR §2). Каркас паказвае толькі тэкст-заглушку (`App.tsx`); выклікаў SDK і прадуктовых экранаў у ім няма.

## Натыўныя зборкі (development build)

Прадумова: профіль `development` мае `developmentClient: true` — EAS патрабуе залежнасць `expo-dev-client` у `package.json` (у каркасе: `~6.0.21`).

```sh
npx eas-cli build --profile development --platform android
npx eas-cli build --profile development --platform ios
```

Пасля ўстаноўкі build-а на прыладу: `npm start` (`expo start --dev-client`).

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
| цэлевы Node/npm | `engines` у `package.json` (фінальны пін — G00.04.c) |

Кандыдатныя дазволы і plugin-налады (expo-location, expo-audio) перанесеныя даслоўна з ADR [G00.01-platform-evidence](architecture/decisions/G00.01-platform-evidence.md) §5.2 як кандыдаты: прыладавай верыфікацыі няма (матрыца спайку G00.01.b — 37/37 not-run). Кананічныя назвы env мяняюцца толькі праз ADR: рэстатэмент кантракту — даслоўная копія, не парафраз (implementation-rules §2).

## Натыўныя змены супраць JS-update

Любы зрух `expo`, `react-native`, `expo-audio`, `expo-location`, `@maplibre/maplibre-react-native`, `react-native-purchases`, змена плагінаў або дазволаў у `app.json`, налад профіляў — гэта новая натыўная зборка. OTA (EAS Update) пакрывае толькі JS; ён тут не наладжаны і не выпраўляе натыўна-несумяшчальны runtime.

## Вядомыя станы і абмежаванні

- `npm audit`: 19 уразлівасцяў (10 moderate, 9 high) у transitive пакетаў (`image-size`, `postcss`, `uuid` і інш.). `npm audit fix --force` зламаў бы запінены набор — не запускаць; перагляд версій — у верыфікацыі G00.04.c.
- Натыўныя зборкі Android/iOS — not-run на хосце G00.04.b: няма JDK/Android SDK/ADB, macOS/Xcode і прылад. Гэта знешні блокер таго самага класа, што ва ўсіх трох спайках.
- Фінальны пін Node/npm, MapLibre RN, RevenueCat SDK, Supabase — задача G00.04.c пасля афіцыйнай верыфікацыі.
