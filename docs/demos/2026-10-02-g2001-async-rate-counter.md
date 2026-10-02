# G20.01: асінхронны SQL-лічыльнік у device/events + чырвоныя дыягностыкі

*Showboat demo задачи [#472](https://github.com/vokhandcrafts/KUDY/issues/472)
(эпік #470): сапраўдныя апрацоўшчыкі `handleDeviceRequest` і
`handleEventsWireRequest` чакаюць вынік атамарнага SQL-інкрэменту перад
параўнаннем з лімітам (спец N1, аўдыт A26-01); несапраўдны ці зламаны
адказ SQL дае бяспечную закрытую адмову з адным дзеразным серверным
дыягностыкам. Створана 2026-10-02.*

Паводзінавыя рэгрэсійныя тэсты дзвюх wire-сюітаў — асінхронны SQL-фейк,
няма сінхроннага счётчыка-фейка:

```sh
node --test --experimental-strip-types supabase/functions/_shared/device-wire.test.ts supabase/functions/_shared/events-wire.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

Жывы сапраўдны апрацоўшчык пры зламаным SQL: кліент атрымлівае існы код
`500 server_error` (не 429 і не 201), а ў серверны журнал трапляе роўна адзін
дыягностык з назвай аперацыі і бяспечнай прычынай — без паведамлення памылкі
SQL, цела запыту ці параметраў:

```sh
node --experimental-strip-types --input-type=module -e "import { handleDeviceRequest } from './supabase/functions/_shared/device-wire.ts'; const seen = []; const original = console.error; console.error = (...args) => seen.push(args.join(' ')); const db = { unsafe: async () => { throw new Error('pq: connection refused'); } }; const res = await handleDeviceRequest({ method: 'POST', headers: { get: () => null } }, db); console.error = original; console.log('response:', res.status, await res.text()); console.log('diagnostic:', seen[0]);" 2>/dev/null
```

```output
response: 500 {"error":"server_error"}
diagnostic: {"operation":"device_registration","reason":"rate_increment_failed"}
```

Рэверт-эксперымент (implementation-rules 1): выдаленне радка з `await
storage.increment` з агульнага рашэння `checkRateLimit` робіць абедзве
рэгрэсіі чырвонымі (першы запыт атрымлівае 500 замест 201/200); аднаўленне з
git — зелёнае.

```sh
perl -ni -e "print unless /await storage\.increment/" supabase/functions/_shared/device-core.ts
node --test --experimental-strip-types supabase/functions/_shared/device-wire.test.ts supabase/functions/_shared/events-wire.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"
git checkout -- supabase/functions/_shared/device-core.ts
node --test --experimental-strip-types supabase/functions/_shared/device-wire.test.ts supabase/functions/_shared/events-wire.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"
```

```output
ℹ pass 5
ℹ fail 11
ℹ pass 16
ℹ fail 0
```
