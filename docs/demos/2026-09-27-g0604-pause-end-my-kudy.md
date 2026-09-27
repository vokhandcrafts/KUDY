# G06.04 — паўза, завяршэнне, вяртанне і My KUDY

*Showboat demo for issue #63 (G06.04), created 2026-09-27.*

<!-- showboat-id: g0604-session -->

Дэма ганяе жывы стэк кантролераў (сапраўдны кампазіцыйны корань, кантролер
сесіі G05.05, рэальны services/db над node:sqlite, фейкавыя OS-порты) праз
чатыры крытэрыі задачы: пацверджанае перамыканне гіда — адна транзакцыя
завяршае стары радок і пачынае новы, а аддаленая паверхня звальняецца
(критэр 1); законны Finish пасля адной гісторыі і паўторны праход з новым
`session_id` і чыстымі наборамі (критэр 2); гісторыя My KUDY — жывая
прагулка побач з завершанымі праходамі, найноўшыя першымі (критэр 3);
NAV7 — паўторны ўваход у жывую прагулку вяртае тую самую паверхню з
ранейшым становішчам панэлі (критэр 4). Поўны экранавы пласт — сюіты
`app/run.test.tsx` і `app/navigation.test.tsx` (jest),
`controllers/run/runSurfaceController.test.ts` і
`controllers/myKudyController.test.ts` (node --test). Уваходы фіксаваныя —
ручны гадзіннік, без выпадковасці.

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON test/demo-g0604-session.mjs
```

```output
surface A (route-map): session=walk-1 panel=half inspected=stop-1
switch: old row=finished live row=route-other/walk-2 new sets clean=true
surface A retired: phase=Ended wakelock=released (the cache eviction is the root suite's assertion)
re-entry (route-other): same surface=true panel=half (left at half)
pause: row=paused
finish after one story: walk-2=finished heard=["ostory-1"]
repeat walk: session=walk-3 heard=[]
My KUDY: walk-3(active) walk-2(finished) walk-1(finished)
```

Перамыканне зачыняе критэр 1: стары радок `finished`, жывы — `route-other`,
наборы новай сесіі чыстыя, звальненая паверхня скончыла свой люстэрка-стан
(`Ended`) і адпусціла wakelock. Крытэр 2: finish пасля адной праслуханай
гісторыі законны, паўторны праход — `walk-3` з пустым `heard`. Крытэр 4:
паўторны `create` вяртае тую самую паверхню (`same surface=true`) з панэллю
`half`, пакінутай чалавекам. Крытэр 3: гісторыя трыма жывую прагулку
(`walk-3`) побач з завершанымі (`walk-2`, `walk-1`) — нічога не сцёрта
(ADR G01.03 §3.1). Адкат праверкі: замена confirmedSwitch-галіны `start()` на
звычайны Start валіць два тэсты кантролера (`G06.04 criterion 1` ×2), адключэнне
кэшу паверхняў у кампазіцыйным корані валіць тэсты NAV7 і switch-эвікцыі —
праверана адкатам перад push.
