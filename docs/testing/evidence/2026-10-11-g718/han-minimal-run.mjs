// Issue #718 (G21.47 follow-up) — the device-run driver: one pass of the
// dev-gated Han reproduction surfaces (app/han-probe-minimal.tsx, the minimal
// uncapped-Text case, or app/han-probe.tsx, the recorded G21.47 surface) on
// the booted AVD, at one system font_scale. Windows adaptation of the G21.47
// driver (han-probe-run.mjs in the 2026-10-11-g2147 evidence): adb.exe path
// resolution, fetch for the Metro status, an Atomics sleep (no POSIX sleep
// binary), and a finally-restore of the device font_scale on every exit
// path, thrown or failed. Zero dependencies, the same waits-on-conditions
// idiom: a missing precondition fails with a reason and never reports a
// pass. Raw uiautomator dumps stay in the gitignored runtime/ (they carry
// raw CJK bytes); the emitted machine JSON re-encodes every non-ASCII
// codepoint. Reproduction:
//   node docs/testing/evidence/2026-10-11-g718/han-minimal-run.mjs --scale 2.0 --surface minimal
//   node docs/testing/evidence/2026-10-11-g718/han-minimal-run.mjs --scale 2.0 --surface probe
//   (scale 1.0 baselines the same surfaces)
// Prerequisites: booted AVD on :5554, by.kudy.app installed, Metro on :8081
// serving THIS checkout (npm start).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(HERE, "runtime");
const SERIAL = "emulator-5554";
const PORT = Number(process.env.KUDY_METRO_PORT ?? 8081);
const PACKAGE = "by.kudy.app";
const WAIT_MS = 120000;
const POLL_MS = 2500;

const SURFACES = {
  minimal: { link: "kudy://han-probe-minimal", caption: "raw Text, ui family, uncapped — the minimal case" },
  probe: { link: "kudy://han-probe", caption: "card hans / ui 400 / scaled" },
};

const ADB = process.env.KUDY_ADB
  ?? (process.env.ANDROID_HOME
    ? join(process.env.ANDROID_HOME, "platform-tools", "adb.exe")
    : null);
if (!ADB) fail("set ANDROID_HOME (or KUDY_ADB) to the Android SDK path");

const argScale = (() => {
  const i = process.argv.indexOf("--scale");
  if (i === -1) fail("usage: han-minimal-run.mjs --scale <1.0|2.0> --surface <minimal|probe>");
  const v = Number(process.argv[i + 1]);
  if (!(v > 0)) fail(`--scale must be a positive number, got ${process.argv[i + 1]}`);
  return v;
})();
const argSurface = (() => {
  const i = process.argv.indexOf("--surface");
  const s = i === -1 ? "minimal" : process.argv[i + 1];
  if (!SURFACES[s]) fail(`--surface must be one of ${Object.keys(SURFACES).join("|")}, got ${s}`);
  return s;
})();
const { link: DEEP_LINK, caption: PROBE_CAPTION } = SURFACES[argSurface];

// A precondition failure throws: the run's finally block restores the device
// state before the process exits.
class Skip extends Error {}
function fail(reason) {
  console.error(`SKIP/BLOCKED: ${reason}`);
  throw new Skip(reason);
}

function adb(...args) {
  return execFileSync(ADB, ["-s", SERIAL, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ---- preconditions: adb, booted device, installed package, Metro up ----
// (none of these touch device state, so a plain exit is safe here)
try {
  execFileSync(ADB, ["devices"], { encoding: "utf8" });
} catch {
  console.error(`SKIP/BLOCKED: adb not available at ${ADB}`);
  process.exit(1);
}
const devices = execFileSync(ADB, ["devices"], { encoding: "utf8" });
if (!devices.split("\n").some((l) => l.startsWith(SERIAL) && l.includes("device"))) {
  console.error(`SKIP/BLOCKED: no booted ${SERIAL} in adb devices`);
  process.exit(1);
}
const packages = adb("shell", "pm", "list", "packages");
// adb shell output on Windows carries CRLF — a split("\n") line keeps "\r".
if (!packages.split("\n").map((l) => l.trim()).includes(`package:${PACKAGE}`)) {
  console.error(`SKIP/BLOCKED: ${PACKAGE} is not installed on ${SERIAL}`);
  process.exit(1);
}
let metro = "";
try {
  metro = await (await fetch(`http://localhost:${PORT}/status`, { signal: AbortSignal.timeout(5000) })).text();
} catch {}
if (metro.trim() !== "packager-status:running") {
  console.error(`SKIP/BLOCKED: Metro is not running on :${PORT} — start it first (expo start --dev-client --port ${PORT})`);
  process.exit(1);
}

mkdirSync(RUNTIME, { recursive: true });

let result;
let restoreTo = null; // the device font_scale as read, before the run touches it
try {
  result = await run();
} catch (e) {
  if (!(e instanceof Skip)) console.error(`ERROR: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  // The device leaves this run exactly as it entered it — on every path.
  if (restoreTo !== null) {
    try {
      adb("shell", "settings", "put", "system", "font_scale", restoreTo);
    } catch {}
  }
  if (result) emit(result);
}

async function run() {
  // ---- device facts (rule 9: the environment state as command output) ----
  const props = Object.fromEntries(
    ["ro.build.version.release", "ro.build.version.sdk", "ro.product.model", "ro.hardware"].map((p) => [
      p,
      adb("shell", "getprop", p).trim(),
    ]),
  );
  const fontScaleBefore = adb("shell", "settings", "get", "system", "font_scale").trim();
  restoreTo = fontScaleBefore;

  // ---- set scale, restart the app onto the surface ----
  adb("shell", "settings", "put", "system", "font_scale", String(argScale));
  adb("shell", "am", "force-stop", PACKAGE);
  adb("reverse", `tcp:${PORT}`, `tcp:${PORT}`);
  const launch = (link) => adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", link, PACKAGE);
  launch(DEEP_LINK);

  // One uiautomator pull, parsed by named groups; a stale or failed dump is
  // retried inside a 6-second window (time-bounded — the UI can be animating
  // for a variable stretch).
  function pullNodes() {
    const retryUntil = Date.now() + 6000;
    for (;;) {
      const out = adb("shell", "uiautomator", "dump", "/sdcard/kudy-minimal-dump.xml");
      if (/dumped to/i.test(out)) {
        const xml = adb("shell", "cat", "/sdcard/kudy-minimal-dump.xml");
        const nodes = [...xml.matchAll(/<node[^>]*?text="(?<text>[^"]*)"[^>]*?bounds="\[(?<x1>\d+),(?<y1>\d+)\]\[(?<x2>\d+),(?<y2>\d+)\]"/g)].map(
          (m) => ({ text: m.groups.text, bounds: [Number(m.groups.x1), Number(m.groups.y1), Number(m.groups.x2), Number(m.groups.y2)] }),
        );
        if (nodes.length > 0) return { nodes, xml };
      }
      if (Date.now() >= retryUntil) break;
      sleepSync(1000);
    }
    return { nodes: [], xml: null };
  }

  function waitFor(desc, condition) {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const { nodes } = pullNodes();
      if (condition(nodes)) return nodes;
      if (Date.now() >= deadline) fail(`did not reach ${desc} within ${WAIT_MS} ms`);
      sleepSync(POLL_MS);
    }
  }

  const tapCenter = ([x1, y1, x2, y2]) => adb("shell", "input", "tap", String((x1 + x2) >> 1), String((y1 + y2) >> 1));

  const launcher = waitFor("the dev client launcher with the Metro server entry", (n) =>
    n.some((x) => x.text === `http://10.0.2.2:${PORT}`));
  tapCenter(launcher.find((x) => x.text === `http://10.0.2.2:${PORT}`).bounds);
  waitFor("the app session to take over the screen", (n) => !n.some((x) => x.text === "DEVELOPMENT SERVERS"));
  launch(DEEP_LINK);
  waitFor(`the surface (${argSurface})`, (n) => n.some((x) => x.text === PROBE_CAPTION));

  // ---- scroll to the end: the probe surface's scaling rows sit at the bottom ----
  const sameBounds = (a, b) => JSON.stringify(a.map((n) => n.bounds)) === JSON.stringify(b.map((n) => n.bounds));
  let settled = pullNodes().nodes;
  for (let i = 0; i < 12; i++) {
    adb("shell", "input", "swipe", "540", "1900", "540", "300", "400");
    sleepSync(1500);
    const cur = pullNodes().nodes;
    if (sameBounds(cur, settled)) break;
    settled = cur;
  }
  adb("shell", "input", "swipe", "540", "1900", "540", "1400", "600");
  sleepSync(1500);
  settled = pullNodes().nodes;
  for (let i = 0; i < 10; i++) {
    sleepSync(1000);
    const cur = pullNodes().nodes;
    if (sameBounds(cur, settled)) break;
    settled = cur;
  }
  if (settled.length === 0) fail("the settled hierarchy is empty — uiautomator stopped producing fresh dumps");

  // ---- capture: screenshot + fresh dump ----
  const png = execFileSync(ADB, ["-s", SERIAL, "exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(HERE, `${argSurface}-scale${argScale}.png`), png);
  const finalPull = pullNodes();
  if (!finalPull.xml) fail("the final uiautomator dump failed after the retries");
  writeFileSync(join(RUNTIME, `dump-${argSurface}-scale${argScale}.xml`), finalPull.xml);

  // The Han text nodes (the probe strings), top-to-bottom. A probe string is
  // at least 30% non-ASCII characters — the Latin captions (with their em
  // dashes) never reach that ratio, the shortest CJK row is all non-ASCII.
  const hanNodes = settled
    .filter((n) => n.text && n.text.length >= 16)
    .filter((n) => [...n.text].filter((c) => c.charCodeAt(0) > 127).length / n.text.length >= 0.3)
    .sort((a, b) => a.bounds[1] - b.bounds[1]);
  const rows = hanNodes.map((n, i) => ({
    row: `han-node-${i}`,
    textLength: n.text.length,
    bounds: n.bounds,
    widthPx: n.bounds[2] - n.bounds[0],
    heightPx: n.bounds[3] - n.bounds[1],
  }));

  return {
    run: {
      task: "issue #718 (G21.47 follow-up)",
      driver: "han-minimal-run.mjs",
      surface: `${argSurface} (dev-only, __DEV__-gated)`,
      device: { serial: SERIAL, ...props, fontScaleBefore, fontScaleRun: argScale, fontScaleRestored: fontScaleBefore },
      metro: `http://localhost:${PORT}/status=packager-status:running`,
      probeDeepLink: DEEP_LINK,
    },
    rows,
    fontScaleBefore,
  };
}

// ---- machine JSON (non-ASCII re-encoded; raw bytes stay in runtime/) ----
function emit(result) {
  const out = join(HERE, `raw-${argSurface}-scale${argScale}.json`);
  writeFileSync(out, JSON.stringify(result, null, 2).replace(/[^\x00-\x7F]/g, (c) => `\\u${c.codePointAt(0).toString(16).padStart(4, "0")}`) + "\n");
  console.log(`OK scale=${argScale} surface=${argSurface}: ${argSurface}-scale${argScale}.png -> ${out}`);
  for (const r of result.rows) console.log(`  ${r.row}: len=${r.textLength} ${r.widthPx}x${r.heightPx} at ${JSON.stringify(r.bounds)}`);
}
