// G15.04 demo driver — runs from the repo root; prints the acceptance facts.
import { pathToFileURL } from "node:url";
const load = (rel) => import(pathToFileURL(rel));

const { syntheticIndex, publish, mutableLoader, syntheticFiles, memorySnapshot, bootedDiscovery, queueAnalyticsPort, sha256, POINTER_R1, POINTER_R2, REVISION_R1, REVISION_R2 } = await load("tests/discovery/fixture.ts");
const { offersById } = await load("controllers/useDiscoveryController.ts");
const { loadDiscoveryIndex } = await load("services/contentRepo/discoveryIndex.ts");
const { flushAnalytics, setAnalyticsConsent } = await load("services/analytics.ts");
const { eventFactory, openFreshEventStore } = await load("services/eventLog-test-fixture.ts");
const { getSession, startSession } = await load("services/db/db.ts");

const R1 = publish(syntheticIndex(REVISION_R1), POINTER_R1);
const R2 = publish(syntheticIndex(REVISION_R2), POINTER_R2);

// D01 + D03 + D05 + L01 over the real controller on the real reader.
const store = await bootedDiscovery({ loader: mutableLoader(syntheticFiles(R1)).loader });
let s = store.getState().surface;
const byId = offersById(s.index);
console.log("D01 revision:", s.revision, "exact:", s.result.exact.map((m) => m.offer_id).join(","));
store.getState().setTimeLimit(60);
s = store.getState().surface;
console.log("D03 exact@60:", s.result.exact.map((m) => m.offer_id).join(","));
console.log("D03 alts:", s.result.alternatives.map((m) => m.offer_id + ":" + m.differences.join("+")).join(","));
store.getState().setSeason("winter");
s = store.getState().surface;
console.log("D05 exact@winter:", s.result.exact.length, "guide90:", s.result.alternatives.find((m) => m.offer_id === "offer-g15-guide-90").differences.join(","));
const guide = byId.get("offer-g15-guide-90");
console.log("L01 text:", guide.availability.text_locales.join("/"), "audio:", guide.availability.audio_locales.join("/"));

// Task step 3: interrupted pointer and corrupt bytes roll back to r1.
const snapshot = memorySnapshot();
const box = mutableLoader(syntheticFiles(R1));
await loadDiscoveryIndex({ loader: box.loader, sha256, snapshot });
box.setFiles({ "catalog.json": R2.catalogJson });
const interrupted = await loadDiscoveryIndex({ loader: box.loader, sha256, snapshot });
console.log("interrupted:", interrupted.revision, "stale:", interrupted.stale, "reason:", interrupted.reason, "snapshot-identical:", Buffer.from(snapshot.bytes()).toString("utf8") === R1.indexJson);
const tampered = R2.indexJson.replace("Сукнаскі", "Сукняскі");
box.setFiles({ "catalog.json": R2.catalogJson, [POINTER_R2]: tampered });
const corrupt = await loadDiscoveryIndex({ loader: box.loader, sha256, snapshot });
console.log("corrupt:", corrupt.revision, "stale:", corrupt.stale, "reason:", corrupt.reason);

// Task step 4: local recording always, leaving the device only with consent.
const driver = openFreshEventStore();
const analyticsStore = await bootedDiscovery({
  loader: mutableLoader(syntheticFiles(R1)).loader,
  analytics: queueAnalyticsPort(driver, eventFactory("g15demoshown000")),
});
const ready = analyticsStore.getState().surface;
const shownGuide = offersById(ready.index).get("offer-g15-guide-90");
const shownPlace = offersById(ready.index).get("offer-g15-place-30");
analyticsStore.getState().recordShown([shownGuide, shownPlace], "discovery");
const batches = [];
const noopFlush = await flushAnalytics(driver, async (events) => void batches.push(events));
console.log("flush-no-consent marked:", noopFlush, "batches:", batches.length);
setAnalyticsConsent(driver, "granted");
const grantedFlush = await flushAnalytics(driver, async (events) => void batches.push(events));
console.log("flush-granted marked:", grantedFlush, "types:", batches[0].map((e) => e.type).join(","), "payload-keys:", Object.keys(batches[0][0].payload).sort().join(","));

// D07: discovery operations never touch the live session row.
startSession(driver, { sessionId: "s-g15-demo", routeId: "guide-route-g15", version: "1", locale: "be", startedAt: 1700000000000 });
const before = JSON.stringify(getSession(driver, "s-g15-demo"));
analyticsStore.getState().recordShown([shownGuide], "discovery");
analyticsStore.getState().beginPresentation("collection");
await analyticsStore.getState().refresh();
const after = JSON.stringify(getSession(driver, "s-g15-demo"));
console.log("D07 session untouched:", before === after, "locale:", getSession(driver, "s-g15-demo").locale);
