# G04.02.c — AccessReady capability channel, emission after commit, recovery on open

*2026-09-24T17:36:29Z by Showboat 0.6.1*
<!-- showboat-id: 03db9374-5a06-415c-a4ff-0f7386d9c728 -->

Executable proof for issue #191 (`services/download`). `services/download` is the only issuer of `AccessReady` (ADR G01.03 §3.5): the event is built inside the module from the activation commit's own facts — the layer key and the package's route.json on disk — and delivered through the typed `DownloadAccessPort` of `19` §3.2, once per identity per run. No surface accepts an event object, so an event built outside the module has no delivery path. Recovery on open derives readiness from the disk; zone B holds no ready column or flag. No secrets or paths are printed here.

One activation commit delivers exactly one event the module built itself; a forged event object is undeliverable (criteria 1, 2):

```sh
node --experimental-strip-types -e 'const { activate } = await import("./services/download/download.ts");
const { createAccessPort, emitAccessReady } = await import("./services/download/access.ts");
const { createNodeDownloadStore, nodeSha256 } = await import("./services/download/nodeDownloadStore.ts");
const { lockFrom } = await import("./services/download/test-fixture.ts");
const { openDatabase } = await import("./services/db/db.ts");
const { nodeSqliteDriver } = await import("./services/db/test-fixture.ts");
const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "g0402c-"));
fs.mkdirSync(path.join(root, "bundles/route-x/1"), { recursive: true });
fs.writeFileSync(path.join(root, "bundles/route-x/1/route.json"), JSON.stringify({
  route_id: "route-x", version: "1", access: "paid",
  stops: [
    { id: "stop-1", access_tier: "base" },
    { id: "stop-2", access_tier: "base" },
    { id: "stop-3", access_tier: "extended" },
  ],
}));
const utf8 = (t) => new TextEncoder().encode(t);
const sources = { "stops.json": utf8(`[{"story_id":"story-b","tier":"base"}]`), "audio/story-b.m4a": utf8("audio-bytes") };
const access = createAccessPort();
const events = [];
access.onAccessReady((event) => events.push(event));
const driver = nodeSqliteDriver();
openDatabase(driver);
const deps = { store: createNodeDownloadStore(root), fetch: async (p) => { const b = sources[p]; if (!b) throw new Error("no bytes"); return b; }, sha256: nodeSha256, driver, access };
const result = await activate({ routeId: "route-x", version: "1", locale: "be", tier: "base", lock: await lockFrom(sources) }, deps);
console.log("activation result    : " + result.status);
console.log("events delivered     : " + events.length);
console.log("the event            : " + JSON.stringify(events[0]));
const forged = { type: "AccessReady", routeId: "route-x", version: "9", locale: "be", tier: "extended", stopIds: ["stop-3"], issuer: "services/download" };
const foreign = { onAccessReady: () => console.log("FORGED DELIVERY — must never print") };
console.log("forged event attempt : " + JSON.stringify(await emitAccessReady(foreign, { routeId: "route-x", version: "1", locale: "be", tier: "base" }, async () => null)));
console.log("events after forging : " + events.length);
' 2>/dev/null
```

```output
activation result    : complete
events delivered     : 1
the event            : {"type":"AccessReady","routeId":"route-x","version":"1","locale":"be","tier":"base","stopIds":["stop-1","stop-2"],"issuer":"services/download"}
forged event attempt : ["access#no-channel"]
events after forging : 1
```

Repeating the same identity adds no second emission; a restart derives readiness from the disk — the recovery itself delivers nothing (criterion 3, criterion 4):

```sh
node --experimental-strip-types -e 'const { activate, recoverOnOpen } = await import("./services/download/download.ts");
const { createAccessPort } = await import("./services/download/access.ts");
const { createNodeDownloadStore, nodeSha256 } = await import("./services/download/nodeDownloadStore.ts");
const { lockFrom } = await import("./services/download/test-fixture.ts");
const { openDatabase } = await import("./services/db/db.ts");
const { nodeSqliteDriver } = await import("./services/db/test-fixture.ts");
const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "g0402c-"));
fs.mkdirSync(path.join(root, "bundles/route-x/1"), { recursive: true });
fs.writeFileSync(path.join(root, "bundles/route-x/1/route.json"), JSON.stringify({ route_id: "route-x", version: "1", stops: [{ id: "stop-1", access_tier: "base" }] }));
const utf8 = (t) => new TextEncoder().encode(t);
const sources = { "stops.json": utf8(`[{"story_id":"story-b","tier":"base"}]`), "audio/story-b.m4a": utf8("audio-bytes") };
const lock = await lockFrom(sources);
const driver = nodeSqliteDriver();
openDatabase(driver);
const run = () => {
  const access = createAccessPort();
  const events = [];
  access.onAccessReady((event) => events.push(event));
  const deps = { store: createNodeDownloadStore(root), fetch: async (p) => { const b = sources[p]; if (!b) throw new Error("no bytes"); return b; }, sha256: nodeSha256, driver, access };
  return { deps, events };
};
const first = run();
const initial = await activate({ routeId: "route-x", version: "1", locale: "be", tier: "base", lock }, first.deps);
const repeated = await activate({ routeId: "route-x", version: "1", locale: "be", tier: "base", lock }, first.deps);
console.log("activations                : " + initial.status + ", then " + repeated.status + " with " + repeated.fetched + " fetches");
console.log("events after the repeat    : " + first.events.length);
const restarted = run();
const healed = await recoverOnOpen({ routeId: "route-x", version: "1", locale: "be", tier: "base", lock }, restarted.deps);
console.log("recovery derives from disk : " + healed.status);
console.log("events from the recovery   : " + restarted.events.length);
const reconfirmed = await activate({ routeId: "route-x", version: "1", locale: "be", tier: "base", lock }, restarted.deps);
console.log("next activation in the run : " + reconfirmed.status + ", events " + restarted.events.length);
' 2>/dev/null
```

```output
activations                : complete, then complete with 0 fetches
events after the repeat    : 1
recovery derives from disk : ready
events from the recovery   : 0
next activation in the run : complete, events 1
```

A crash before the commit emits nothing — an emission moved before the rename fires here and the crash test fails; zone B carries no ready column; a download after End leaves the session row identical (criteria 4, 5):

```sh
node --experimental-strip-types -e 'const { activate, recoverOnOpen, layerPath } = await import("./services/download/download.ts");
const { createAccessPort } = await import("./services/download/access.ts");
const { createNodeDownloadStore, nodeSha256 } = await import("./services/download/nodeDownloadStore.ts");
const { lockFrom } = await import("./services/download/test-fixture.ts");
const { openDatabase, startSession, finishSession, getSession } = await import("./services/db/db.ts");
const { ZONE_B_DDL } = await import("./services/db/schema.ts");
const { nodeSqliteDriver } = await import("./services/db/test-fixture.ts");
const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "g0402c-"));
fs.mkdirSync(path.join(root, "bundles/route-x/1"), { recursive: true });
fs.writeFileSync(path.join(root, "bundles/route-x/1/route.json"), JSON.stringify({ route_id: "route-x", version: "1", stops: [{ id: "stop-1", access_tier: "base" }] }));
const utf8 = (t) => new TextEncoder().encode(t);
const sources = { "stops.json": utf8(`[{"story_id":"story-b","tier":"base"}]`), "audio/story-b.m4a": utf8("audio-bytes") };
const lock = await lockFrom(sources);
const key = { routeId: "route-x", version: "1", locale: "be", tier: "base" };
const access = createAccessPort();
const events = [];
access.onAccessReady((event) => events.push(event));
const store = createNodeDownloadStore(root);
const driver = nodeSqliteDriver();
openDatabase(driver);
const deps = { store, fetch: async (p) => { const b = sources[p]; if (!b) throw new Error("no bytes"); return b; }, sha256: nodeSha256, driver, access };
const crashing = { ...store, rename: async (from, to) => { if (to === layerPath(key)) throw new Error("injected crash"); return store.rename(from, to); } };
try { await activate({ ...key, lock }, { ...deps, store: crashing }); } catch (error) { console.log("crash at the final rename : " + error.message); }
console.log("events after the crash    : " + events.length);
console.log("recovery derives          : " + (await recoverOnOpen({ ...key, lock }, { store, sha256: nodeSha256, driver })).status);
const probe = nodeSqliteDriver();
openDatabase(probe);
const readyColumns = Object.keys(ZONE_B_DDL).flatMap((table) => probe.prepare(`PRAGMA table_info(` + table + `)`).all().map((row) => String(row.name))).filter((name) => /ready/i.test(name));
console.log("zone B ready columns      : " + readyColumns.length);
startSession(probe, { sessionId: "sess-1", routeId: "route-x", version: "1", locale: "be", startedAt: 100 });
finishSession(probe, "sess-1", { finishedAt: 200 });
const before = JSON.stringify(getSession(probe, "sess-1"));
const retryEvents = [];
const retryPort = createAccessPort();
retryPort.onAccessReady((event) => retryEvents.push(event));
const retry = await activate({ ...key, lock }, { store, fetch: deps.fetch, sha256: nodeSha256, driver: probe, access: retryPort });
console.log("retry after recovery      : " + retry.status + ", events " + retryEvents.length);
console.log("session row after End     : " + (JSON.stringify(getSession(probe, "sess-1")) === before ? "identical" : "MUTATED"));
' 2>/dev/null
```

```output
crash at the final rename : injected crash
events after the crash    : 0
recovery derives          : not-ready
zone B ready columns      : 0
retry after recovery      : complete, events 1
session row after End     : identical
```
