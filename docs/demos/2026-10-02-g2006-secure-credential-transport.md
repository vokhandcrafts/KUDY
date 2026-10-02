# Сакрэт толькі па правераным HTTPS: N3-межа транспартаў (issue #477, N3)

*Showboat demo для фіксу G20.06: дэфолтныя прадукцыйныя транспарты
`services/device.ts` і `services/analytics.ts` адпраўлялі запыт на адвольны
канфігурацыйны адрас — `http://example.invalid/functions/v1` атрымліваў
`Authorization: Bearer` (аўдыт A26-06), перанакіраванне магло пачаць другі
аўтарызаваны запыт. Створана 2026-10-02.*

<!-- showboat-id: g2006-secure-credential-transport -->

Дэма ганяе чатырнаццаць новых кейсаў G20.06 з трох сьютаў: адзінкі ўладара
праверкі `services/secure-url.test.ts` (parseable/https/без credentials,
карупцыя ўводу, рэдырэкт-ахова) і паводзінныя сьюіты N3 у
`services/device.test.ts` + `services/analytics.test.ts`, якія стімуюць
платформавы fetch (сакрэт — сінтэтычны фіксча) і ганяюць рэальныя дэфолтныя
транспарты: нуль сеткавых выклікаў на http/malformed/credentials,
`redirect: 'error'` на кожным запыце, адхіленне адказу з чужым фінальным URL.
Рэверц-эксперымент (implementation-rules 1) выкананы ў гэтай сесіі: вяртанне
абодвух транспартаў да версій з main робіць чырвонымі ўсе 8 N3-кейсаў.

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node --test --experimental-strip-types --test-name-pattern="G20.06" services/secure-url.test.ts services/device.test.ts services/analytics.test.ts 2>&1 | grep -E "^✔|^✖|^ℹ (tests|pass|fail)" | sed -E "s/ \([0-9.]+ms\)//"
```

```output
✔ G20.06 N3: secret-bearing events requests reject unsafe endpoints before any network call
✔ G20.06 N3: a valid configured https endpoint keeps the wire behavior with redirect refused
✔ G20.06 N3: when the platform refuses the redirect, the send fails closed with network_failed
✔ G20.06 N3: a response redirected away from the endpoint is not accepted
✔ G20.06 N3: http, malformed and credential URLs are rejected before any network call
✔ G20.06 N3: a valid configured https endpoint registers through the default transport with redirect refused
✔ G20.06 N3: when the platform refuses the redirect, registration fails closed with network_failed
✔ G20.06 N3: a response redirected away from the endpoint is not accepted
✔ G20.06 a parseable https endpoint passes and is returned as the URL object to fetch
✔ G20.06 http, malformed and credential-bearing endpoints are rejected with named diagnostics
✔ G20.06 a rejected endpoint is diagnosed without echoing the URL into the message
✔ G20.06 corrupt non-string input yields a diagnostic, never a raw parser crash
✔ G20.06 a response whose final URL left the requested endpoint is rejected
✔ G20.06 the exact requested endpoint and an unreported response URL pass the redirect guard
ℹ tests 14
ℹ pass 14
ℹ fail 0
```
