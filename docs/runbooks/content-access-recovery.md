# Runbook: кантэнт, доступ і аднаўленне

Дата: 2026-10-04 · задача G11.03 (#298) · статус: жывы оператыўны дакумент.

Кананічныя крыніцы (гэты runbook іх не пераказвае, а капіруе даслоўна са спасылкай):
[архітэктура `09`](../architecture/09_technical_architecture.md),
[падбор і ацэнкі `21`](../architecture/21_discovery_feedback_architecture.md),
[вынікі G08.06 (webhook)](../agent-tasks/results/G08.06.md),
[вынікі G09.03 (выдаленне і retention)](../agent-tasks/results/G09.03.md).
Мяжа доказу: жывы праект Supabase да рэпазітара не падключаны — усе крокі,
якія патрабуюць жывой крамы або жывой БД, пазначаныя «not-run без жывога
праекта»; механіка аднаўлення даказаная drill-ам у пясочніцы (раздзел
[Drill](#9-drill-бяспечная-праверка-ў-пясочніцы)). Асобны поўны runbook
водгукаў плануе G16.04 ([задача](../agent-tasks/discovery/G16.04.md)) — тут
толькі retention, экспарты і additive recovery паводле `21` §6/§10.

## Трыаж: сімптом → раздзел

| Сімптом | Раздзел |
|---|---|
| Карыстальнік не можа спампаваць маршрут / загрузка стаіць на «partial» | [1](#1-няўдалая-загрузка) |
| «Доступ рыхтуецца» / адмова grant пасля аплаты | [2](#2-недаступны-grant) |
| Новая версія кантэнту паламаная, трэба вярнуць старую | [3](#3-адкат-каталога) |
| Перад міграцыяй БД / пасля праваленай міграцыі | [4](#4-бэкап-і-аднаўленне-бд) і [9](#9-drill-бяспечная-праверка-ў-пясочніцы) |
| Уцечка device_secret, webhook-сакрэт або доступ да акаўнта | [5](#5-кампраметацыя-ключа) |
| Карыстальнік на старой версіі / што можна выдаляць са старых рэлізаў | [6](#6-захаванне-старых-версій) |
| Скарга на пакупку, патрабуюць рэфанд | [7](#7-падтрымка-пакупак) |
| Збой discovery-індэкса, адкат feedback, міграцыі feedback-табліц | [8](#8-discovery-rollback-feedback-retention-і-экспарты-additive-recovery) |

## 1. Няўдалая загрузка

Кантракт станаў (`09` §7, даслоўна): `not_downloaded` → `partial (N файлаў
не хапае)` → `ready` → `stale`. «Спінер» — не стан; стан заўсёды бачны.

Кантракт праверкі цэласнасці (`09` §4, трохузроўневая):

1. **на загрузцы** — поўная праверка кожнага файла (хэш лічыцца ў патоку);
2. **на адкрыцці** — толькі JSON-файлы бандла + дэшавая праверка метаданых
   медыя (наяўнасць і памер з `lock.json`);
3. **поўны перапрагон** — толькі пры змене версіі дадатку, памылцы
   дэкадавання плэера/парсера або яўным «праверыць загрузку» у MyKUDY.

Кантэнт не парсіцца, пакуль не правераны адпаведным узроўнем.

Крокі:

1. **Вызначыць бок збою.** Пытанні: каталог аддаецца? grant выдадзены?
   файлы цягнуцца? хэш сыходзіцца? Падзеі дыягностыкі (калі згода на
   аналітыку была): `download_started/completed/failed(download_id,
   attempt_id?, route_id, version, locale, tier, bytes)` (`09` §10,
   даслоўна) — глядзець у `event_log` па `device_id`.
2. **Кліентскі бок.** Загрузка рэзюмаваная: рэестр `bundle_asset` (зона A)
   ведае `status` (`pending/partial/complete`), `bytes_total`, `bytes_done`,
   `sha256` па кожным файле (`09` §7) — перапаўзнаванне працягвае, а не
   пачынае зноў. Паўторная праверка — кнопкай у MyKUDY (узровень 3).
3. **URL-ы.** Падпісаныя URL мінуюцца **порцыямі**, TTL ≤ 10 хв; кліент
   **перамінтоўвае** іх, калі `expires_at` наблізіўся (`09` §5.1). Збой
   сярэдзіны загрузкі на слабай сетцы — чаканы сцэнар, а не аварыйны.
4. **Пасля абнаўлення дадатку** на iOS файлы могуць «асірацець» пры зруху
   шляхоў, тады як SQLite выжывае (`09` §7): прагон праверкі наяўнасці
   файлаў і фонавая перакачка недахопу. Сімптом «загружаны маршрут без
   аўдыё» — гэта гэты выпадак.
5. **Каталог.** Абнаўленне каталога пры кожным старце; «збой фатальны
   толькі калі кэшу няма» (`09` §4): пры збоі працуе `catalog_cache`
   (зона A). Чысціць кэш каталога толькі разам з праверкай, што сетка
   наогул ёсць.

## 2. Недаступны grant

Кантракт кодаў (`09` §5, даслоўна): `403 no_entitlement`; `503
entitlement_unavailable` (з `Retry-After`); `429 rate_limited` (з
`Retry-After`). Правіла адрознення абавязковае (`09` §5.1): **403 — права
няма; 503 — не змаглі праверыць**. Кліент, які атрымаў 503, захоўвае
«куплена, доступ рыхтуецца» і прапануе паўтор праверкі/загрузкі — не
паўторную аплату.

Дзе праўда: сервер пытае RevenueCat у момант гранта (`09` §5.1); кліент
ніколі не сцвярджае пакупку. Кэш **пазітыўнага** адказу на `(device_id,
route_id, tier)` жыве TTL 24 г; рэфанд (`CANCELLATION`/`REFUND_REVERSED`),
`EXPIRATION` і `TRANSFER` ачышчаюць кэш — наступны `/grant` пераправярае
права (`09` §5.1).

Крокі дыягностыкі (service_role, чытаць толькі):

1. Глянуць `entitlement_cache` па `device_id`: ці ёсць свежы пазітыўны
   радок, калі скончыўся `expires_at`.
2. Глянуць `grant_request_rate` па `device_id`: акно лічыльніка і
   `attempts` — тут прычына 429.
3. Глянуць `webhook_events` па `app_user_id`/aliases прылады: ці прыходзілі
   `CANCELLATION`/`EXPIRATION`/`TRANSFER` (бухгалтэрыя, не брама —
   [G08.06](../agent-tasks/results/G08.06.md)).
4. Калі кэшу няма, а RevenueCat не адказвае — 503 чаканы; паўтор праз
   `Retry-After`. Пры выключанай webhook-інтэграцыі акно доступу
   абмежавана TTL кэшу 24 г (`09` §5.1).
5. Плацельнік з 503 не губляе грошы: аплачаны бандл, які ўжо загружаны,
   грае незалежна ад усяго (`09` §2, трэйд-оф «файлы на дыску = купленае»).

## 3. Адкат каталога

Кантракт (`09` §4, даслоўна): бандлы нязменныя — новы кантэнт = новая
версія = новы запіс у каталогу; «адкат — гэта вярнуць `catalog.json` на
папярэдні запіс», бо папярэдняя версія ўжо ляжыць на CDN. Адкат **на
прыладзе** не патрэбны: кліент проста бачыць у каталогу папярэднюю версію
як актуальную.

Інструмент: [tools/publish-catalog](../../tools/publish-catalog/publish-catalog.mjs)
(G02.04): `publishCatalog({ staging, target, now })` — спачатку поўная
праверка staging-пакета (кожны артыфакт release-маніфеста супраць
`bytes`+`sha256`, кожны радок `lock.json` супраць файла), толькі потым
артыфакты кладуцца, release-файлы захоўваюцца, і pointer каталога
мяняецца апошнім, праз temp+rename у адной тэчцы. Перапыненая публікацыя
пакідае папярэдні каталог жывым. Адкат — `rollbackCatalog({ target })`.

Крокі:

1. Пераканацца, што пашкоджанне не ў змесціве бандла (бандл нязменны, «сапсаваны
   бандл» = сапсаваная публікацыя новай версіі): глядзець апошні запіс у
   `catalog.json` і `generated_at`.
2. Запусціць `rollbackCatalog` да папярэдняга пункта. Сесіі, якія ўжо
   ідуць, гэтага не заўважаць: сесія замацоўвае `version` пры Start да End,
   абнаўленне каталога не падмяняе яе файлы; актыўная або прыпыненая версія
   абаронена ад лакальнага выдалення (`09` §4).
3. Discovery-частка: адкат вяртае папярэдні каталог **і яго індэкс**
   (`21` §3.3). Нязгода `bytes`/`sha256` індэкса адкрывае папярэдні валідны
   кэш, а не збой; невядомая major-версія каталога не блакуе звычайныя
   гіды (`21` §3.3).
4. Выпускаць выпраўленую версію — толькі **новай версіяй** у каталогу;
   старыя запісы не перазапісваюцца ніколі.

## 4. Бэкап і аднаўленне БД

**Сервер (Postgres/Supabase).** Кантракт (`21` §10, даслоўна): «Runbook
фіксуе бэкап і аднаўленне перад міграцыяй»; міграцыі additive — новыя
табліцы і FK, без перапісвання session або выдалення старых даных.

1. Перад кожнай міграцыяй — бэкап усёй схемы і даных (Supabase Dashboard →
   Database → Backups, або `pg_dump` з асобнага акаўнта з 2FA; not-run без
   жывога праекта — механіка аднаўлення даказаная drill-ам, раздзел 9).
2. Міграцыя ў транзакцыі: праваленая міграцыя не пакідае напаўпрымененага
   стану. Калі міграцыя правалілася па-за транзакцыяй або была
   дэструктыўнай — базу не «чыніць на жывую»: аднаўленне з бэкапу, потым
   выпраўленая міграцыя.
3. Аднаўленне: свежая схема (міграцыі па парадку) + рэплэй бэкапу даных;
   праверка — інвентар табліц, колькасці радкоў і хэш дампа да/пасля
   (як у drill-у, раздзел 9).
4. Адкат сервера feedback-частцы: адкат сервера адключае прыём, але **не
   дропае** ацэнкі (`21` §10).

**Кліент (SQLite).** Зоны (`09` §7, [services/db/schema.ts](../../services/db/schema.ts)):
зона A (`bundle_asset`, `catalog_cache`, `discovery_cache`) — аднаўляльная,
дропнуць і адбудаваць можна; зона B (`session`, `guide_hint_state`,
`guide_hint_last`, `migration_log`, `event_queue`, `settings`, `device`,
`feedback_local`, `feedback_outbox`) — толькі міграцыі, ніколі аўтаматычнае
выдаленне. «Памылка міграцыі ніколі не сцірае базу»; аднаўленне — адваротны
прабег па `migration_log` (ADR
[G01.03](../architecture/decisions/G01.03-session-access.md) §3.8).

**Бэкап зоны B на кліенце — не робім** (`09` §7, прыняты трэйд-оф):
пераўстаноўка дадатку губляе лакальны прагрэс; правы і прагрэс на серверы
з'явяцца з `/link` (за межамі MVP, `09` §5.2). Пры звароце карыстальніка
пра «страчаны прагрэс пасля пераўстаноўкі» — гэта чаканыя паводзіны, а не
збой: прагрэс прывязаны да ўстановы, а не да акаўнта.

## 5. Кампраметацыя ключа

Тры розныя ключы — тры розныя працэдуры.

**`device_secret` прылады (уцечка да карыстальніка/чужы тэлефон).** Ратацыі
няма — ідэнтыфікацыя выдаецца адзін раз пры рэгістрацыі (`09` §5).
Дзеянні:

1. Выдаліць скампраметаваную прыладу: `DELETE /v1/device` (Bearer яе
   сакрэту; калі сакрэт у злачынцы — not-run без жывога праекта: выдаленне
   радка `devices` service_role у SQL editor дае той жа каскад). Каскад
   (`09` §5 + міграцыі rate-лічыльнікаў і feedback):
   `devices`, `event_log`, `entitlement_cache`, `event_send_rate`,
   `grant_request_rate` і feedback-тройка
   (`feedback_current`, `feedback_mutations`, `feedback_send_rate`) па FK
   cascade.
2. Правы на кантэнт жывуць у RevenueCat (`app_user_id = device_id`):
   выдаленая прылада больш не атрымлівае новых грантаў — кэш ачышчаны
   разам з радком. Ужо выдадзеныя падпісаныя URL дажывуць TTL ≤ 10 хв,
   адзывнога механізму няма (`09` §5.1) — акно кароткае by design.
3. Ужо **спампаваныя** файлы скампраметаваная прылада гуляць можа (трэйд-оф
   §2 `09`); шкода абмежаваная базавым кантэнтам, які яна паспела спампаваць.

**`RC_WEBHOOK_SECRET` (падпіс webhook).** Без наладжанага сакрэту endpoint
не разгортваецца — fail-closed ([G08.06](../agent-tasks/results/G08.06.md)).
Ратацыя: новы сакрэт у наладах RevenueCat → абнаўленне сакрэту ў Secrets
праекта → redeploy; ідэмпатэнтнасць па `event.id` гарантуе, што рэтраі
5/10/20/40/80 хв не дублююць эфекты.

**Дэплой/Storage-акаўнт.** Компенсацыі `09` §4, даслоўна: доступ да Storage
— толькі праз service-key у Edge Functions і асобны deploy-акаўнт з 2FA;
`catalog.json` і бандлы ніколі не пішуцца з CI без ручнога кроку. Пры
падазрэнні на узлом хостынгу: звярнуць каталог (раздзел 3), выпусціць
выпраўленыя версіі, змяніць уліковыя даныя акаўнта. Падпісу бандлаў
(Ed25519) няма — гэта **прыняты рызыка** `09` §4 з запісанымі ўмовамі
перагляду (чужы ліцэнзаваны кантэнт, другі чалавек з доступам да дэплою,
першы інцыдэнт).

## 6. Захаванне старых версій

- Апублікаваныя версіі **не перазапісваюцца** (`09` §4); сесіі, якія
  ішлі па старой версіі, дажываюць свой Run (версія замацавана да End).
  Серверны тэрмін захавання старых версій і паведамленне аб недаступным
  старым пашырэнні ўлічваюцца гэтым планам (`09` §4): пакуль CDN-бюджэт
  дазваляе — старыя версіі застаюцца; выдаленне старой версіі з CDN —
  рашэнне з датай і праверкай, што актыўных сесій на ёй няма.
- `RouteStop.id` стабільны між версіямі (`09` §3): змена `id` = новая
  кропка; прагрэс карыстальніка не перанумароўваецца.
- Retention на серверы ([retention-core](../../supabase/functions/_shared/retention-core.ts)):
  сырыя падзеі — `EVENT_RETENTION_MONTHS = 14` месяцаў, потым выдаляюцца
  заданнем; агрэгаты застаюцца без `device_id` (`09` §10). Rate-вокны
  лічыльнікаў — `RATE_RETENTION_HOURS = 24`; webhook-падзеі —
  `WEBHOOK_RETENTION_DAYS = 30` дзён.
- Гістарычныя published-мэты водгуку застаюцца ў
  `feedback_target_registry` і працягваюць прымаць ацэнкі (`21` §5.2);
  зняцце з discovery не сцірае ўжо пакінуты водгук.

## 7. Падтрымка пакупак

Прадукты — non-consumable one-time purchases (`09` §5.2): «купіў маршрут
назаўсёды». Restore той жа крамы працуе без акаўнта; **крос-платформенны**
перанос (iPhone → Android) немагчымы да `/link` (`09` §5.2) — гэта
чаканыя паводзіны, а не баг.

Крокі па звароце:

1. Займець факты: маршрут (`route_id`), прылада/час пакупкі, чэк крамы, версію
   дадатку, дакладны тэкст памылкі з экрана.
2. Адтварыць шлях grant (раздзел 2): `event_log` па `device_id`
   (`purchase_started/succeeded/failed`, `download_failed`), потым
   `webhook_events` (рэфанды/трансферы), `entitlement_cache`,
   `grant_request_rate`.
3. Крыніца праўды пра права — RevenueCat (запыт субскрыбера); кэш і
   webhook — толькі бухгалтэрыя. Калі RevenueCat бачыць права, а сервер
   адказвае 403 — гэта збой сервера, а не пакупкі: глядзець свежы
   `entitlement_cache` і даступнасць RevenueCat.
4. Рэфанд: правы спыняюцца для **новых** загрузак (кэш ачышчаецца
   падзеяй, наступны `/grant` атрымлівае `403 no_entitlement`), але ўжо
   спампаваны бандл гуляе далей, а выдадзеныя URL дажывуць TTL ≤ 10 хв —
   адразу скасаваць нельга (`09` §5.1, прынятая палітыка). Пры
   выключаным webhook акно 24 г (TTL кэшу).
5. Рэкламацыі крамы (рэлізныя абяцанні, reviewer-рэжым) — G11.04, не тут.

## 8. Discovery rollback, feedback retention і экспарты, additive recovery

**Discovery rollback (`21` §3.3).** Парадак публікацыі: праверыць усе refs
і public/private → запісаць нязменныя public-файлы месцаў/індэкса і
патрэбныя пакеты → праверыць hash/size → абнавіць каталог **апошнім**
крокам. Адкат вяртае папярэдні каталог і яго індэкс. Невядомы schema,
сапсаваны індэкс або адсутны файл не знішчаюць апошні валідны кэш і не
блакуюць гатовы Run; без кэшу — звычайная старонка горада без новага
падбору. Кліент не запытвае індэкс з адвольнага host.

**Feedback retention і экспарты (`21` §6).** Current, tombstones і
mutation-дэдуплікацыя — не даўжэй 14 месяцаў з апошняй змены; праз
агульны device-delete выдаляюцца адразу. Захаваныя экспарты маюць перыяд і
час разліку; **пры data-delete экспарты выдаляюцца/пераствараюцца, без
публічных копій**. Справаздача чытаецца праз адміністрацыйны доступ
Supabase з MFA (read-only агрэгацыя); захаваныя feedback-агрэгаты не
перажываюць выдаленне зыходных радкоў у першым выпуску — справаздача
будуецца запытам па актуальных радках, не лічыльнікам.

**Additive recovery (`21` §10).** Міграцыі additive: новыя табліцы і FK,
без перапісвання session або выдалення старых даных; адкат кліента
захоўвае durable-табліцы; адкат сервера адключае прыём, але не дропае
ацэнкі. Выкананне «бэкап → аднаўленне перад міграцыяй» — drill ніжэй.

## 9. Drill: бяспечная праверка ў пясочніцы

Сцэнарый адтварае збой раздзела 4: **перад міграцыяй узяты бэкап →
дэструктыўная змена па-за транзакцыяй псуе схему → аднаўленне з бэкапу
вяртае даныя дакладна → additive-міграцыя пасля аднаўлення працуе без
страт**. Пясочніца — in-memory PGlite (той жа Postgres WASM, што ў
тэстах), міграцыі — committed-файлы `supabase/migrations/` праз
тэставыя хелперы; ніякіх жывых сэрвісаў, сакрэтаў і даных па-за
`.scratch/` (gitignored).

1. Захаваць drill-скрыпт (ніжэй) у `.scratch/g1103-drill.mjs` ад корня
   checkout:
   ```js
   // G11.03 drill — бэкап → дэструктыўны збой па-за транзакцыяй → аднаўленне з
   // бэкапу → additive-міграцыя без страт. Пясочніца: in-memory PGlite,
   // committed-міграцыі, сінтэтычныя даныя з фіксаванымі літараламі.
   import assert from 'node:assert/strict';
   import { createHash } from 'node:crypto';
   import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
   import path from 'node:path';
   import { fileURLToPath } from 'node:url';

   import { PGlite } from '@electric-sql/pglite';

   import { freshMigratedDatabase } from '../supabase/functions/_shared/test-db.ts';

   const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
   const feedbackMigration = readFileSync(
     path.join(repoRoot, 'supabase/migrations/20261004000000_feedback_tables_rls.sql'),
     'utf8',
   );

   // Stable table inventory + ORDER BY keys (the primary keys of the committed
   // migrations). Generated columns (grant_products.route_key) never enter the
   // dump — they cannot be inserted back.
   const TABLES = [
     ['devices', 'device_id'],
     ['entitlement_cache', 'device_id, route_id, tier'],
     ['event_log', 'event_id'],
     ['device_registration_rate', 'ip_hash, window_start'],
     ['grant_products', 'product_id'],
     ['webhook_events', 'event_id'],
     ['event_send_rate', 'device_id, window_start'],
     ['grant_request_rate', 'device_id, window_start'],
     ['feedback_target_registry', 'target_kind, target_id, target_version, locale'],
     ['feedback_current', 'device_id, target_kind, target_id, target_version, locale'],
     ['feedback_mutations', 'device_id, mutation_id'],
     ['feedback_send_rate', 'device_id, window_start'],
     ['feedback_ip_rate', 'ip_hash, window_start'],
   ];

   async function buildDb() {
     const db = await freshMigratedDatabase(); // committed device/grant/webhook/rate migrations
     await db.exec(feedbackMigration); // committed feedback migration, verbatim file
     return db;
   }

   async function insertableColumns(db, table) {
     const result = await db.query(
       "select column_name from information_schema.columns "
         + "where table_name = $1 and is_generated = 'NEVER' order by ordinal_position",
       [table],
     );
     return result.rows.map((row) => row.column_name);
   }

   // Deterministic dump: one line per row ("<table>\t<row json>"), tables and
   // rows in fixed order, only insertable columns.
   async function dump(db) {
     const lines = [];
     for (const [table, order] of TABLES) {
       const cols = (await insertableColumns(db, table)).join(', ');
       const result = await db.query(
         `select row_to_json(t)::text as row from (select ${cols} from ${table} order by ${order}) t`,
       );
       for (const row of result.rows) lines.push(`${table}\t${row.row}`);
     }
     return lines;
   }

   const sha256 = (lines) => createHash('sha256').update(lines.join('\n')).digest('hex');

   const count = async (db, table) =>
     (await db.query(`select count(*)::int as n from ${table}`)).rows[0].n;

   const tableExists = async (db, table) =>
     (await db.query('select count(*)::int as n from pg_tables where tablename = $1', [table]))
       .rows[0].n === 1;

   // Synthetic seed: fixed literals only — no now() defaults, no wall clock.
   async function seed(db) {
     await db.exec(`insert into devices (device_id, secret_hash, created_at) values
       ('11111111-1111-4111-8111-111111111111', 'sha256:0000deadbeef', '2026-10-03T09:00:00+00:00'),
       ('22222222-2222-4222-8222-222222222222', 'sha256:0000cafef00d', '2026-10-03T10:00:00+00:00')`);
     await db.exec(`insert into grant_products (product_id, route_id, tier) values
       ('kudy_gdansk_old_town_extended', 'gdansk_old_town', 'extended')`);
     await db.exec(`insert into entitlement_cache (device_id, route_id, tier, payload, expires_at) values
       ('11111111-1111-4111-8111-111111111111', 'gdansk_old_town', 'extended',
        '{"entitlements":["kudy_gdansk_old_town_extended"]}', '2026-10-04T09:00:00+00:00')`);
     await db.exec(`insert into event_log (event_id, device_id, type, at, payload) values
       ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
        'session_started', '2026-10-03T11:00:00+00:00', '{"session_id":"s1"}'),
       ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111',
        'session_ended', '2026-10-03T12:00:00+00:00', '{"session_id":"s1"}')`);
     await db.exec(`insert into device_registration_rate (ip_hash, window_start, attempts) values
       ('hash-192-0-2-1', '2026-10-03T09:00:00+00:00', 1)`);
     await db.exec(`insert into event_send_rate (device_id, window_start, attempts) values
       ('11111111-1111-4111-8111-111111111111', '2026-10-03T12:00:00+00:00', 1)`);
     await db.exec(`insert into grant_request_rate (device_id, window_start, attempts) values
       ('11111111-1111-4111-8111-111111111111', '2026-10-03T12:30:00+00:00', 1)`);
     await db.exec(`insert into webhook_events (event_id, type, event_at, received_at, payload, effects_applied) values
       ('evt-cancellation-1', 'CANCELLATION', '2026-10-03T12:40:00+00:00', '2026-10-03T12:41:00+00:00',
        '{"app_user_id":"11111111-1111-4111-8111-111111111111"}', true)`);
     await db.exec(`insert into feedback_target_registry (target_kind, target_id, target_version, locale, status, published_at) values
       ('guide', 'gdansk_old_town', '1', 'be', 'published', '2026-10-03T08:00:00+00:00')`);
     await db.exec(`insert into feedback_current (device_id, target_kind, target_id, target_version, locale, revision, score, reason_codes, updated_at) values
       ('22222222-2222-4222-8222-222222222222', 'guide', 'gdansk_old_town', '1', 'be', 2, 5,
        '["interesting_stories"]', '2026-10-03T13:00:00+00:00')`);
     await db.exec(`insert into feedback_mutations (device_id, mutation_id, payload_hash, target_kind, target_id, target_version, locale, result_revision, created_at) values
       ('22222222-2222-4222-8222-222222222222', '55555555-5555-4555-8555-555555555555', 'hash-put-1',
        'guide', 'gdansk_old_town', '1', 'be', 1, '2026-10-03T12:50:00+00:00'),
       ('22222222-2222-4222-8222-222222222222', '66666666-6666-4666-8666-666666666666', 'hash-put-2',
        'guide', 'gdansk_old_town', '1', 'be', 2, '2026-10-03T13:00:00+00:00')`);
     await db.exec(`insert into feedback_send_rate (device_id, window_start, attempts) values
       ('22222222-2222-4222-8222-222222222222', '2026-10-03T13:00:00+00:00', 2)`);
     await db.exec(`insert into feedback_ip_rate (ip_hash, window_start, attempts) values
       ('hash-192-0-2-2', '2026-10-03T13:00:00+00:00', 2)`);
   }

   // Restore: fresh schema from the same committed migrations, then replay the
   // dump rows through json_populate_record (column types come from the table).
   async function restore(backupLines) {
     const db = await buildDb();
     for (const line of backupLines) {
       const tab = line.indexOf('\t');
       const table = line.slice(0, tab);
       const row = line.slice(tab + 1);
       const cols = (await insertableColumns(db, table)).join(', ');
       await db.query(
         `insert into ${table} (${cols}) select ${cols} from json_populate_record(null::${table}, $1) r`,
         [row],
       );
     }
     return db;
   }

   // --- Step 1: sandbox with the committed migrations -----------------------
   const db = await buildDb();
   console.log('STEP 1  OK  sandbox: committed migrations applied (device/grant/webhook/rate + feedback file)');

   // --- Step 2: synthetic seed ----------------------------------------------
   await seed(db);
   console.log('STEP 2  OK  seed: synthetic rows inserted (fixed literals, no wall clock)');

   // --- Step 3: backup (deterministic dump + sha256) -------------------------
   const backupLines = await dump(db);
   const backupHash = sha256(backupLines);
   mkdirSync(path.join(repoRoot, '.scratch'), { recursive: true });
   writeFileSync(path.join(repoRoot, '.scratch/g1103-backup.jsonl'), backupLines.join('\n') + '\n');
   console.log(
     `STEP 3  OK  backup: ${TABLES.length} tables, ${backupLines.length} rows, sha256 ${backupHash.slice(0, 16)} -> .scratch/g1103-backup.jsonl`,
   );

   // --- Step 4a: failing migration inside a transaction rolls back -----------
   let rolledBack = false;
   try {
     await db.transaction(async (tx) => {
       await tx.query('alter table event_log add column drill_probe_a text');
       await tx.query('alter table event_log drop column payload');
       throw new Error('simulated migration failure');
     });
   } catch {
     rolledBack = true;
   }
   assert.equal(rolledBack, true, 'STEP 4a: transaction did not roll back');
   assert.equal(await tableExists(db, 'drill_must_not_exist'), false, 'STEP 4a: stray table left behind');
   assert.equal(
     (await count(db, 'event_log')), backupLines.filter((l) => l.startsWith('event_log\t')).length,
     'STEP 4a: row count changed after rollback',
   );
   assert.equal(
     await dump(db).then(sha256), backupHash,
     'STEP 4a: dump hash changed after rolled-back migration',
   );
   console.log('STEP 4a OK  failed migration inside a transaction: rolled back, dump hash unchanged');

   // --- Step 4b: destructive statement OUTSIDE any transaction ---------------
   await db.query('alter table event_log drop column payload');
   let payloadGone = false;
   try {
     await db.query('select payload from event_log limit 1');
   } catch {
     payloadGone = true;
   }
   assert.equal(payloadGone, true, 'STEP 4b: payload column survived the destructive statement');
   console.log('STEP 4b OK  destructive statement outside a transaction: event_log lost column payload (data loss visible)');

   // --- Step 5: restore from the backup into a fresh schema ------------------
   const restored = await restore(backupLines);
   assert.equal(
     await dump(restored).then(sha256), backupHash,
     'STEP 5: restored dump hash differs from the backup hash',
   );
   console.log(`STEP 5  OK  restore: fresh schema + backup replay, dump hash == backup (${backupLines.length} rows back)`);

   // --- Step 6: additive migration after restore changes no data -------------
   const countsBefore = [];
   for (const [table] of TABLES) countsBefore.push(await count(restored, table));
   await restored.exec('alter table event_log add column drill_probe_b text');
   await restored.exec('create table drill_probe_table (id integer primary key)');
   for (const [i, [table]] of TABLES.entries()) {
     assert.equal(await count(restored, table), countsBefore[i], `STEP 6: row count changed in ${table}`);
   }
   assert.equal(await tableExists(restored, 'drill_probe_table'), true, 'STEP 6: additive table missing');
   console.log('STEP 6  OK  additive migration after restore: row counts unchanged, additive objects present');

   console.log('DRILL RESULT: RESTORE OK');
   ```
2. Запусціць з корня checkout:
   ```bash
   node --experimental-strip-types .scratch/g1103-drill.mjs
   ```
3. Чаканы вынік — паслядоўнасць `STEP … OK` і фінальны `DRILL RESULT:
   RESTORE OK`; фактычны вывад апошняга прагону запісаны ў
   [results/G11.03.md](../agent-tasks/results/G11.03.md).
4. Паўтаральнасць: дадзеныя сінтэтычныя і зафіксаваныя, таму вывад
   дэтэрмінаваны (хэшы дампа стабільныя паміж прагонамі на адным дрэве).

Бяспека: скрыпт не чытае нічога, акрамя committed-міграцый; піша толькі ў
`.scratch/`; сетка не выкарыстоўваецца.
