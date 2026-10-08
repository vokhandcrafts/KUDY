# Development setup — каркас KUDY (G00.04.b)

Мінімальны агульны scaffold: адзін набор SDK для аўдыё/лакацыі/карты/крамы, развядзенне асяроддзяў і ўзгодненыя каманды. Стэк — кандыдатны набор з [ADR G00.04-stack-baseline](architecture/decisions/G00.04-stack-baseline.md) §1, піны зафіксаваныя ў §6; натыўная зборка на прыладзе ўсё яшчэ не правераная (статус .b/.c — `blocked-external`), але ўсталяванне з lockfile, праверкі і генерация натыўнага праекта Android пацверджаныя на чыстай копіі (гл. [result G00.04.c](agent-tasks/results/G00.04.c.md)).

## Патрабаванні

| Інструмент | Версія | Заўвага |
|---|---|---|
| Node.js | дыяпазон `engines` `>=22.12.0 <27` (афіцыйная падлога стэку — Node `>= 20.19.4`, поле `engines` react-native `0.81.5`; пін 22 LTS пашыраны 2026-09-24 — ADR [G00.04-stack-baseline](architecture/decisions/G00.04-stack-baseline.md) §6) | правераныя практыкай лініі: 22.23 (спайк), 24.13 (сесіі `.b`/`.c` — чысты `npm ci`, doctor 18/18), 26.8 — дэв-хост CachyOS, на ім першы лакальны натыўны build; EBADENGINE не з'яўляецца |
| npm | `>= 10.9.8 < 13` | лініі 10.9.8 і 11.x правераныя практыкай; 12.x — pacman-пакет дэв-хоста CachyOS (12.0.2), пашырэнне дыяпазону знімае EBADENGINE-шум (semver 12.0.2 ⊂ `>=10.9.8 <13`; не назірана — npm 12 яшчэ не ўстаноўлены), праверка `npm ci` на 12 — наступная праверка дэв-хоста |
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
| `npm test` | **зялёны прагон**: суіты `node --test` + кампанентныя тэсты маршрутаў `app/` праз jest-expo; поўны лік тестаў дае сама каманда — ён рухавы, звярай са свежым проганам, а не з гэтай табліцы |
| `node docs/run-model/check-regressions.mjs` | **усе зарэгістрыраваныя мутацыі адхілены. Repository model unchanged.** (лік расце разам з мутацыямі — гл. вывод каманды) |
| `npx expo install --check` | **Dependencies are up to date** (піны адпавядаюць чаканым дыяпазонам SDK 54) |
| `npx expo-doctor` | **No issues detected!** — усе праверкі пройдуць; іх лік расце з SDK |
| `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` | **Found 0 clones** (0.00%) |

`npm test` — два тэставыя рантаймы: `node --test` для кантрактнай мадэлі, інструментарыя і сэрвісаў і jest-expo (`app/**/*.test.tsx`) для кампанентных тэстаў маршрутаў. Ніводзін з іх не правярае натыўны runtime — тое робіць толькі development build на прыладзе.

## Лакальны запуск без натыўнай зборкі

```sh
npx expo start
```

Metro bundler; прэв'ю ў Expo Go або эмулятары. **Абмежаванне:** Expo Go не з'яўляецца доказам стэку — background location, background audio і натыўны рэндэр карты патрабуюць development build (ADR §2). Дадатак мантуецца праз Expo Router (`app/`): маршруты `19` §2.5 — заглушки з імем экрана і яго params, рэальнага прадуктовага UI яшчэ няма (G06.06–G06.08); выклікаў SDK у ім няма.

Абнаўленне 2026-09-27 (issue #338, першы паспяховы device-run): у гэтым стэку Expo Go недаступны — натыўныя карта, аўдыё і крамы патрабуюць development build. Працоўны спосаб: development build (`by.kudy.app`) на эмулятары/прыладзе + `npm start` (`expo start --dev-client`) — дадатак грузіць бандл з запушчанага Metro праз Dev Launcher. Зборку бандла трымаюць два файлы ў кораню рэпазітара: `metro.config.js` — blockList выключае `*.test.*` і службовыя тэчкі `.mimosa`/`.zcode`/`.scratch` (require.context expo-router цягне jest-сюты з `app/` у бандл), а `resolveRequest` перанакіроўвае `node:*` на стаб; і `metro-node-stub.js` — проксі, каторы кідае іменаваную памылку толькі пры выкліку builtin-а (сам імпарт праходзіць: прадуктовы ланцуг з `app/` node-free пасля пераносу safe-path ідыёму ў `services/safe-path.ts`). Wiring абодвух элементаў ахаваны committed тэстам `tools/metro-config/metro-config.test.mjs` — падае пры выдаленні любога з іх. Хрушкасць вотчара: на ФС не-ext4 metro-file-map FallbackWatcher падае з `ENOENT`, калі паралельная сесія выдаляе `.mimosa/hook-state/sess_*.lock` падчас яго прагулкі — дастаткова перазапусціць Metro.

## E2E-каталог: сінтэтычны origin (`npm run e2e:origin`)

Адна каманда збірае сінтэтычныя фікстуры `fixtures/e2e/*` вытворчым шляхам
публікацыі (`tools/build-bundle` → `tools/publish-catalog`) і серверытуе
вынік як каталог-поход для дадатку і скразных аўтатэстаў (G23.01, issue
[#659](https://github.com/vokhandcrafts/KUDY/issues/659)); рэальнага кантэнту
і знешняга хосту там няма.

```sh
npm run e2e:origin            # збора + сервер на :8791
npm run e2e:origin -- --port 8792
npm run e2e:origin -- --fault "404:discovery/e2e-city/r-e2e-free-1/index.json,500:catalog.json" --stall-ms 15000
npm run e2e:origin -- --no-serve   # толькі збора + кароткі справаздача
```

Каманда друкуе значэнне `EXPO_PUBLIC_CATALOG_ORIGIN=http://localhost:<порт>`
для хоста і `http://10.0.2.2:<порт>` для Android-эмулятара (10.0.2.2 —
лупбек хоста з эмулятара). Зборка дэтэрміністычная: час публікацыі запінены,
таму два прагоны кладуць байт-ідэнтычныя файлы — сюіты могуць звяраць
дакладны кантэнт па sha256 `catalog.json` (рэгіструецца ў справаздачы
выканання). Вывад збора жыве ў `tools/e2e-origin/build/` — gitignored.
Fault-пераключальнік (`404:` / `500:` / `stall:` для іменаваных файлаў
адносна кораня origin) патрэбны сцэнарыям збояў G23.05–G23.06; `stall`
трымае адказ `--stall-ms` (дэфолт 15000) і потым адказвае звычайна, таму
кліенцкі тэймаўт павінен быць карацейшым за stall. Захаванне цэласнасці і
транспартныя правілы — як у вытворчай публікацыі; змены кантракту бандла —
вон з межаў задачы.

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

## Лакальная debug-зборка Android на Windows

Працэдура для Windows-хоста з уласнымі Android SDK і JDK 17 (issue
[#592](https://github.com/vokhandcrafts/KUDY/issues/592), вынік і доказы — [G21.36](agent-tasks/results/G21.36.md)).
Яна працуе з апублікаванага checkout і не патрабуе ні скрэтч-файлаў, ні пэўнай раскладкі дыскаў: JDK, SDK,
хатняя тэчка Gradle і часовыя файлы задаюцца толькі для працэсу зборкі, глабальныя наладкі не мяняюцца.

| Параметр | Што гэта | Прыклад |
|---|---|---|
| `$Checkout` | чысты checkout гэтага рэпазітара на дыску з запасам месца (`node_modules` і вынікі зборкі займаюць некалькі ГБ) | `D:\KUDY-592` |
| `$BuildRoot` | тэчка, якой валодае толькі гэтая зборка: хатняя тэчка Gradle, temp, журналы, запісы зборак; па-за checkout і не корань дыска, у тым ліку па рэальным шляху (junction на checkout або яго бацькоўскую тэчку адхіляецца) | `D:\KUDY-592-build` |
| `$Sdk` | Android SDK з `platform-tools`, `platforms;android-36`, `emulator` | `D:\KUDY-Android\sdk` |
| `$Jdk` | JDK 17; сістэмны `JAVA_HOME` (напрыклад, JDK 25) не выкарыстоўваецца | `D:\KUDY-Android\java\jdk-17.0.20.1+1` |

```powershell
cd $Checkout
npm ci
npx expo prebuild --platform android --no-install
git status --short          # чакана пуста: android/ ігнаруецца; змены package.json/lock ад інструментаў — у рэвю, не адкатваць
$common = @('--build-root', $BuildRoot, '--sdk', $Sdk, '--jdk', $Jdk)
node tools/android-build/android-build.mjs preflight @common
node tools/android-build/android-build.mjs clean @common            # толькі паказвае, што будзе выдалена
node tools/android-build/android-build.mjs clean --apply @common
node tools/android-build/android-build.mjs build @common
node tools/android-build/android-build.mjs build --rerun-tasks @common   # паўтор: кожная задача зноў чысціць свае вынікі
```

- `preflight` друкуе версіі (Node, npm, JDK, Gradle wrapper, SDK, React Native, Expo) і спыняе працу, калі JDK не 17, у SDK няма
  `adb`, няма `android/` або ў гэтым checkout ці `$BuildRoot` ужо працуе Java/Gradle-працэс.
- `build` запісвае ў `$BuildRoot\gradle-home\gradle.properties` абмежаванні: без Gradle-дэмана, `--max-workers` (2),
  памяць `--gradle-heap` (3g), temp `$BuildRoot\tmp` (аргумент `-Djava.io.tmpdir` цалкам у двукоссі, таму шлях з
  прабелам застаецца адным аргументам, а не-ASCII літары запісваюцца як `\uXXXX`), кампіляцыя Kotlin унутры працэсу зборкі (без асобнага дэмана кампілятара, які перажывае
  зборку і трымае файлы), `--abi` (`x86_64` для эмулятара; усе чатыры — `armeabi-v7a,arm64-v8a,x86,x86_64`) і
  `--timeout-minutes` (90), пасля якога спыняецца толькі дрэва працэсаў гэтай зборкі. Журнал — у `$BuildRoot\logs`,
  запіс з камандай, версіямі, кодам выхаду, працягласцю, памерам і SHA-256 `android\app\build\outputs\apk\debug\app-debug.apk` —
  у `$BuildRoot\records`.
- `build` піша толькі ва ўласныя тэчкі `$BuildRoot` (`gradle-home`, `tmp`, `logs`, `records`). Да першага запісу кожная
  з іх павінна быць звычайнай тэчкай, рэальны шлях якой роўна `<рэальны $BuildRoot>\<імя>`, а `gradle.properties` — звычайным
  файлам без іншых жорсткіх спасылак. Junction або спасылка (напрыклад, `gradle-home` на агульную хатнюю тэчку Gradle) не
  праходзіцца: `preflight` называе такі шлях, а `build` спыняецца з кодам 73 і нічога не піша. Прыбярыце спасылку або
  вазьміце іншы `$BuildRoot`.
- `--ro-dep-cache <тэчка з modules-2>` — неабавязковы агульны кэш залежнасцей толькі для чытання (Gradle `GRADLE_RO_DEP_CACHE`):
  залежнасці не спампоўваюцца нанова, а Gradle у гэты кэш не піша.
- `clean` разглядае толькі згенераваныя тэчкі: `android\.gradle`, `android\build`, `android\app\build`, `android\app\.cxx`
  і `build`/`.cxx` побач з кожным Gradle-праектам у `node_modules` (`.gradle` — толькі побач з `settings.gradle`). Кожная мэта
  разгортваецца ў рэальны шлях, уключна з junction і ўкладзенымі спасылкамі, і павінна ляжаць у checkout або `$BuildRoot`,
  быць git-ignored і не мець адсочваных файлаў. Абодва карані параўноўваюцца па рэальных шляхах, а мэта, у шляху да якой
  ёсць спасылка (напрыклад, `android` — junction на іншую тэчку), адхіляецца. Калі хоць адна мэта адхіленая, не выдаляецца
  нічога (код 2), а прычына друкуецца. Калі файл трымае іншы працэс, `clean` спыняецца з кодам 1 і паказвае магчымых
  трымальнікаў. Глабальныя кэшы (`%USERPROFILE%\.gradle`, агульная хатняя тэчка Gradle, кэш npm) не кранаюцца.
- `build` і `clean --apply` бяруць блакіроўку checkout (`.git\kudy-android-build.lock`) да праверкі працэсаў і трымаюць яе
  да канца. Другі такі выклік у тым самым checkout адразу завяршаецца з кодам 75 і паказвае, хто трымае блакіроўку.
  Блакіроўку працэсу, якога ўжо няма (напрыклад, зборка спынена праз `taskkill /F` або закрытае акно), інструмент сам
  не забірае: выклік завяршаецца з кодам 75 і паведамленнем `stale checkout lock <файл> left by process <PID> (<каманда>,
  host <хост>, started <час>)`. Калі ў гэтым checkout сапраўды не ідзе ніводзін `build` або `clean`, выдаліце гэты файл
  уручную (`Remove-Item <файл>`; шлях — `git rev-parse --absolute-git-dir` + `\kudy-android-build.lock`) і паўтарыце
  каманду. Аўтаматычны перахоп небяспечны: два выклікі, што ўбачылі аднаго мёртвага ўладальніка, маглі б выдаліць
  свежую блакіроўку адзін аднаго. `clean --apply` нічога не выдаляе, пакуль жывы
  Java-працэс гэтага checkout або `$BuildRoot` (код 3), нават калі той запушчаны без гэтага інструмента.
- `stop-owned` спыняе толькі Java-працэсы (Gradle, дэман Kotlin), у камандным радку якіх ёсць `$BuildRoot`; Java-працэсы
  іншых checkout толькі пералічваюцца, а PowerShell, Node і іншыя працэсы не разглядаюцца зусім.

Прычыны, з-за якіх працэдура менавіта такая (падрабязна — у выніку G21.36): у рэтэсце 2026-10-04 скрэтч-скрыпт ініцыялізацыі
падмяняў тэчкі `build` у агульным checkout на junction у агульны каталог на другім дыску і запускаў PowerShell на кожны
праект; дэман кампілятара Kotlin з няўдалай зборкі заставаўся жывым да двух гадзін і трымаў вынікі `compileKotlin`, таму
наступная зборка не магла іх выдаліць (`Failed to clean up output files`).

Праверка на эмулятары (патрэбны AVD з x86_64-вобразам; `$Avd`, `$AvdHome`, `$AndroidUserHome` — свае для хоста):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/android-build/emulator-scenarios.ps1 `
  -BuildRoot $BuildRoot -Sdk $Sdk -AvdHome $AvdHome -AndroidUserHome $AndroidUserHome -Avd $Avd `
  -Apk android\app\build\outputs\apk\debug\app-debug.apk
```

Скрыпт запускае эмулятар без снапшота, усталёўвае APK, запускае Metro з гэтага ж checkout з абмежаваннем
(`expo start --dev-client --port 8083 --max-workers 2`), прабрасвае порт праз `adb reverse` і адкрывае
`kudy://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8083`. Потым праходзіць сцэнарыі рэтэсту
2026-10-04: навігацыя Explore → Побач / Чым заняцца / KUDY і назад, пераключэнне мовы без перазапуску,
глыбокія спасылкі на неіснуючыя экраны, буйны шрыфт (`font_scale` 1.5) і вяртанне з фону. Вынік — UI-дампы,
здымкі экрана, буфер крашаў і `results.json` у `$BuildRoot\evidence\android`. У канцы скрыпт вяртае `font_scale` 1.0
і спыняе толькі эмулятар і Metro, якія ён сам запусціў.

Чужыя эмулятар і Metro скрыпт не кранае. Калі порт эмулятара (`-EmuPort`, 5558, і наступны, 5559), порт Metro
(`-MetroPort`, 8083) ужо заняты або `emulator-5558` ужо ёсць у `adb devices`, ён нічога не запускае. Каманды да
`emulator-5558` і `emu kill` ідуць толькі тады, калі порт эмулятара слухае працэс з дрэва запушчанага скрыптам
`emulator.exe`; порт Metro таксама павінен належаць запушчанаму скрыптам Metro. Калі свой эмулятар або Metro
завяршаецца падчас чакання, прагон спыняецца. Код выхаду 0 — толькі калі прайшлі ўсе 26 праверак і буфер крашаў
пусты; інакш 1, а прычыны — у `failureReasons` у `results.json` і ў радках `NOT OK` журнала.
Кожны UI-дамп пішацца ў новы файл на прыладзе, а папярэдні лакальны файл выдаляецца да дампа. Калі `uiautomator dump`
не ўдаўся, файл не цягнецца, спроба паўтараецца, а пасля трох няўдач прагон спыняецца — стары экран не ацэньваецца.
Пакуль скрыпт чакае экран, няўдалы дамп лічыцца «экрана яшчэ няма»; калі і апошні дамп да тайм-аўту не ўдаўся, прагон
спыняецца.

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
