# APR-08.a — privacyRetention без недаказаных агрэгатаў

*2026-11-01T21:10:02Z by Showboat 0.6.1*
<!-- showboat-id: e4492265-70b2-4bc0-90b8-38d80cad0ff2 -->

Крытэр 5 issue #849: кананічны web.ui.privacyRetention і восем перакладаў больш не абяцаюць захаваных route-агрэгатаў (retention-core.ts: no aggregate table exists yet), 14-месячнае абяцанне сырых падзей захаванае. Блокі — гейты змены з кораня рэпазітарыя; эмульятар і сетка не патрэбныя.

```bash
npm run messages:generate:check 2>&1 | grep 'files fresh'
```

```output
generated messages: 17 files fresh
```

Guard-тэст (правіла 1 implementation-rules): кожная з дзевяці моваў трымае тэрмін 14 месяцаў і не змяшчае свайго агрэгат-маркера; вяртанне маркера рве тэст з назвай мовы.

```bash
node --test --experimental-strip-types tools/i18n/privacy-disclosure.test.mjs 2>&1 | grep '^ℹ' | grep -v duration
```

```output
ℹ tests 18
ℹ suites 0
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Rendered-канальны parity: getUiStrings ва ўсіх дзевяці мовах = прагледжаны кантракт байт-у-байт — тое, што рэндэрыць публічная старонка прыватнасці.

```bash
node --test --experimental-strip-types web/lib/i18n/privacy-retention.test.ts 2>&1 | grep '^ℹ' | grep -v duration
```

```output
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
