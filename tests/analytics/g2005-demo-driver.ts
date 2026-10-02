// G20.05 demo driver — runs from the repo root; prints the audit A26-05
// scenario facts over the real services/analytics + services/eventLog
// modules: 257 queued events, the withdrawal landing while the first batch
// (256) is in flight, then the restore resuming the tail without duplicates.
import { pathToFileURL } from "node:url";
const load = (rel: string) => import(pathToFileURL(rel).href);

const { openDatabase, listPendingEvents } = await load("services/db/db.ts");
const { nodeSqliteDriver } = await load("services/db/test-fixture.ts");
const { emitEvent } = await load("services/eventLog.ts");
const { flushAnalytics, setAnalyticsConsent } = await load("services/analytics.ts");

const driver: unknown = nodeSqliteDriver();
openDatabase(driver);
setAnalyticsConsent(driver, "granted");
for (let i = 0; i < 257; i += 1) {
  emitEvent(driver, {
    eventId: `55555555-5555-4555-8555-${String(i).padStart(12, "0")}`,
    type: "app_open",
    at: 1_700_000_000_000 + i,
    schemaVersion: 1,
    payload: "{}",
  });
}

let senderCalls = 0;
let firstBatchSize = 0;
const marked = await flushAnalytics(driver, (batch: Array<{ event_id: string }>) => {
  senderCalls += 1;
  firstBatchSize = batch.length;
  setAnalyticsConsent(driver, "revoked");
  return Promise.resolve();
});
const tail = (listPendingEvents(driver) as Array<{ eventId: string }>).map((row) => row.eventId);
console.log("G20.05", JSON.stringify({ queued: 257, firstBatchSize, senderCalls, marked, pendingTail: tail }));

setAnalyticsConsent(driver, "granted");
const sentIds: string[] = [];
const resumed = await flushAnalytics(driver, (batch: Array<{ event_id: string }>) => {
  sentIds.push(...batch.map((event) => event.event_id));
  return Promise.resolve();
});
const pendingAfterResume = (listPendingEvents(driver) as Array<{ eventId: string }>).length;
console.log("G20.05-resume", JSON.stringify({ marked: resumed, sentIds, pendingAfterResume }));
