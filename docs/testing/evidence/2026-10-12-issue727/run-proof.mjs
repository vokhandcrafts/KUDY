// #727 — the device-run driver: the free flow reaches a live walk through the
// production UI on the booted AVD. Criterion 1: after a completed download the
// preview's Start gate is the real evaluate verdict — the btn-start node is
// enabled and no button-reason renders; tapping it opens screen-Run. Criterion
// 2: the run deep link kudy:///run/e2e-free-guide opens the live run surface
// with no run-unavailable reason (the run-map#route-json-missing family).
// Criterion 3 is asserted origin-side before any UI step: the served layer
// lock pins every document the run reads. Zero dependencies; waits poll fresh
// dumps with timeouts, never fixed sleeps; a missing precondition or a
// diagnostic on screen fails with a reason and never reports a pass. Raw dumps
// stay in runtime/ (raw bytes, gitignored); the emitted machine JSON
// re-encodes every non-ASCII codepoint (gitguard). Reproduction:
//   node docs/testing/evidence/2026-10-12-issue727/run-proof.mjs
// Prerequisites per docs/development_setup.md and the issue: booted AVD
// (emulator-5554), by.kudy.app installed, Metro on :8081 with
// EXPO_PUBLIC_CATALOG_ORIGIN=http://10.0.2.2:8791, the e2e origin served on
// :8791 (npm run e2e:origin) built by the #727 packager.
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  adb,
  ADB,
  assertPreconditions,
  deviceProps,
  driverPaths,
  ensureRuntimeDir,
  escapeNonAscii,
  fail,
  PACKAGE,
  PORT,
  SERIAL,
} from "../device-run-lib.mjs";
import { E2eDriver, findNode, parseDump } from "../../../../tools/e2e-android/driver.mjs";

const { here: HERE, runtime: RUNTIME } = driverPaths(import.meta.url);
const ORIGIN_PORT = Number(process.env.KUDY_E2E_ORIGIN_PORT ?? 8791);
const ROUTE_ID = "e2e-free-guide";
const RUN_DEEP_LINK = `kudy:///run/${ROUTE_ID}`;
// The dev-client deep link of the G23.03 harness idiom: it opens the project
// bundle served by Metro directly, past the launcher's server list.
const DEV_CLIENT_URL = `kudy://expo-development-client/?url=${encodeURIComponent(`http://localhost:${PORT}`)}`;
const COLD_START_TIMEOUT_MS = 300000; // the first Metro bundle build can take minutes
const STEP_TIMEOUT_MS = 60000;
const POLL_MS = 500;

assertPreconditions();
ensureRuntimeDir(RUNTIME);

const driver = new E2eDriver({ adbPath: ADB, serial: SERIAL, artifactsDir: RUNTIME, pkg: PACKAGE });

// ---- origin facts (criterion 3, device view; rule 9: the state as output) ----
const originCatalog = await (await fetch(`http://localhost:${ORIGIN_PORT}/catalog.json`)).json();
const catalogEntry = (originCatalog.routes ?? originCatalog).find?.((r) => r.route_id === ROUTE_ID);
if (!catalogEntry) fail(`the origin catalog lists no ${ROUTE_ID} entry`);
const lockUrl = `http://localhost:${ORIGIN_PORT}/bundle/${ROUTE_ID}/1/be/base/lock.json`;
const originLock = await (await fetch(lockUrl)).json();
const pinned = new Set(originLock.map((entry) => entry.path));
const RUN_DOCS = ["route.json", "places.json", "voices.json"];
const missingPins = RUN_DOCS.filter((doc) => !pinned.has(doc));
if (missingPins.length > 0) fail(`the served base lock does not pin the run documents: ${missingPins.join(", ")}`);

// ---- device facts ----
const props = deviceProps();

// ---- fresh device state: the completed download must be this run's own ----
adb("shell", "pm", "clear", PACKAGE);
// pm clear resets runtime grants; the walk needs location without a system
// dialog riding over the app tree.
for (const permission of ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"]) {
  execFileSync(ADB, ["-s", SERIAL, "shell", "pm", "grant", PACKAGE, permission], { encoding: "utf8" });
}
execFileSync(ADB, ["-s", SERIAL, "shell", "cmd", "location", "set-location-enabled", "true"], { encoding: "utf8" });
adb("reverse", `tcp:${PORT}`, `tcp:${PORT}`);

// The dev client's one-time onboarding sheet hides the app tree; the G23.03
// idiom presses Back while its "Continue" caption is up.
async function coldStart(caseSlug) {
  await driver.forceStop(PACKAGE);
  await driver.launchDeepLink(DEV_CLIENT_URL);
  const startedAt = Date.now();
  for (;;) {
    let dump;
    try {
      dump = await driver.dump(`dump-${caseSlug}.xml`);
    } catch {
      // Transient host pressure (adb SIGKILL) or a busy UI: the poll loop's
      // timeout is the real budget.
      await sleep(RETRY_SPACING_MS);
      if (Date.now() - startedAt >= COLD_START_TIMEOUT_MS) fail(`cold start ${caseSlug} exhausted its budget on dump failures`);
      continue;
    }
    const nodes = parseDump(dump.xml);
    if (findNode(nodes, { testID: "screen-Explore" })) return;
    if (findNode(nodes, { text: "Continue" })) await driver.back();
    if (Date.now() - startedAt >= COLD_START_TIMEOUT_MS) {
      fail(`cold start did not reach screen-Explore within ${COLD_START_TIMEOUT_MS} ms; dump: ${dump.localPath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

// The enabled attribute of a testID node, read from the dump file waitFor
// just wrote — parseDump does not carry it and the Start gate is exactly this
// bit. waitFor returns the matched node, so every read of the raw hierarchy
// goes through the dump file its dumpBasename landed at.
function parseDumpFile(basename) {
  return parseDump(readFileSync(driver.artifactPath(basename), "utf8"));
}

function enabledOf(basename, testID) {
  const match = new RegExp(`<node[^>]*resource-id="${testID}"[^>]*>`, "m").exec(
    readFileSync(driver.artifactPath(basename), "utf8"),
  );
  if (match === null) return null;
  return /enabled="true"/.test(match[0]);
}

// A shared host under memory pressure kills adb clients with SIGKILL mid-dump;
// the spike passes in seconds. The dump-dependent reads retry with spacing —
// only an exhausted retry budget fails. Taps never retry (a second tap could
// double-start a walk or a download).
const RETRIES = 3;
const RETRY_SPACING_MS = 8000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRetry(selector, opts) {
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      return await driver.waitFor(selector, opts);
    } catch (error) {
      lastError = error;
      if (!/137|dump failed|uiautomator/.test(String(error.message))) throw error;
      await sleep(RETRY_SPACING_MS);
    }
  }
  throw lastError;
}

async function screenshotRetry(basename) {
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      return await driver.screenshot(basename);
    } catch (error) {
      lastError = error;
      await sleep(RETRY_SPACING_MS);
    }
  }
  throw lastError;
}

async function openPreviewAndDownload() {
  const card = await waitForRetry(
    { testID: `guide-card-${ROUTE_ID}` },
    { timeoutMs: STEP_TIMEOUT_MS, dumpBasename: "dump-guide-card.xml" },
  );
  await driver.tapNode(card);
  const downloadButton = await waitForRetry(
    { testID: "btn-download" },
    { timeoutMs: STEP_TIMEOUT_MS, dumpBasename: "dump-download.xml" },
  );
  await driver.tapNode(downloadButton);
}

// ---- phase 1 (criterion 1): download, then the Start gate is a real verdict ----
await coldStart("phase1-explore");
await openPreviewAndDownload();
await waitForRetry({ testID: "btn-start" }, { timeoutMs: STEP_TIMEOUT_MS, dumpBasename: "dump-start.xml" });
const startEnabled = enabledOf("dump-start.xml", "btn-start");
if (startEnabled !== true) {
  fail(`btn-start is not enabled after the completed download (enabled=${String(startEnabled)}); the #727 gate failed`);
}
if (findNode(parseDumpFile("dump-start.xml"), { testID: "button-reason" })) {
  fail("button-reason renders next to the enabled Start — the preview contradicts the run surface");
}
copyFileSync(driver.artifactPath("dump-start.xml"), join(RUNTIME, "start-enabled.xml"));
copyFileSync(await screenshotRetry("start-enabled.png"), join(HERE, "start-enabled.png"));
await driver.tapSelector({ testID: "btn-start" }, { timeoutMs: STEP_TIMEOUT_MS, dumpBasename: "dump-run.xml" });
// The run reads its map facts asynchronously — screen-Run may flash
// run-unavailable while the read is in flight. The walk is open only when the
// ready surface holds: screen-Run present AND run-unavailable gone.
// The device's own overlays (Google Play Services' location consent nagger,
// the permission controller's settings page) can take the focused window at
// any location request. Decline/answer them — the same decision a human
// makes; no walk semantics touched.
async function dismissOverlay(basename) {
  await driver.dump(basename);
  const nodes = parseDumpFile(basename);
  const gmsConsent = findNode(nodes, { text: "No thanks" });
  if (gmsConsent) {
    await driver.tapNode(gmsConsent);
    await sleep(1200);
    return true;
  }
  const foregroundAllow = findNode(nodes, { text: "Allow only while using the app" });
  if (foregroundAllow) {
    await driver.tapNode(foregroundAllow);
    await sleep(1200);
    await driver.back();
    await sleep(1200);
    return true;
  }
  return false;
}

async function runSurfaceOpen(basename, what) {
  const startedAt = Date.now();
  for (;;) {
    await driver.dump(basename);
    const nodes = parseDumpFile(basename);
    if (findNode(nodes, { testID: "screen-Run" }) && !findNode(nodes, { testID: "run-unavailable" })) return;
    if (await dismissOverlay(basename)) continue;
    const reason = findNode(nodes, { testID: "run-unavailable-reason" });
    if (Date.now() - startedAt >= STEP_TIMEOUT_MS) {
      fail(`${what}: the run surface did not open (screen-Run without run-unavailable)${reason ? ` — stuck at ${reason.text}` : ""}`);
    }
    await sleep(1000);
  }
}

// Tap a button that device overlays may keep off the focused window: dismiss
// overlays until the testID is visible, then tap exactly once.
async function tapWhenVisible(testID, what) {
  const startedAt = Date.now();
  for (;;) {
    await driver.dump(`dump-${testID}.xml`);
    if (findNode(parseDumpFile(`dump-${testID}.xml`), { testID })) break;
    const dismissed = await dismissOverlay(`dump-${testID}.xml`);
    if (Date.now() - startedAt >= STEP_TIMEOUT_MS) fail(`${what}: ${testID} never became visible`);
    if (!dismissed) await sleep(1000);
  }
  await driver.tapSelector({ testID }, { timeoutMs: STEP_TIMEOUT_MS, dumpBasename: `dump-${testID}-tap.xml` });
}

await runSurfaceOpen("dump-run-active.xml", "the Start tap");
copyFileSync(await screenshotRetry("walk-active.png"), join(HERE, "walk-active.png"));
// End the walk through the UI: a live session would resume straight into
// screen-Run on the phase-2 cold start and the deep link would ride the
// recovery path instead of proving the deep-link path.
await tapWhenVisible("btn-run-end", "the walk's finish");
await tapWhenVisible("btn-end-confirm-accept", "the finish confirmation");

// ---- phase 2 (criterion 2): the run deep link from a cold JS context ----
await coldStart("phase2-explore");
await driver.launchDeepLink(RUN_DEEP_LINK);
await runSurfaceOpen("dump-deeplink-run.xml", "the run deep link");
copyFileSync(await screenshotRetry("deeplink-run.png"), join(HERE, "deeplink-run.png"));

// ---- machine JSON (non-ASCII re-encoded; raw bytes stay in runtime/) ----
const result = {
  run: {
    task: "issue #727",
    driver: "run-proof.mjs",
    device: { serial: SERIAL, ...props },
    metro: `http://localhost:${PORT}/status=packager-status:running`,
    origin: `http://10.0.2.2:${ORIGIN_PORT} (catalog routes: ${(originCatalog.routes ?? originCatalog).length ?? 1})`,
    runDeepLink: RUN_DEEP_LINK,
    freshState: "pm clear before phase 1; location grants re-applied",
  },
  criterion3_originLock: {
    lockUrl,
    pinnedPaths: originLock.map((entry) => entry.path),
    runDocumentsPinned: RUN_DOCS,
  },
  criteria: {
    1: "btn-start enabled=true with no button-reason after the completed download; the tap opened screen-Run without run-unavailable",
    2: "kudy:///run/e2e-free-guide opened screen-Run with no run-unavailable reason",
  },
  artifacts: ["start-enabled.png", "walk-active.png", "deeplink-run.png"],
};
const out = join(HERE, "raw-run.json");
writeFileSync(
  out,
  JSON.stringify(result, null, 2).replace(/[^\x00-\x7F]/g, (c) => `\\u${c.codePointAt(0).toString(16).padStart(4, "0")}`) +
    "\n",
);
console.log(`OK #727: the free flow reached a live walk -> ${out}`);
console.log(`  origin lock pins: ${[...pinned].join(", ")}`);
console.log(`  artifacts: ${result.artifacts.join(", ")}`);
