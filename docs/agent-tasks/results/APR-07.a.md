# APR-07.a — частковая рэалізацыя і праверкі

Дата: 2026-11-01. Issue: [#835](https://github.com/vokhandcrafts/KUDY/issues/835). Галіна: `chatgpt/835`.
Статус: **не завершана, blocked-external**. Гэты файл не з'яўляецца доказам выканання ўсіх AC і не дазваляе merge.

## Крыніцы і аб'ём

Прагледжаны `services/device.ts`, `services/db/db.ts`, `services/device-secure-store.ts`, `services/analytics.ts`, `services/crash.ts`, `services/feedbackSync.ts`, `services/eventLog.ts`, `services/db/schema.ts`, вытворчы handler `supabase/functions/_shared/device-{core,wire}.ts` і ADR `docs/architecture/decisions/APR-07-device-data-deletion.md`. Лакальны worktree створаны на `97569cb6`, пры гэтым `main` працягваў змяняцца іншымі задачамі: перад канчатковым PR патрэбная актуалізацыя галіны.

Фактычныя ключы прыватнасці ў SQLite `settings`: `analytics_consent` і `crash_consent`; версія disclosure водгуку захоўваецца ў `feedback_outbox` і выдаляецца разам з чаргой. Непрыватнасныя налады, уключаючы мову, не выдаляюцца. Сакрэт застаецца толькі ў SecureStore, у SQLite запісваецца толькі несакрэтны статус выдалення.

## Праца па крытэрыях

1. **Часткова:** праведзена інвентарызацыя стану, вызначаны фазы `pending_remote`, `cleanup_remote_confirmed`, `cleanup_remote_unverified`, `complete_remote_confirmed`, `complete_remote_unverified`. Серверны 403 не з'яўляецца пацверджаннем аддаленага выдалення.
2. **Пакрыта лакальным SQLite-тэстам:** транзакцыйна ачышчаюцца `device`, `event_queue`, `feedback_local`, `feedback_outbox`, `analytics_consent`, `crash_consent`. Тэст правярае захаванне `session.heard`, `guide_hint_state`, `guide_hint_last`, `migration_log`, `catalog_cache`, `event_queue_seq`, мовы; новая падзея пасля выдалення не адпраўляецца без новай згоды. Патрабуецца дадатковая шырокая матрыца збоевых SQLite-кейсаў.
3. **Часткова:** праверка дакладнага JSON `{"error":"device_auth_failed"}` для 403; іншыя 403 і няправільнае цела 204 захоўваюць сакрэт і магчымасць паўтору. Кожны кананічны 403 вяртае `remote_unverified`, 204 — `remote_confirmed`. Default HTTPS-transport правераны з сінтэтычным `fetch`. PGlite-сцэнары з чужым сакрэтам і каскадам выдалення паўторна выкананыя ў ізаляваным асяроддзі і прайшлі; production-host па-ранейшаму не правераны.
4. **Часткова:** стан `cleanup_*` перажывае падзенне паміж SQLite і SecureStore, правераны file-backed SQLite restart, ін'екцыя збою SecureStore і транзакцыі. `pending_remote` не пускае новыя рэгістрацыі або адпраўкі без яўнага паўтору выдалення, у тым ліку пасля перазапуску file-backed SQLite. Калі SQLite не можа запісаць самы першы маркер выдалення, у тым жа працэсе дзейнічае дадатковая in-memory забарона адпраўкі да яўнага паўтору; пасля падзення працэсу без паспяховага запісу SQLite такую забарону немагчыма гарантаваць. Не ўсе платформенныя сцэнары правераны.
5. **Часткова:** дадзены агульны per-driver асінхронны бар'ер для рэгістрацыі, выдалення, analytics flush, feedback flush і conflict read. Тэсты даказваюць, што выдаленне чакае бягучую адпраўку, што аналітыка не пачынае наступны batch, feedback не адпраўляе другую мутацыю пасля запыту выдалення і новая рэгістрацыя ў гэты момант не пачынаецца. Існыя feedback queue tests прайшлі. Патрабуецца канчатковы незалежны прагон на production composition.
6. **Не выканана да канца:** вытворчы device-wire unit test праходзіць з тэставым портам, а лакальныя `tools/feedback-report` тэсты пацвярджаюць імпарт, захаванне, выдаленне сінтэтычнага экспарта і паўторную генерацыю пустой справаздачы з паслявыдаленчага CSV. Але **няма падключанага report host**, таму перастварэнне экспарта менавіта на report host не пацверджанае. PGlite інтэграцыйныя тэсты каскадаў і feedback прайшлі. Ніякіх правоў report host кліенту не дадалі.
7. **Часткова:** новы `services/device-deletion.test.ts` падхопліваецца існым glob `services/**/*.test.ts` у `npm test`; асобныя тэсты праходзяць. Ізаляванае адмоўнае выпрабаванне: пры часовым выдаленні радка, які скідае `crash_consent`, новая suite становіцца чырвонай; радок адноўлены і suite зноў праходзіць. Таксама ізаляваныя адкаты аховы наступнага batch аналітыкі, другога feedback-запыту, блакіроўкі пры няўдалай першай SQLite-транзакцыі і аднаўлення пасля restart робяць свае тэсты чырвонымі; кожная змена пасля выпрабавання адноўлена. Астатнія адкаты яшчэ не правераныя. Showboat не створаны з прычыны недаступнага `uvx`.

## Каманды і дакладныя вынікі

- Аб'яднаны апошні паўтор `node --test --experimental-strip-types services/device.test.ts services/device-deletion.test.ts services/analytics.test.ts services/db/db.test.ts tests/feedback/queue-sync.test.ts tests/feedback/queue-durability.test.ts supabase/functions/_shared/device-wire.test.ts tools/feedback-report/cli.test.mjs`: **135/135 pass**. Пакрытыя адсутны сакрэт і пашкоджаная захаваная фаза, часавы ліміт DELETE, страчаны 204, абодва варыянты 403, паўтор пасля restart, спыненне наступнай порцыі analytics/feedback, сінтэтычны post-delete export.
- `node --test --experimental-strip-types supabase/functions/_shared/device-core.test.ts supabase/tests/feedback/feedback-pglite.test.ts tests/feedback/report-query.test.ts tests/feedback/report-retention.test.ts`: **46/46 pass** (рэальныя PGlite-каскады і правы доступу, ізаляванае асяроддзе).
- `node node_modules/typescript/bin/tsc --noEmit -p services`: **PASS** пасля тыпавой праўкі `withDeviceLifecycle<DeviceDeletionResult>` у `services/device.ts`; `-p core`: **PASS**.
- `npm run typecheck`: **NOT VERIFIED** як суцэльны gate: root `tsc --noEmit` атрымлівае TS6053 па `spikes/G00.03-sandbox-grant/server/device-auth.mjs`, бо файл у sandbox бачны як замаскіраваны не-файл. Маску не абыходзілі; асобныя services/core typechecks вышэй прайшлі.
- `npm run arch:check`: **PASS**, 658 модуляў, нуль парушэнняў.
- `node node_modules/.bin/jscpd --config .jscpd.json --no-tips .`: **PASS**, 706 файлаў, 0 дубляў; `npx --offline` раней не меў metadata cache, але ўсталяваны pinned бінарны файл працуе непасрэдна.
- `npm test`: паспрабавалі поўны прагон, але далёкая каманда не вярнула фінальны вынік у межах інструментальнага timeout. Не сцвярджаем PASS ці FAIL.
- `uvx showboat==0.6.1 --help`: MCP `run_command` адмаўляе `uvx`: дазволены толькі `node`, `npm`, `npx`, `python3`. Сетка выключана; у адпаведнасці з `showboat.md` звычайныя лакальныя тэсты працягнутыя.

## Што перашкаджае завершанаму PR

Большасць pinned dev-залежнасцяў ужо працуе; патрэбны бяспечны спосаб атрымаць поўны root typecheck без чытання замаскіраванага `device-auth.mjs`, паўтор поўнай матрыцы з фінальным вердыктам, даступны тэставы report host для паслявыдаленчага экспарту; дадатковыя адмоўныя рэверсійныя праверкі; самастойны review; пры неабходнасці Showboat. Production-токены або асабістыя даныя для гэтага не патрабуюцца.

Код нельга называць production-ready, пакуль усе крытэрыі і праверкі не закрытыя.
