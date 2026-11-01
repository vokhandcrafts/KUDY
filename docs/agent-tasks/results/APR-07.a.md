# APR-07.a — частковая рэалізацыя і праверкі

Дата: 2026-11-01. Issue: [#835](https://github.com/vokhandcrafts/KUDY/issues/835). Галіна: `chatgpt/835`.
Статус: **не завершана, blocked-external**. Гэты файл не з'яўляецца доказам выканання ўсіх AC і не дазваляе merge.

## Крыніцы і аб'ём

Прагледжаны `services/device.ts`, `services/db/db.ts`, `services/device-secure-store.ts`, `services/analytics.ts`, `services/crash.ts`, `services/feedbackSync.ts`, `services/eventLog.ts`, `services/db/schema.ts`, вытворчы handler `supabase/functions/_shared/device-{core,wire}.ts` і ADR `docs/architecture/decisions/APR-07-device-data-deletion.md`. Лакальны worktree створаны на `97569cb6`, пры гэтым `main` працягваў змяняцца іншымі задачамі: перад канчатковым PR патрэбная актуалізацыя галіны.

Фактычныя ключы прыватнасці ў SQLite `settings`: `analytics_consent` і `crash_consent`; версія disclosure водгуку захоўваецца ў `feedback_outbox` і выдаляецца разам з чаргой. Непрыватнасныя налады, уключаючы мову, не выдаляюцца. Сакрэт застаецца толькі ў SecureStore, у SQLite запісваецца толькі несакрэтны статус выдалення.

## Праца па крытэрыях

1. **Часткова:** праведзена інвентарызацыя стану, вызначаны фазы `pending_remote`, `cleanup_remote_confirmed`, `cleanup_remote_unverified`, `complete_remote_confirmed`, `complete_remote_unverified`. Серверны 403 не з'яўляецца пацверджаннем аддаленага выдалення.
2. **Пакрыта лакальным SQLite-тэстам:** транзакцыйна ачышчаюцца `device`, `event_queue`, `feedback_local`, `feedback_outbox`, `analytics_consent`, `crash_consent`. Тэст правярае захаванне `session.heard`, `guide_hint_state`, `guide_hint_last`, `migration_log`, `catalog_cache`, `event_queue_seq`, мовы; новая падзея пасля выдалення не адпраўляецца без новай згоды. Патрабуецца дадатковая шырокая матрыца збоевых SQLite-кейсаў.
3. **Часткова:** праверка дакладнага JSON `{"error":"device_auth_failed"}` для 403; іншыя 403 і няправільнае цела 204 захоўваюць сакрэт і магчымасць паўтору. Кожны кананічны 403 вяртае `remote_unverified`, 204 — `remote_confirmed`. Default HTTPS-transport правераны з сінтэтычным `fetch`. Паўнавартасны PGlite-сцэнар з чужым сакрэтам і жывымі сервернымі радкамі **не выкананы**: адсутнічае `@electric-sql/pglite`.
4. **Часткова:** стан `cleanup_*` перажывае падзенне паміж SQLite і SecureStore, правераны file-backed SQLite restart, ін'екцыя збою SecureStore і транзакцыі. `pending_remote` не пускае новыя рэгістрацыі або адпраўкі без яўнага паўтору выдалення, у тым ліку пасля перазапуску file-backed SQLite. Не ўсе платформенныя сцэнары правераны.
5. **Часткова:** дадзены агульны per-driver асінхронны бар'ер для рэгістрацыі, выдалення, analytics flush, feedback flush і conflict read. Тэсты даказваюць, што выдаленне чакае бягучую адпраўку, што аналітыка не пачынае наступны batch, feedback не адпраўляе другую мутацыю пасля запыту выдалення і новая рэгістрацыя ў гэты момант не пачынаецца. Існыя feedback queue tests прайшлі. Патрабуецца канчатковы незалежны прагон на production composition.
6. **Не выканана да канца:** вытворчы device-wire unit test праходзіць з тэставым портам, а лакальныя `tools/feedback-report` тэсты пацвярджаюць імпарт, захаванне, выдаленне сінтэтычнага экспарта і паўторную генерацыю пустой справаздачы з паслявыдаленчага CSV. Але **няма падключанага report host**, таму перастварэнне пасля рэальнага device-delete і інтэграцыйны каскад PostgreSQL/PGlite не пацверджаныя. Ніякіх правоў report host кліенту не дадалі.
7. **Часткова:** новы `services/device-deletion.test.ts` падхопліваецца існым glob `services/**/*.test.ts` у `npm test`; асобныя тэсты праходзяць. Ізаляванае адмоўнае выпрабаванне: пры часовым выдаленні радка, які скідае `crash_consent`, новая suite становіцца чырвонай; радок адноўлены і suite зноў праходзіць. Таксама ізаляваныя адкаты аховы наступнага batch аналітыкі, другога feedback-запыту і аднаўлення пасля restart робяць свае тэсты чырвонымі; кожная змена пасля выпрабавання адноўлена. Астатнія адкаты яшчэ не правераныя. Showboat не створаны з прычыны недаступнага `uvx`.

## Каманды і дакладныя вынікі

- Аб'яднаны апошні паўтор `node --test --experimental-strip-types services/device.test.ts services/device-deletion.test.ts services/analytics.test.ts services/db/db.test.ts tests/feedback/queue-sync.test.ts tests/feedback/queue-durability.test.ts supabase/functions/_shared/device-wire.test.ts tools/feedback-report/cli.test.mjs`: **133/133 pass**. Пакрытыя адсутны сакрэт і пашкоджаная захаваная фаза, часавы ліміт DELETE, страчаны 204, абодва варыянты 403, паўтор пасля restart, спыненне наступнай порцыі analytics/feedback, сінтэтычны post-delete export.
- Сумесны запуск `supabase/functions/_shared/device-core.test.ts`, `device-wire.test.ts`, `supabase/tests/feedback/feedback-core.test.ts`, `tools/feedback-report/{export,cli}.test.mjs`: **40 pass, 1 suite fail** — `ERR_MODULE_NOT_FOUND: @electric-sql/pglite`.
- `npm run typecheck`: не запускаецца, `tsc: not found`, адсутнічае `node_modules`.
- `npm run arch:check`: FAIL, адсутнічае `dependency-cruiser`.
- `npx --offline --yes jscpd@5.1.2 --config .jscpd.json --no-tips .`: FAIL, `ENOTCACHED`.
- `npm test`: запушчана, **timeout 60 s**, поўнага вердыкту няма; запуск таксама патрабуе неўсталяваных залежнасцяў і Jest.
- `uvx showboat==0.6.1 --help`: MCP `run_command` адмаўляе `uvx`: дазволены толькі `node`, `npm`, `npx`, `python3`. Сетка выключана; у адпаведнасці з `showboat.md` звычайныя лакальныя тэсты працягнутыя.

## Што перашкаджае завершанаму PR

Патрэбныя ізаляваныя залежнасці `npm ci` / офлайнавы кэш для pinned TypeScript, dependency-cruiser, jscpd і PGlite; паўтор поўнай матрыцы; даступны тэставы report host для паслявыдаленчага экспарту; дадатковыя адмоўныя рэверсійныя праверкі; самастойны review; пры неабходнасці Showboat. Production-токены або асабістыя даныя для гэтага не патрабуюцца.

Код нельга называць production-ready, пакуль усе крытэрыі і праверкі не закрытыя.
