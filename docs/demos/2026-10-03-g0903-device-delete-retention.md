# G09.03 — выдаленне прылады і тэрмін захавання падзей

*Showboat demo for issue #288 (G09.03 — `DELETE /v1/device` + retention-job), created 2026-10-03.*

Сцэнар на рэальным прадакшн-кодзе. Кліенцкі бок (`services/device.ts` над
`services/db/db.ts`): паспяховы `204` сцірае ў адной транзакцыі чаргу падзей,
feedback-плошчу (`21` §6 — старая чарга не аднаўляе серверныя ацэнкі), стан
згоды і device-радок, а сакрэт чысціцца апошнім; загрузкі (zone A) і чужыя
настройкі застаюцца. Збой сервера (`500`) не сцірае нічога — паўтор бяспечны,
бо сервернае выдаленне ідэмпатэнтнае.
(`export LD_LIBRARY_PATH` — хоставае патрабаванне node, не частка змены.)

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
rm -rf /tmp/kudy-g0903-demo
mkdir -p /tmp/kudy-g0903-demo
node --experimental-strip-types --input-type=module -e '
import { pathToFileURL } from "node:url";
const dbmod = await import(pathToFileURL("services/db/db.ts"));
const { openDatabase, setDeviceId, upsertBundleAsset } = dbmod;
const { nodeSqliteFileDriver } = await import(pathToFileURL("services/db/test-fixture.ts"));
const { setAnalyticsConsent, getAnalyticsConsent } = await import(pathToFileURL("services/analytics.ts"));
const { emitEvent } = await import(pathToFileURL("services/eventLog.ts"));
const { deleteDeviceAccount } = await import(pathToFileURL("services/device.ts"));

const store = nodeSqliteFileDriver("/tmp/kudy-g0903-demo/state.db");
const driver = store.driver;
openDatabase(driver);

const count = (table) => Number(driver.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
const state = (label) =>
  console.log(`${label}: device=${count("device")} queue=${count("event_queue")} feedback=${count("feedback_local")}+${count("feedback_outbox")} bundles=${count("bundle_asset")} consent=${String(getAnalyticsConsent(driver))}`);

const store2 = {
  secret: "synthetic-device-secret-fixture",
  saved: null,
  async getSecret() { return this.secret; },
  async saveSecret(value) { this.saved = value; },
  async clearSecret() { this.secret = null; },
};

function seed() {
  setDeviceId(driver, "3f2a1c9e-8b7d-4c2a-9d1e-6f5a4b3c2d1e");
  store2.secret = "synthetic-device-secret-fixture";
  setAnalyticsConsent(driver, "granted");
  emitEvent(driver, { eventId: "11111111-1111-4111-8111-111111111111", type: "app_open", at: 1, schemaVersion: 1, payload: "{}" });
  driver.prepare("INSERT INTO feedback_local (target, revision, score, state) VALUES (?, 2, 4, ?)").run("guide:gda-1:1:be", "sent");
  driver.prepare("INSERT INTO feedback_outbox (mutation_id, target, expected_revision, payload, disclosure_version, created_at, transport_state) VALUES (?, ?, 2, ?, ?, 1700000000000, ?)").run("mut-1", "guide:gda-1:1:be", "{}", "1", "pending");
  upsertBundleAsset(driver, { routeId: "gda-1", version: "1", locale: "be", tier: "base", path: "audio/01.mp3", status: "complete", bytesTotal: 10, bytesDone: 10, sha256: "fixture" });
  driver.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run("unrelated_setting", "keep");
}

seed();
await deleteDeviceAccount({
  driver,
  secretStore: store2,
  baseUrl: "https://example.functions.supabase.co/functions/v1",
  transport: { deleteDevice: async () => ({ status: 204 }) },
});
state("after 204");
console.log("secret cleared:", store2.secret === null);

seed();
let failed = null;
try {
  await deleteDeviceAccount({
    driver,
    secretStore: store2,
    baseUrl: "https://example.functions.supabase.co/functions/v1",
    transport: { deleteDevice: async () => ({ status: 500 }) },
  });
} catch (error) { failed = error.rule; }
console.log("500 answered as:", failed);
state("after 500");
store.close();
' 2>/dev/null
rm -rf /tmp/kudy-g0903-demo
```

```output
after 204: device=0 queue=0 feedback=0+0 bundles=1 consent=null
secret cleared: true
500 answered as: server_error
after 500: device=1 queue=1 feedback=1+1 bundles=1 consent=granted
```

Серверны бок — прадакшн-ядро выдалення і рэнтыш-свуп (`device-core.ts`,
`retention-core.ts`) над рэальным in-process Postgres (PGlite з закамічанымі
міграцыямі): свуп трымае тэрмін `09` §10 (сырыя падзеі — 14 месяцаў, рубеж
строга старэйшы — выдаляецца, агрэгатаў тут яшчэ няма), мёртвыя вокны
лічыльнікаў старэйшыя за 24 гадзіны прыбирае, паўторны свуп нічога не
выдаляе; `DELETE /v1/device` з жывым сакрэтам — 204, каскады міграцый забіраюць
`event_log` і вокны прылады, паўторны `DELETE` са старым сакрэтам — 403
`device_auth_failed` (выдалены акаўнт не ўваскрашаецца), `POST` — 404.

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types --input-type=module -e '
import { pathToFileURL } from "node:url";
const { freshMigratedDatabase } = await import(pathToFileURL("supabase/functions/_shared/test-db.ts"));
const { registerDevice, DEVICE_INSERT_SQL, handleDeviceDeleteRequest, createSqlDeviceDeletePort } = await import(pathToFileURL("supabase/functions/_shared/device-core.ts"));
const { runRetentionSweep } = await import(pathToFileURL("supabase/functions/_shared/retention-core.ts"));

const db = await freshMigratedDatabase();
const runner = { query: (sql, params) => db.query(sql, params) };
const count = async (table) => Number((await db.query(`select count(*)::int as count from ${table}`)).rows[0].count);

const NOW = 1_759_276_800_000; // 2026-10-01T00:00:00Z
const registration = registerDevice();
await db.query(DEVICE_INSERT_SQL, [registration.deviceId, registration.secretHash]);
for (const [id, at] of [
  ["aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa1", Date.UTC(2024, 6, 15)],
  ["aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa2", Date.UTC(2024, 7, 1)],
  ["aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa3", Date.UTC(2025, 0, 1)],
]) {
  await db.query("insert into event_log (event_id, device_id, type, at, payload) values ($1, $2, $3, to_timestamp($4 / 1000.0), \x27{}\x27::jsonb)", [id, registration.deviceId, "app_open", at]);
}
await db.query("insert into device_registration_rate (ip_hash, window_start, attempts) values ($1, to_timestamp($2 / 1000.0), 3)", ["demo-ip-hash", NOW - 48 * 3600 * 1000]);
await db.query("insert into event_send_rate (device_id, window_start, attempts) values ($1, to_timestamp($2 / 1000.0), 2)", [registration.deviceId, NOW - 48 * 3600 * 1000]);

console.log("sweep-1:", JSON.stringify(await runRetentionSweep(runner, NOW)));
console.log("sweep-2:", JSON.stringify(await runRetentionSweep(runner, NOW)));
console.log("events left:", await count("event_log"), "(the cutoff keeps the boundary row)");

console.log("delete-1:", JSON.stringify(await handleDeviceDeleteRequest({ method: "DELETE", authorization: `Bearer ${registration.deviceSecret}` }, createSqlDeviceDeletePort(runner))));
console.log("tables after 204:", await count("devices"), await count("event_log"), await count("event_send_rate"));
console.log("delete-2:", JSON.stringify(await handleDeviceDeleteRequest({ method: "DELETE", authorization: `Bearer ${registration.deviceSecret}` }, createSqlDeviceDeletePort(runner))));
console.log("delete-wrong:", JSON.stringify(await handleDeviceDeleteRequest({ method: "DELETE", authorization: "Bearer someone-else" }, createSqlDeviceDeletePort(runner))));
console.log("delete-post:", JSON.stringify(await handleDeviceDeleteRequest({ method: "POST", authorization: `Bearer ${registration.deviceSecret}` }, createSqlDeviceDeletePort(runner))));
' 2>/dev/null
```

```output
sweep-1: {"eventsDeleted":1,"registrationRateWindowsDeleted":1,"sendRateWindowsDeleted":1}
sweep-2: {"eventsDeleted":0,"registrationRateWindowsDeleted":0,"sendRateWindowsDeleted":0}
events left: 2 (the cutoff keeps the boundary row)
delete-1: {"status":204}
tables after 204: 0 0 0
delete-2: {"status":403,"code":"device_auth_failed"}
delete-wrong: {"status":403,"code":"device_auth_failed"}
delete-post: {"status":404,"code":"not_found"}
```

Кліенцкі сцэнаар і сярверны сцэнарыі выкарыстоўваюць толькі сінтэтычныя
фікстуры (`example.functions.supabase.co`, выдуманыя UUID і сакрэт);
ніякіх рэальных даменаў, сакрэтаў або кантэнту.
