# G338 — Metro збірае device-бандл: blockList, node-стаб і node-free safe-path

*Showboat demo for issue #338 (device-run), created 2026-09-27.*

<!-- showboat-id: g338-metro-device-bundle -->

Дэма друкаваныя вердыкты committed Metro-wiring-у з драйвера `test/demo-g338-metro.mjs`:
blockList выключае jest-файлы і службовыя тэчкі `.mimosa`/`.zcode`/`.scratch`, але не код
`app/`; `node:path` рэзолвіцца ў `metro-node-stub.js`; стаб грузіцца і кідае іменаваную
памылку толькі пры выкліку builtin-а (пры імпарце модуль праходзіць — гэта ўмова загрузкі
на прыладзе). Wiring ахаваны сюітай `tools/metro-config/metro-config.test.mjs` у `npm test`.

```sh
node test/demo-g338-metro.mjs
```

```output
blockList: jest=true mimosa=true zcode=true scratch=true appCode=false
node:path -> sourceFile metro-node-stub.js
stub call: KUDY: node builtin isAbsolute must not run in the device bundle
```

Поўны ланцуг доказаў задачы (гэта ж сесія, гейты на HEAD): device-бандл з пакета
`expo-router/entry.bundle?platform=android&dev=true&lazy=true&transform.engine=hermes&transform.routerRoot=app`
адказвае HTTP 200 (лог Metro з лікам модуляў — у Evidence PR), і дадатак на AVD `kudy-test` пад `/explore`
рэндэрыць каталог («Гданьск», «Побач», «Каталог недаступны» — сумленны стан без портаў).
Адкат праверкі (праверана перад push): выразанне blockList з `metro.config.js`, выразанне
`resolveRequest` або выдаленне `metro-node-stub.js` — кожны з трох эксперыментаў рабіць
сюіту `tools/metro-config/metro-config.test.mjs` чырвонай; вяртанне `node:path` у
`services/contentRepo/inventory.ts` зноў цягне builtin у прадуктовы ланцуг з `app/`.
