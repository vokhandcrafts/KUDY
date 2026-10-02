# G20.25 — пашкоджаны маніфест grant: закрыты 403, не 503

*Showboat demo for issue #498 (`supabase/functions/grant/`), created 2026-10-02.*

Усе блокі дэтэрмінаваныя: сапраўдны вытворчы апрацоўшчык `serveGrantRequest`
з `_shared/grant-wire.ts` імпартуецца цалкам — з сапраўднай bearer-аўтэнтыфікацыяй,
сапраўдным загрузчыкам маніфеста, сапраўдным RevenueCat-адаптарам і сапраўдным
сігнерам. Фейкі — толькі транспарты: SQL адказвае пінавымі канстантамі стэйтмэнтаў,
`globalThis.fetch` маршрутызуецца па URL на фейкавы Storage/RevenueCat край;
жывога дэплою, сакратаў і рэальных сеткавых выклікаў няма (N7-межы выпуску).
Кожны блок задае `LD_LIBRARY_PATH=$HOME/.local/lib` яўна: node гэтага хаста
патрабуе `libsimdjson.so.33` з `~/.local/lib`, а Showboat запускае блокі ў
ачышчаным асяроддзі (implementation-rules 9).

Першы блок — крытэры 1: пашкоджаныя байты маніфеста (абрэзаны JSON, `null`,
масіў, няправільныя палі) праз вытворчы апрацоўшчык адказваюць закрытым
`403 manifest_not_found`, і ніводзін выклік да RevenueCat ніводзін подпіс
не адбываецца. Да выпраўлення абрэзаны JSON і `null` уцякалі ў знешнюю мяжу
збою як `503 entitlement_unavailable` — гэта лоўяць названыя тэсты
`corrupt_manifest_403_no_provider` і `null_manifest_403` (эксперымент на адкат
зроблены да адпраўкі змен):

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --experimental-strip-types --input-type=module -e "
const w = await import('./supabase/functions/_shared/grant-wire.ts');
const gc = await import('./supabase/functions/_shared/grant-core.ts');
const dc = await import('./supabase/functions/_shared/device-core.ts');
const cfg = { environment: 'sandbox', revenueCatSecret: 'rc-secret', revenueCatBase: 'https://rc.test', supabaseUrl: 'https://storage.test', serviceRoleKey: 'role-key', bucket: 'files', urlTtlSeconds: 600, cacheTtlSeconds: 86400 };
let manifest = 'null', providerCalls = 0, signCalls = 0;
globalThis.fetch = (input) => {
  const url = String(input);
  if (url.includes('/storage/v1/object/sign/')) { signCalls += 1; return Promise.resolve(new Response(JSON.stringify({ signedURL: '/object/sign/fake?token=x' }), { status: 200 })); }
  if (url.includes('/storage/v1/object/')) return Promise.resolve(new Response(manifest, { status: 200, headers: { 'content-type': 'application/json' } }));
  providerCalls += 1;
  return Promise.resolve(new Response('{}', { status: 200 }));
};
const db = { unsafe: (sql) => {
  if (sql === dc.DEVICE_LOOKUP_SQL) return Promise.resolve([{ device_id: 'd-1' }]);
  if (sql === gc.GRANT_PRODUCT_LOOKUP_SQL) return Promise.resolve([{ product_id: 'demo.product.01' }]);
  if (sql === gc.GRANT_RATE_INCREMENT_SQL) return Promise.resolve([{ attempts: 1 }]);
  return Promise.resolve([]);
} };
const full = JSON.stringify({ paths: ['a.txt', 'b.txt'], lock_url: 'https://files.test/demo-route/lock.json' });
const cases = [['truncated-json', full.slice(0, 18)], ['json-null', 'null'], ['array', '[]'], ['invalid-fields', JSON.stringify({ paths: 'a.txt', lock_url: '' })]];
for (const [label, bytes] of cases) {
  manifest = bytes;
  const response = await w.serveGrantRequest(new Request('https://edge.test/functions/v1/grant', { method: 'POST', headers: { authorization: 'Bearer demo-secret' }, body: JSON.stringify({ route_id: 'demo-route', version: 'v1', locale: 'be', tier: 'extended', paths: ['a.txt'] }) }), () => db, () => ({ ...cfg }));
  const answer = response.status === 200 ? '200' : (await response.json()).error.code;
  console.log(label.padEnd(16) + ' ' + response.status + ' ' + answer + ' | provider: ' + providerCalls + ' | sign: ' + signCalls);
}
" 2>/dev/null
```

```output
truncated-json   403 manifest_not_found | provider: 0 | sign: 0
json-null        403 manifest_not_found | provider: 0 | sign: 0
array            403 manifest_not_found | provider: 0 | sign: 0
invalid-fields   403 manifest_not_found | provider: 0 | sign: 0
```

Другі блок — крытэр 2: сапраўдны збой транспарту (Storage недаступны) захоўвае
свой дакументаваны шлях — `503 entitlement_unavailable` з `Retry-After`, — гэта
іншая прычына, чым 403 пашкоджаных байтаў; правайдар і подпісы таксама не
дасягаюцца:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --experimental-strip-types --input-type=module -e "
const w = await import('./supabase/functions/_shared/grant-wire.ts');
const gc = await import('./supabase/functions/_shared/grant-core.ts');
const dc = await import('./supabase/functions/_shared/device-core.ts');
const cfg = { environment: 'sandbox', revenueCatSecret: 'rc-secret', revenueCatBase: 'https://rc.test', supabaseUrl: 'https://storage.test', serviceRoleKey: 'role-key', bucket: 'files', urlTtlSeconds: 600, cacheTtlSeconds: 86400 };
let failStorage = true, providerCalls = 0, signCalls = 0;
globalThis.fetch = (input) => {
  const url = String(input);
  if (url.includes('/storage/v1/object/sign/')) { signCalls += 1; return Promise.resolve(new Response(JSON.stringify({ signedURL: '/object/sign/fake?token=x' }), { status: 200 })); }
  if (url.includes('/storage/v1/object/')) { if (failStorage) return Promise.reject(new Error('fetch failed https://storage.test/storage/v1/object/files/manifest.json ECONNREFUSED')); }
  providerCalls += 1;
  return Promise.resolve(new Response('{}', { status: 200 }));
};
const db = { unsafe: (sql) => {
  if (sql === dc.DEVICE_LOOKUP_SQL) return Promise.resolve([{ device_id: 'd-1' }]);
  if (sql === gc.GRANT_PRODUCT_LOOKUP_SQL) return Promise.resolve([{ product_id: 'demo.product.01' }]);
  if (sql === gc.GRANT_RATE_INCREMENT_SQL) return Promise.resolve([{ attempts: 1 }]);
  return Promise.resolve([]);
} };
const response = await w.serveGrantRequest(new Request('https://edge.test/functions/v1/grant', { method: 'POST', headers: { authorization: 'Bearer demo-secret' }, body: JSON.stringify({ route_id: 'demo-route', version: 'v1', locale: 'be', tier: 'extended', paths: ['a.txt'] }) }), () => db, () => ({ ...cfg }));
const answer = await response.json();
console.log(response.status + ' ' + answer.error.code + ' | retry-after: ' + response.headers.get('retry-after') + ' | provider: ' + providerCalls + ' | sign: ' + signCalls);
" 2>/dev/null
```

```output
503 entitlement_unavailable | retry-after: 30 | provider: 0 | sign: 0
```

Трэці блок — крытэр 3: правільны маніфест з трапленнем у кэш таго ж асяроддзя
адкрывае толькі запытаныя бяспечныя шляхі, якія ёсць сябрамі маніфеста, з
`lock_url` з маніфеста; кэш таго ж асяроддзя мінае правайдара:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --experimental-strip-types --input-type=module -e "
const w = await import('./supabase/functions/_shared/grant-wire.ts');
const gc = await import('./supabase/functions/_shared/grant-core.ts');
const dc = await import('./supabase/functions/_shared/device-core.ts');
const cfg = { environment: 'sandbox', revenueCatSecret: 'rc-secret', revenueCatBase: 'https://rc.test', supabaseUrl: 'https://storage.test', serviceRoleKey: 'role-key', bucket: 'files', urlTtlSeconds: 600, cacheTtlSeconds: 86400 };
let providerCalls = 0, signCalls = 0;
globalThis.fetch = (input) => {
  const url = String(input);
  if (url.includes('/storage/v1/object/sign/')) { signCalls += 1; return Promise.resolve(new Response(JSON.stringify({ signedURL: '/object/sign/fake?token=x' }), { status: 200 })); }
  if (url.includes('/storage/v1/object/')) return Promise.resolve(new Response(JSON.stringify({ paths: ['a.txt', 'b.txt'], lock_url: 'https://files.test/demo-route/lock.json' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  providerCalls += 1;
  return Promise.resolve(new Response('{}', { status: 200 }));
};
const cacheRow = { environment: 'sandbox', expires_at_ms: Date.now() + 3600000 };
const db = { unsafe: (sql) => {
  if (sql === dc.DEVICE_LOOKUP_SQL) return Promise.resolve([{ device_id: 'd-1' }]);
  if (sql === gc.GRANT_PRODUCT_LOOKUP_SQL) return Promise.resolve([{ product_id: 'demo.product.01' }]);
  if (sql === gc.GRANT_RATE_INCREMENT_SQL) return Promise.resolve([{ attempts: 1 }]);
  if (sql === gc.GRANT_CACHE_READ_SQL) return Promise.resolve([cacheRow]);
  return Promise.resolve([]);
} };
const response = await w.serveGrantRequest(new Request('https://edge.test/functions/v1/grant', { method: 'POST', headers: { authorization: 'Bearer demo-secret' }, body: JSON.stringify({ route_id: 'demo-route', version: 'v1', locale: 'be', tier: 'extended', paths: ['a.txt'] }) }), () => db, () => ({ ...cfg }));
const body = await response.json();
console.log(response.status + ' ' + body.lock_url + ' | minted: ' + body.urls.map((u) => u.path).join(',') + ' | provider: ' + providerCalls + ' | sign: ' + signCalls);
" 2>/dev/null
```

```output
200 https://files.test/demo-route/lock.json | minted: a.txt | provider: 0 | sign: 1
```
