# APR-08.a — крытэр 5: знятае сцвярджэнне пра захаваныя агрэгаты ў privacyRetention

Дата: **2026-11-01**. Задача: [#849](https://github.com/vokhandcrafts/KUDY/issues/849). Эпік: [#299](https://github.com/vokhandcrafts/KUDY/issues/299). База на пачатак працы: main `b4baef3` (#954). Выканаўца: ZCode (GLM-5.3), асобны клон `KUDY-849`, галінка `zcode/849`. Тып: змена тэкстаў UI-каталогаў (дадзеныя + генерацыя) + guard-тэсты, **не** release-зборка і не Supabase-рунтайм.

## Абсяг: крытэр 5 без чалавечых рашэнняў

Крытэр 5 issue #849: праверыць наяўнасць рэальнага сховішча/працэсу route-агрэгатаў; калі яго няма — прыбраць недаказанае сцвярджэнне з кананічнага `web.ui.privacyRetention` і перакладаў `cs/de/en/es/fr/sv/uk/zh`, рэгенераваць web-праекцыі і праверыць rendered privacy ў дзевяці мовах.

Крытэры 1–3 (вызначыць Supabase project/environment, staging proof, production schedule/status audit) і частка 6 патрабуюць аператарскага доступу да Supabase runtime — гэта **blocked-external**, у рэзультаты не ўваходзіць. Па пытанні cleanup-уладальніка `devices` (крытэр 6) у рэпо няма рэалізацыі; асобная рэалізацыйная задача яшчэ не сфармуляваная — зрабіць гэта — рашэнне разам з крытэрамі 1–3.

## Мяжа доказу

У рэпо няма сховішча route-агрэгатаў:

- `supabase/functions/_shared/retention-core.ts:1-5` — «no aggregate table exists yet, so the sweep deletes only raw rows»;
- `git grep -il aggregate -- supabase/` знаходзіць толькі `retention-core.ts` і `supabase/queries/feedback-report.sql`; апошні — аўтарская **read-only** аднаразовая агрэгацыя па бягучых радках для рэпарта, «computed on the fly; no rolling totals», не падключаная да Edge Functions і не даступная мабільным credentials (каментар файла);
- у `supabase/migrations/` няма табліцы route-агрэгатаў і няма планавальніка іх запісу.

Таму сцвярджэнне «агрэгаваныя лічбы па маршрутах застаюцца» было недаказаным у дзвюх частках: няма сховішча і няма працэсу. Тэкст падмеўняе пацвярджэнне згодай — прыбраны.

## Што зменена

- `contracts/ui-messages/source.json` — запіс `web.ui.privacyRetention`: прыбрана «; агрэгаваныя лічбы па маршрутах застаюцца без ідэнтыфікатара прылады». Тэкст «сырыя падзеі — 14 месяцаў, выдаляюцца заданнем» захаваны даслоўна. `sourceHash` перлічаны роднай функцыяй `sourceHash()` рэпы → `fd59ba45…`. Файл патчаны тэкстава, без пералівання JSON.
- `contracts/ui-messages/translations/{cs,de,en,es,fr,sv,uk,zh}.json` — тое самае скарачэнне ў кожнай мове (апошні сказ скарочаны да кропкі з коскай + кропка); `reviewedSourceHash` → `fd59ba45…`; у `review.note` кожнай мовы дададзеная праўка пра крытэр 5 #849. Файл `zh.json` — у родным стылі \u-эскейпаў, патчаны тэкстава.
- `web/lib/i18n/*.ts` — 9 файлаў перагенераваны штатна (`npm run messages:generate`; `messages:generate:check` — fresh).
- `test/ui-messages-render-golden.json` — 3 радкі (be/en/uk) абноўленыя пад кароткія тэксты.
- `tools/i18n/privacy-disclosure.test.mjs` — новыя guard-тэсты (правіла 1 implementation-rules): be-крыніца і ўсе восем выпушчаных моваў абавязаны трымаць 14-месячны тэрмін і **не** змяшчаць свайго агрэгат-маркера. Рэверт-эксперымент: з адноўленым en-сцвярджэннем guard падае і называем прычыну; файл адноўлены.
- `web/lib/i18n/privacy-retention.test.ts` — новы parity-тэст: rendered (`getUiStrings`) = прагледжаны кантракт байт-у-байт ва ўсіх 9 мовах (пробы адсутнасці — аднаўласнік `tools/i18n/privacy-disclosure.test.mjs`, без дублю табліцы проб).

## Матрыца criterion 5 × мова × evidence

| Мова | Новы тэкст (скарочаны) | Evidence |
| --- | --- | --- |
| be (source.json) | «…выдаляюцца заданнем.» | sourceHash `fd59ba45…`; guard be; golden be |
| en/uk/cs/de/es/fr/sv/zh | адпаведнае скарачэнне | `reviewedSourceHash` `fd59ba45…` у 8 файлах; guard мовы; parity-тэст rendered=кантракт; golden en/uk |

Guard-маркеры адсутнасці: be «агрэгаваныя лічбы», en «aggregated counts», uk «агреговані числа», cs «agregované čísla», de «aggregierte Zahlen», es «cifras agregadas», fr «chiffres agrégés», sv «aggregerade siffror», zh `\u6309\u8DEF\u7EBF\u6C47\u603B\u7684\u6570\u5B57`. Маркеры захавання: тэрмін «14 месяцаў» у адпаведнай форме кожнай мовы пінуецца guard-тэстам.

## Рашэнне па #299

Пасля мержу рашэнне адзначана ў [#299](https://github.com/vokhandcrafts/KUDY/issues/299) каментаром з спасылкай на PR; далейшае — па крытэрах 1–3 пасля аператарскага доступу.

## Вердікт праверак

Прагон npm test на каміце `cbf8cb0` (код гэтага PR без дакументальных лічбаў; наступны каміт дадае толькі лічбы гэтага раздзела):

- `npm run messages:generate:check` — ✅ 17 файлаў fresh
- `npm run messages:check` — ✅ shipped locales complete, reviewed and fresh
- `npm run typecheck` — ✅ без памылак
- `npm run arch:check` — ✅ 679 modules, 0 violations
- `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` — ✅ 0 clones (19.5s)
- `npm test` — ✅ 2894 tests / 2813 pass / 8 fail; набор фэйлаў пабайтова ідэнтычны чыстаму main `b4baef3` (там 2884/2803/8, тыя ж 8 імён; +10 тэстаў = новыя guard'ы гэтага PR). Дыф-нейтральнасць даказана паўнымі логамі абодвух прагонаў.
- Рэверт-эксперымент ✅: guard падае на адноўленым en-сцвярджэнні і называем прычыну.
- Showboat-дэма ✅: `docs/demos/2026-11-01-apr-08a-privacy-retention.md` (генерацыя fresh, guard 18/18, parity 1/1); `uvx showboat==0.6.1 verify` — exit 0 двойчы запар.

## Далейшыя крокі

Крытэры 1–3 (+ рэшта 4/6): staging proof з сінтэтычнымі радкамі (boundary 14м/24г/30д, паўторы, fail/retry), production schedule/status audit без PII, рашэнне па privacyRetention/Data safety заявах і cleanup `devices`. Запісаны ў human-actions для аператара.
