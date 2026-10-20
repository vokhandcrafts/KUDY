# APR-09 — Рашэнне пра Android backup

Дата: 2026-10-20. Задача: [#812](https://github.com/vokhandcrafts/KUDY/issues/812). База даследавання: `adb6cd5`, пасля зліцця APR-02 і APR-05.

## Вынік па крытэрыях

1. Інвентар сховішчаў і фактычны release-маніфест звераныя ў [ADR](../../architecture/decisions/APR-09-android-backup.md). Прагрэс, ідэнтыфікатар, згоды і чэргі знаходзяцца ў адным `files/SQLite/kudy.db`; Android backup XML не аддзяляе яго табліцы. SecureStore — асобныя SharedPreferences з Keystore; загрузкі — `Paths.document/bundles/`. Вызначаныя асобныя механізмы Android 7–11 і Android 12+.
2. Разгледжаныя тры варыянты: агульная база з выключэннямі, поўнае выключэнне backup, кантраляванае аднаўленне пераноснага прагрэсу. Адзін стандартны SecureStore plugin не вырашае перанос старой згоды і чэргаў, а яго XML у ўсталяванай версіі ўключае толькі SharedPreferences.
3. Уладальнік выбраў захаванне прагрэсу і асобную задачу на бяспечнае аднаўленне; [рашэнне перададзена ў issue](https://github.com/vokhandcrafts/KUDY/issues/812#issuecomment-6280689879). У ADR прыняты варыянт C; матрыца задае вынікі для новай прылады, reinstall, update, device-delete, offline, старой або пашкоджанай копіі. Канкрэтны дызайн фармату і імпарту не прыдуманы як ужо рэалізаваны кантракт.
4. Створана [APR-09.a, #833](https://github.com/vokhandcrafts/KUDY/issues/833): дызайн і рэалізацыя бяспечнага restore, канкрэтныя межы `fullBackupContent` / `dataExtractionRules`, праверкі сапраўдных export/import і генератара, адмоўныя сцэнарыі і прыладавы доказ. Залежнасць `Blocked-by: #812`; issue адкрытае, без лэйблаў, `agent:ready` не дададзены. Пакуль гэты ADR не трапіў у `main`, дакумент пазначаны недаступным для runner checkout і запуск забаронены.

## Доказ release-канфігурацыі

Выкарыстаны [маніфест APR-02](../../testing/evidence/2026-10-18-apr02/AndroidManifest.xml), атрыманне праз `:app:processReleaseMainManifest` апісана ў [README](../../testing/evidence/2026-10-18-apr02/README.md). Гэта сапраўдны захаваны release merger ад 2026-10-18, не новая зборка AAB або прыладавы backup-тэст.

- `Get-FileHash -Algorithm SHA256 docs/testing/evidence/2026-10-18-apr02/AndroidManifest.xml` → `00EF12AD2527123FEE648002039EB7E7035C1A8731CB69065399D512DC5C8C46`.
- Маніфест: `minSdkVersion=24`, `targetSdkVersion=36`, `allowBackup=true`; `fullBackupContent`, `dataExtractionRules`, `backupAgent` адсутнічаюць.
- `app.json` не мяняўся адносна базы даследавання; у ім няма ўласнай backup-канфігурацыі або config plugin SecureStore. Шлях SQLite звераны з лакальным expo-sqlite `16.0.10`; XML і Android-опцыі SecureStore — з `15.0.8`.
- Закрыццё перадумовы #288 праверана праз `gh issue view 288 --repo vokhandcrafts/KUDY --json state,title,closedAt`: `CLOSED`, `2026-10-03T01:43:02Z`. Дзеючыя `registerOnce` і `clearDeviceAccountState` прачытаныя, runtime не перапісаны.

## Праверкі

| Каманда | Фактычны вынік 2026-10-20 |
| --- | --- |
| `npm run typecheck` | exit 0; правераныя асноўны праект, services і core |
| `npm run arch:check` | exit 0; 632 modules cruised, 0 парушэнняў праз існуючую базавую лінію |
| `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` | exit 0; 0 клонаў |
| `npm test` | exit 1: Node — 2635 tests, 2563 pass, 72 skipped, 0 fail; Jest — 272 pass, 1 fail |
| `npx jest --config jest.config.js --runInBand --runTestsByPath app/my.test.tsx` | exit 0; 19 tests passed |
| `npx jest --config jest.config.js` | exit 0; 31 suites, 273 tests passed |
| `node --test tools/docs-ledger/counts-guard.test.mjs` | exit 0; 4 tests passed |
| Адносныя спасылкі новых ADR і справаздачы; праверка змешаных кірылічных/лацінскіх слоў; `git diff --check` | паспяхова |

Першы Jest-прагон не знайшоў `my-session-walk-render-1` у `app/my.test.tsx:63`, у сцэнарыі гісторыі. Асобны і поўны паўтор прайшлі без змены кода; прычына збою не пацверджаная. У гэтай галіне няма змен runtime або тэстаў; зыходны `npm test` не абвяшчаецца паспяховым па выніку іншага запуску.

Самаправерка паводле `docs/agent-rules/code-review.md`: звераныя ўсе крытэрыі #812, крыніцы сховішчаў і release-доказ, межы наступнай задачы і сапраўдны статус GP-14. Канкрэтны runtime-механізм не выдадзены за зацверджаны дызайн. Новых сакрэтаў, залежнасцей, міграцый або змен правоў няма; самаправерка не з'яўляецца незалежным code-review або judge-вердыктам.

## Межы і стан аўдыту

Runtime, Android-канфігурацыя, схема прагрэсу і правы доступу не мяняліся. Гэта даследаванне і прынятае рашэнне; бяспечнае аднаўленне яшчэ не рэалізавана. GP-14 у [матрыцы](../../audits/android-google-guidelines.md) застаецца адкрытым і спасылаецца на #833.

Showboat не патрэбны: няма змены runtime, API, даных або міграцыі; выканальны доказ рэалізацыі належыць #833. Новых тэстаў, якія толькі шукаюць словы ADR у зыходніку, не дадавалася.

Паўторнае чытанне #833 пацвердзіла загаловак, стан `OPEN`, пусты спіс лэйблаў, залежнасць і перадумову публікацыі ADR. Праверка бачнасці ў GitHub Projects недаступная: `gh project list --owner vokhandcrafts --format json --limit 20` адказала `your authentication token is missing required scopes [read:project]`. Бачнасць на дошцы не абвяшчаецца па факце стварэння issue; дадатковыя дазволы не запытваліся.
