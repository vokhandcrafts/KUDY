# G20.26 — ліміт grant-запытаў перад RevenueCat

*Showboat demo for issue #499 (`supabase/functions/grant/`, `services/download/grant.ts`), created 2026-10-02.*

Усе блокі дэтэрмінаваныя: сапраўднае грант-ядро і сапраўдны кліенцкі
`requestGrant` імпартуюцца цалкам; SQL — сапраўдны PGlite з камічанымі
міграцыямі (лічыльнік `grant_request_rate`), правайдар/маніфест/сigner —
фейкі на фіксаваным гадзінніку. Android/iOS і жывая ква RevenueCat —
асобныя прыёмкавыя доказы, ніводны блок тут іх не сцвярджае. Кожны блок
задае `LD_LIBRARY_PATH=$HOME/.local/lib` яўна: node гэтага хаста патрабуе
`libsimdjson.so.33` з `~/.local/lib`, а Showboat запускае блокі ў
ачышчаным асяроддзі (implementation-rules 9).

Першы блок — крытэры 1 і 3 на выпраўленым кодзе: адна прылада вычэрпвае
свой аконны ліміт запытаў (кожны раунд лічыцца, паўторы ўключна), адказ
па-за лімітам — закрыты `429 rate_limited` з `Retry-After`, і па-за
лімітам правайдар больш не выклікаецца ніводзін раз. Да выпраўлення той
самы скрыпт паведамляў `provider calls at the end: 2` — брамы не было і
кожны запыт даходзіў да RevenueCat:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --experimental-strip-types --input-type=module -e "
const h = await (await import('./supabase/functions/_shared/demo-grant-harness.ts')).createGrantDemoHarness(['a.txt']);
const { handleGrant } = await import('./supabase/functions/_shared/grant-core.ts');
const request = { route_id: 'demo-route', version: 'v1', locale: 'be', tier: 'extended', paths: ['a.txt'] };
let limited = 0, lastProviderCalls = 0;
for (let round = 0; round < 32; round += 1) {
  const answer = await handleGrant(request, h.deviceId, { environment: 'sandbox' }, h.deps);
  if (answer.status === 429) { limited += 1; lastProviderCalls = h.providerCalls; }
}
console.log('429 answers: ' + limited + ' | provider calls at the first limit: ' + lastProviderCalls + ' | provider calls at the end: ' + h.providerCalls);
" 2>/dev/null
```

```output
429 answers: 2 | provider calls at the first limit: 1 | provider calls at the end: 1
```

Другі блок — крытэр 4, кліенцкі бок: `429 rate_limited` з `Retry-After`
рэтраіцца абмежавана (палітыка `maxRetries: 2`), чаканні роўныя
разабраным загалоўкам, і пасля вычарпання межы кліент больш не звоніць —
вынік нясе свой чаканне для позняй спробы:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --experimental-strip-types --input-type=module -e "
const { requestGrant, DEFAULT_GRANT_RETRY } = await import('./services/download/grant.ts');
let call = 0, waits = [];
const outcome = await requestGrant(
  { routeId: 'demo-route', version: 'v1', locale: 'be', tier: 'extended', lock: [{ path: 'a.txt', bytes: 1, sha256: 'a'.repeat(64) }] },
  {
    transport: async () => {
      call += 1;
      const retryAfter = call === 1 ? '3' : call === 2 ? '11' : '59';
      return { status: 429, headers: { 'retry-after': retryAfter }, body: { error: { code: 'rate_limited' } } };
    },
    credential: async () => 'device-secret',
    delay: async (ms) => { waits.push(ms); },
    policy: { maxRetries: 2 },
  },
);
console.log('transport calls: ' + call + ' | waits ms: ' + waits.join(', ') + ' (default ' + DEFAULT_GRANT_RETRY.defaultRetryAfterMs + ' unused)');
console.log('outcome: ' + outcome.kind + ' | retries used: ' + outcome.retriesUsed + ' | carry wait ms: ' + outcome.retryAfterMs);
" 2>/dev/null
```

```output
transport calls: 3 | waits ms: 3000, 11000 (default 30000 unused)
outcome: rate-limited | retries used: 2 | carry wait ms: 59000
```
