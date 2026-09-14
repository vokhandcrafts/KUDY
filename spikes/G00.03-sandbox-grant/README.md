# G00.03.a — Sandbox-кліент і ізаляваны grant (спайк)

Мінімальны purchase/restore кліент і сервер grant для **аднаго сінтэтычнага
прыватнага файла**. Форма API следуе кананічнаму кантракту
[09, раздзел 5](../../architecture/09_technical_architecture.md). Гэта атамарная
частка [G00.03](../../agent-tasks/G00.03.md); рэальны sandbox purchase/restore —
асобная задача [G00.03.c](../../agent-tasks/atomic/G00.03.c.md), пашыраныя
негатыўныя праверкі — [G00.03.b](../../agent-tasks/atomic/G00.03.b.md).

**Гэты спайк не рабіў рэальных плацяжоў, не меў сеткавага доступу і не тыкае
production.** Усе аўтаматычныя праверкі ідуць па лакальным test-транспарце на
loopback; сувязь з рэальнымі Store/RevenueCat — падключаная, але не правераная
інтэграцыйная кропка.

## API спайку (кананічныя формы 09 §5)

| Метад | Шлях | Прызначэнне |
|---|---|---|
| `POST` | `/v1/device` | Рэгістрацыя: сервер генеруе `device_id` (UUID) і `device_secret` (32 байты, вяртаецца **адзін раз**); захоўваецца толькі SHA-256 хэш сакрэта |
| `POST` | `/v1/grant` | `{route_id, version, locale, tier, paths[]}` → сервер сам мапіруе `route_id × tier` на прадукт і пытае права ў RevenueCat → `{lock_url, urls:[{path, url, expires_at}]}` |
| `GET` | `/private/<token>` | Выдача байтаў файла па кароткачасовым падпісаным токене |

Аўтарызацыя — `Authorization: Bearer <device_secret>`. Памылкі — закрыты
спіс кодаў, без шляхоў файлаў: `400 invalid_request`; `403 device_auth_failed`,
`unknown_route_tier`, `manifest_not_found`, `path_not_allowed`,
`no_entitlement`, `environment_mismatch`, `url_expired`, `url_invalid`;
`404 not_found`; `503 entitlement_unavailable` (з `Retry-After`).

## Што ўнутры

- **Сервер** (`server/grant-server.mjs`):
  - device auth: рэестр у `DEVICES_FILE` толькі з хэшамі сакрэтаў;
    constant-time параўнанне падчас поўнага скану рэестра;
  - mapping: `route_id × tier → product` толькі серверны (`server/catalog.json`);
    кліент не выбірае product_id або storage bucket (мяжа 09 §5);
  - manifest membership: ключ `route_id/version/locale/tier` + кожны шлях у
    спісе членаў маніфеста; traversal, абсалютныя і URL-шляхі адхіляюцца
    **да** праверак каталогу;
  - entitlement: сервер пытае правайдара (`server/provider.mjs`) для
    аўтэнтыфікаванай прылады (`app_user_id = device_id`; аліасы/трансферы
    разбірае RevenueCat — уласнай табліцы няма). Недаступны правайдар і кэшу
    няма → `503 entitlement_unavailable` + `Retry-After` (fail-closed);
    `sandbox`-права не адкрывае `production`-рэсурс;
  - пазітыўны кэш адказу на `(device_id, route_id, tier)` з TTL
    `GRANT_ENTITLEMENT_CACHE_TTL_SECONDS` (09 §5.1): трымае загрузку/рэзюмаванне
    пры збоі правайдара; ніколі не абыходзіць праверку асяроддзя і не захоўвае
    адмоўныя адказы. Мяжа кэшу: да сканчэння TTL права адзываецца не імгненна
    (у спайку адклікання няма і яно не патрэбнае);
  - кароткачасовыя URL: HMAC-падпісаныя токены (bind да маніфеста, шляху, хэшу
    прылады і expiry); лог ніколі не змяшчае URL, сакрэтаў ці receipt.
- **Кліент** (`client/purchase-client.mjs`, `client/store-port.mjs`):
  purchase/restore праз port магазіна, затым `/v1/grant`; лакальны сцяг
  `bought` — касметычны UI-стан і **ніколі не** дасылаецца як аўтарызацыя;
  у запыце няма `product_id` і `user_id`.
- **Сінтэтычны прыватны файл**: `data/storage/g00-03-spike/2026-09-15.1/be/extended/transcripts/private-story-01.be.txt`.

## Тэставы транспарт (толькі для тэстаў)

`createTestStoreSim` + `createTestProvider` (`client/store-port.mjs`,
`server/provider.mjs`) мадэлююць краму і правайдара правоў. Транспарт адказвае
толькі з рэальнага стану мадэлі — ён не ўмее выдумваць поспех (не fail-open).
Live-запуск (`npm start`) не мае да транспарту доступу: ён заўсёды падключае
RevenueCat-адаптар і патрабуе env.

## Каманды

Патрэбны Node `>=22` (праверана на 24.13.0); npm-залежнасцей няма.

```bash
# аўтаматычныя праверкі спайку (15 тэстаў, loopback, без сеткі)
npm test

# live-запуск сервера (патрабуе env, гл. .env.example; без іх — адмова з назвамі зменных)
npm start
```

## Env-назвы (без значэнняў)

Поўны спіс з каментарамі — `.env.example`. Сервер чытае:

| Назва | Прызначэнне |
|---|---|
| `GRANT_ENVIRONMENT` | `sandbox` / `production`; sandbox-права не адкрывае production-файл |
| `GRANT_URL_SIGNING_KEY` | ключ HMAC для кароткачасовых URL |
| `REVENUECAT_SECRET_API_KEY` | сакрэтны ключ RevenueCat (толькі сервер) |
| `REVENUECAT_BASE_URL` | опцыянальны override хоста API |
| `GRANT_STORAGE_ROOT` | корань сховішча прыватных файлаў |
| `DEVICES_FILE` | файл рэестра прылад (хэшы сакрэтаў) |
| `GRANT_URL_TTL_SECONDS` | опцыянальна, па змоўчанні 600 |
| `GRANT_ENTITLEMENT_CACHE_TTL_SECONDS` | опцыянальна, па змоўчанні 86400; 0 = без кэшу |
| `PORT` | опцыянальна, па змоўчанні 8787 |

Зарэзерваваныя ў `.env.example`, але не ўваходзяць у .a: `REVENUECAT_PROJECT_ID`
(патрэбны пры пераходзе на v2 REST), `GRANT_PUBLIC_BASE_URL`/`GRANT_PUBLIC_ROOT`
(публічныя анонсы — гэта публічны каталог, не grant), кліенцкія
`REVENUECAT_PUBLIC_SDK_KEY` і `GRANT_SERVER_BASE_URL`.

## Крокі store-канфігурацыі (для G00.03.c)

1. App Store Connect: sandbox-тэстэр і non-consumable прадукт з ID
   `kudy.spike.g00_03.story_01` (прадукты маршрутаў — non-consumable, 09 §5.2).
2. Google Play Console: тэставы трэк і той самы product ID.
3. RevenueCat: праект + дзве аплікацыі + entitlement з гэтым прадуктам;
   сакрэтны ключ — толькі ў env сервера; SDK-ключ — кліенцкі.
4. Спраціць mapping у `server/catalog.json` з рэальнымі store-прадуктамі.
5. Прагнаць рэальны sandbox purchase і restore на дзвюх прыладах і пацвердзіць
   форму адказу RC REST (адаптар напісаны, але не выклікаўся).

## Інвентарызацыя тэставых доступаў (факт на 2026-09-15)

- ёсць: Node 24.13.0, npm 11.6.2, лакальны loopback, сінтэтычныя фікстуры;
- няма: Apple/Google sandbox-акаунтаў, праекта RevenueCat, фізічных прылад,
  сеткавага доступу (забаронены ўмовамі задачы);
- наступствы: RC-адаптар не правяраўся па сетцы; ніякі тэст тут не выдае сябе
  за праверку рэальнага store/OS.

## Межы

- Ніякіх рэальных плацяжоў, production-ключоў або дэплою.
- Кліент не мае service-role/store-server сакрэтаў; «куплена» ў кліенце не
  прапускае аўтарызацыю.
- Логі — толькі коды і станы (`grant_issued`, `file_denied`,
  `entitlement_cache_hit`, хэш прылады), без receipt, bearer, URL і ID прылад.
- Сервер слухаць толькі `127.0.0.1`; rate-limit `/v1/device` па IP — не ў спайку.
- Batch-мінт URL падоў і кліенцкае перамінаванне каля expiry — гэта паводзіны
  поўнага download-сэрвісу (G04/G08), не гэтага мінімальнага спайку.
- Гэта спайк: перанос у production — асобнае рашэнне пасля G00.03.b/.c/.d.
