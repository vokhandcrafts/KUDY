# G09.05 — crash-згода, скрабінг звіта і бяспечны remote config

*Showboat demo for issue #295 (G09.05 — crash reporting + remote config), created 2026-10-01.*

Сцэнар на рэальным прадакшн-кодзе. Першая частка — `services/crash.ts`:
сыравы тэкст збою нясе сінтэтычны сакрэт, назву кропкі і каардынаты, але
звіт — закрытая форма (crash_id, at, schema_version, kind, fingerprint = хэш
нармалізаванага паведамлення), ніводзін падрадок сыравіны ў ім не з'яўляецца.
Згода на crash — асобнае рашэнне: `analytics_consent: granted` не адчыняе
гейт (адпраўка «skipped»), і толькі ўласны grant пускае звіт у sink.
Другая частка — `services/remote-config.ts` + кантракт
`contracts/config/remote-config.mjs`: крывы сеткавы дакумент (unlock-поле +
нямалы dwell) адхіляецца з named-дыягностыкамі і ніколі не перазапісвае кэш;
прыняты дакумент кэшуецца; офлайн — кэш дорыць апошні прыняты дакумент.
(`export LD_LIBRARY_PATH` — хоставае патрабаванне node, не частка змены.)

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
rm -rf /tmp/kudy-g0905-demo
mkdir -p /tmp/kudy-g0905-demo
node --experimental-strip-types --input-type=module -e '
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const { openDatabase } = await import(pathToFileURL("services/db/db.ts"));
const { nodeSqliteFileDriver } = await import(pathToFileURL("services/db/test-fixture.ts"));
const { checkRemoteConfig, loadDefaultRemoteConfig } = await import(pathToFileURL("contracts/config/remote-config.mjs"));
const { buildCrashReport, getCrashConsent, setCrashConsent, submitCrashReport } = await import(pathToFileURL("services/crash.ts"));
const { setAnalyticsConsent } = await import(pathToFileURL("services/analytics.ts"));
const { readRemoteConfig, refreshRemoteConfig } = await import(pathToFileURL("services/remote-config.ts"));
const sha256 = (t) => createHash("sha256").update(t).digest("hex");
const store = nodeSqliteFileDriver("/tmp/kudy-g0905-demo/zone-b.db");
openDatabase(store.driver);
let n = 0;
const deps = { makeId: () => `crash-${String(++n)}`, fingerprint: sha256, now: () => 1759324800000 };
const sink = (report) => { console.log("SINK", JSON.stringify(report)); return Promise.resolve(); };
const raw = "TypeError: boom\ndevice_secret_9f2c4be7a1d0483f\nВежа: 55.1846 30.2046";
setAnalyticsConsent(store.driver, "granted");
console.log("crash consent while analytics granted:", getCrashConsent(store.driver));
console.log("submit-1:", await submitCrashReport(store.driver, buildCrashReport({ kind: "js_error", message: raw }, deps), sink));
setCrashConsent(store.driver, "granted");
console.log("submit-2:", await submitCrashReport(store.driver, buildCrashReport({ kind: "js_error", message: raw }, deps), sink));
setCrashConsent(store.driver, "revoked");
console.log("submit-3:", await submitCrashReport(store.driver, buildCrashReport({ kind: "js_error", message: raw }, deps), sink));
const defaults = loadDefaultRemoteConfig();
let responses = [];
const transport = { getConfig: async () => responses.shift() };
const cfg = () => readRemoteConfig({ driver: store.driver, check: checkRemoteConfig, defaults });
const refresh = () => refreshRemoteConfig({ baseUrl: "https://example.invalid/functions/v1", driver: store.driver, check: checkRemoteConfig, defaults, transport });
console.log("read-1:", cfg().source, JSON.stringify(cfg().config));
responses = [{ status: 200, body: { ...defaults, unlock_extended: true, dwell_ms: 999999 } }];
const bad = await refresh();
console.log("bad source:", bad.source, "| rules:", bad.diagnostics.map((d) => d.rule).join(","));
responses = [{ status: 200, body: { ...defaults, dwell_ms: 7000 } }];
const ok = await refresh();
console.log("ok source:", ok.source, "dwell_ms:", ok.config.dwell_ms);
responses = [{ failure: "offline" }];
const off = await refresh();
console.log("offline source:", off.source, "dwell_ms:", off.config.dwell_ms);
store.close();
' 2>/dev/null
rm -rf /tmp/kudy-g0905-demo
```

```output
crash consent while analytics granted: null
submit-1: skipped
SINK {"crash_id":"crash-2","at":"2025-10-01T13:20:00.000Z","schema_version":1,"kind":"js_error","fingerprint":"a917031f44c4194e1efe7c06be267253453a482dbcbb23d856153774511d0925"}
submit-2: sent
submit-3: skipped
read-1: defaults {"config_schema_version":1,"trigger_radius_default":40,"dwell_ms":6000,"accuracy_gate_m":40,"moment_cooldown_min":10,"moments_per_session_max":2,"min_app_version":1}
bad source: defaults | rules: config-value-above-maximum,config-unknown-field
ok source: network dwell_ms: 7000
offline source: cache dwell_ms: 7000
```

У звіце — толькі закрытыя палі: хэш пакідае дэдуплікацыю, але не змест
(«SINK»-радок); «skipped» пазнака — не цішая страта, выклікач ведае, што
звіт не пайшоў. Крывы дакумент канфігурацыі адхілены, кэш застаўся з
папярэднім прынятым (`ok → network`), а офлайн-чытанне вернула кэш, не
кінуўшы выключэнне.
