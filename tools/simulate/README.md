# Сімулятар Run (G05.06)

Праганяе GPS-трэк праз **тыя самыя** прадакшн-функцыі, што і тэлефон: рэальны
`RunOrchestrator` (а ў ім — `acceptFix` і `step`), рэальныя
`LocationService`/`AudioService` над дэтэрміністычнымі портамі. Канон —
[09 §11](../../docs/architecture/09_technical_architecture.md): адна чарга
адкладзеных дзеянняў, ніякага сцянога часу і выпадковасці, справаздача
байт-стабільная.

## Трэйс

JSON-дакумент (`trace-schema.mjs` правярае цалкам; пашкоджаны трэйс —
названыя дыягностыкі, ніякага прагону):

```
route:  { routeId, version, locale, tier: ['base'|'extended', …] }
stops:  [{ stopId, lat, lng, radius, storyBaseId?, storyExtendedId? }]
config: { dwellMs?, audio: { defaultDurationMs?, stories?: {id: ms} } }
events: у парадку неспадаючага `at`
```

Падзеі: `GpsFix` · `AppBackground/Foreground` · `UserCommand`
(`Start, PlayStop, PlayStory, Pause, Resume, End, PauseAudio, ResumeAudio,
GuideResume, PlayMoment`), інжэктары збояў `AccuracyDegradation` ·
`TimestampJump` · `SignalGap` · `IncomingCall/CallEnded` і — з G05.06.b —
`AccessReady { at, tier, stopIds }`: разблакіроўка правоў прыходзіць праз
capability-порт `services/download` (ADR G01.03 §3.5); routeId/version/locale
бярцца з трэйса, невядомы stopId адкрывае нічога. Сама разблакіроўка нічога
не гучыць — наступны dwell у радыусе робіць.

## CLI

```
node tools/simulate/cli.mjs --trace <trace.json> [--out <report.json>]
```

Коды выхаду: `0` — прагон завяршыўся (частковая прагулка — нармальны зыход);
`1` — сегмент гучыць у канцы трэйса (`stuck_playing`); `2` — трэйс пашкоджаны.

## Згенераваны набор трэйсаў (G05.06.b)

`generate.mjs` — чыстыя білдары з імавернасным зернем (mulberry32): чатыры
генератары 09 §11 (чысты праход, стаянне на кожнай кропцы, хуткі праход, старт
з сярэдзіны) плюс сцэнарныя фікстуры радка G05.06 (replay пачутай кропкі,
зваротны парадак, правал GPS, страта фокуса падчас гіда, locked-кропка,
разблакіраваная `AccessReady` пасярод праходу). Зерні — у рэестры
`TRACE_FILES`; камітныя файлы ў `traces/` узнаўляюцца байт у байт
(`traces.test.mjs` правярае і падае пры любым дрэйфе).

## Чаканні і праверка

`expectations/<трэйс>.json` — чаканне канкрэтнага трэйса: `{ trace, exit,
mustFire, mustNotFire, report }`, дзе `report` — цэлая байт-стабільная
справаздача піна. Runner `verify.mjs` спачатку правярае спісы
`mustFire`/`mustNotFire` (што абавязкова спрацавала і што не сме), потым
параўноўвае справаздачу радок за радком: усякая розніца — падзенне з імем
трэйса і першай рознай радком. Чаканні прывязаныя да стабільнага імені
`traces/<файл>` — бяз шляхаў гаспадарскай машыны. Уваход у праверку — праз
`npm test`; праверка кропак частковай прагулкі — толькі па яе ўласным чаканні.

## Слот палявога трэйса

`traces/field/` — месца для адзінага запісанага рэальнага прахода (другі пласт
09 §11). Фармат — той самы дакумент трэйса: `GpsFix` з фактычнымі пазнакамі
часу прылады, інжэктары для перапыненняў (званок, правал сігналу),
`UserCommand` для ручных дзеянняў; час — мс ад старта запісу. Слот пусты да
G11.02: запіс рэальнай прагулкі — не выкананы крок G11.02 (гл.
[results/G05.06.b.md](../../docs/agent-tasks/results/G05.06.b.md)).
