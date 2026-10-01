# G09.02 — згода на аналітыку і серверны прыём падзей

*Showboat demo for issue #286 (G09.02 — consent gate над чаргай G09.01 + POST /v1/events), created 2026-10-01.*

Сцэнар на рэальным прадакшн-кодзе. Кліенцкі бок (`services/analytics.ts` над
`services/eventLog.ts`): без згоды gated-flush не чытае чаргу і не будзіць
сэнсар — нуль адпрацовак і нуль пазнак; пасля гранта першы ж flush аддае ўсе
назапашаныя падзеі; адкліканне спыняе адпраўку, але чарга і лакальны запіс
жывуць — падзея «адкліканага перыяду» ідзе наступным granted-flush-ам.
(`export LD_LIBRARY_PATH` — хоставае патрабаванне node, не частка змены.)

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
rm -rf /tmp/kudy-g0902-demo
mkdir -p /tmp/kudy-g0902-demo
node --experimental-strip-types --input-type=module -e '
import { pathToFileURL } from "node:url";
const { openDatabase } = await import(pathToFileURL("services/db/db.ts"));
const { nodeSqliteFileDriver } = await import(pathToFileURL("services/db/test-fixture.ts"));
const { emitEvent, flushEvents } = await import(pathToFileURL("services/eventLog.ts"));
const { flushAnalytics, setAnalyticsConsent, getAnalyticsConsent } = await import(pathToFileURL("services/analytics.ts"));

const sender = (events) => {
  console.log(`SEND ${events.length}: ${events.map((e) => e.event_id).join(",")}`);
  return Promise.resolve();
};
const store = nodeSqliteFileDriver("/tmp/kudy-g0902-demo/events.db");
openDatabase(store.driver);
emitEvent(store.driver, { eventId: "evt-a", type: "app_open", at: 1, schemaVersion: 1, payload: "{}" });
emitEvent(store.driver, { eventId: "evt-b", type: "session_started", at: 2, schemaVersion: 1, payload: JSON.stringify({ session_id: "s1", route_id: "r1", version: "1" }) });
console.log("consent:", getAnalyticsConsent(store.driver));
console.log("flush-1 marked", await flushAnalytics(store.driver, sender));
setAnalyticsConsent(store.driver, "granted");
console.log("flush-2 marked", await flushAnalytics(store.driver, sender));
setAnalyticsConsent(store.driver, "revoked");
emitEvent(store.driver, { eventId: "evt-c", type: "route_preview", at: 3, schemaVersion: 1, payload: JSON.stringify({ route_id: "r1" }) });
console.log("flush-3 marked", await flushAnalytics(store.driver, sender));
console.log("queue after withdrawal:", await flushEvents(store.driver, sender));
store.close();
' 2>/dev/null
rm -rf /tmp/kudy-g0902-demo
```

```output
consent: null
flush-1 marked 0
SEND 2: evt-a,evt-b
flush-2 marked 2
flush-3 marked 0
SEND 1: evt-c
queue after withdrawal: 1
```

Серверны бок — той самы прадакшн-ядро прыёму, што і ў Deno-функцыі
`/v1/events` (`supabase/functions/_shared/events-core.ts`), з інжэктаваным
in-memory сховішчам і кананічнай табліцай падзей: G08.01 device-bearer адзіны
шлях аўтэнтыфікацыі; невалідны payload — 400 з прычынай, якая называе клас
парушэння, а не 500; паўторная адпраўка дэдупіруецца па `event_id`
(`09` §15), сховішча атрымлівае толькі свежыя радкі.

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types --input-type=module -e '
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const { handleEventsRequest, defaultEventsConfig } = await import(pathToFileURL("supabase/functions/_shared/events-core.ts"));
const { hashSecret } = await import(pathToFileURL("supabase/functions/_shared/device-core.ts"));

const table = JSON.parse(fs.readFileSync("contracts/events/event-table.v1.json", "utf8"));
const seen = new Set();
const port = {
  async lookupDeviceId(secretHash) { return secretHash === hashSecret("demo-secret") ? "demo-device" : null; },
  incrementEventRate() { return 1; },
  async insertEventBatch(deviceId, rows) {
    const fresh = rows.filter((r) => !seen.has(r.eventId));
    for (const row of fresh) seen.add(row.eventId);
    console.log(`STORE ${fresh.length} of ${rows.length} for ${deviceId}`);
    return fresh.length;
  },
};
const cfg = defaultEventsConfig(1759276800000);
const event = (id, type, payload) => ({ event_id: id, type, at: "2026-10-01T00:00:00.000Z", schema_version: 1, payload });
const call = (authorization, body) => handleEventsRequest(
  { method: "POST", authorization, rawBody: new TextEncoder().encode(JSON.stringify(body)) }, port, table, cfg,
);

console.log("no-auth:", JSON.stringify(await call(null, { events: [event("aaaaaaaa-0000-4000-8000-000000000000", "app_open", {})] })));
console.log("valid:  ", JSON.stringify(await call("Bearer demo-secret", { events: [event("aaaaaaaa-0000-4000-8000-000000000001", "app_open", {})] })));
console.log("coords: ", JSON.stringify(await call("Bearer demo-secret", { events: [event("aaaaaaaa-0000-4000-8000-000000000002", "app_open", { lat: 54.4 })] })));
console.log("unknown:", JSON.stringify(await call("Bearer demo-secret", { events: [event("aaaaaaaa-0000-4000-8000-000000000003", "not_an_event", {})] })));
console.log("resend: ", JSON.stringify(await call("Bearer demo-secret", { events: [event("aaaaaaaa-0000-4000-8000-000000000001", "app_open", {})] })));
' 2>/dev/null
```

```output
no-auth: {"status":403,"code":"device_auth_failed"}
STORE 1 of 1 for demo-device
valid:   {"status":200,"body":{"accepted":1}}
coords:  {"status":400,"code":"invalid_event","reason":"events[0].payload.lat: forbidden-coordinates"}
unknown: {"status":400,"code":"invalid_event","reason":"events[0].type: unknown event type"}
STORE 0 of 1 for demo-device
resend:  {"status":200,"body":{"accepted":0}}
```

Прыёмачныя сюіты зялёныя: кліенцкі бок (крытэрыі 1–2 з issue #286) і сервернае
ядро (крытэрыі 3–5, па адным ізалюючым негатыве на кожны клас парушэння).
grep пакідае толькі дэтэрмінаваныя радкі зводкі, без таймінгаў:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --test --experimental-strip-types services/analytics.test.ts supabase/functions/_shared/events-core.test.ts 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

```output
ℹ tests 45
ℹ pass 45
ℹ fail 0
```
