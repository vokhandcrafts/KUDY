// G21.47 (issue #671) — the device-run driver: one instrumented pass of the
// dev-gated Han probe surface (app/han-probe.tsx) on the booted AVD, at one
// system font_scale. Zero dependencies, the web e2e idiom (waits on
// conditions with timeouts, never fixed sleeps; a missing precondition skips
// with a reason and never reports a pass). Raw uiautomator dumps stay in the
// gitignored runtime/ (they carry raw CJK bytes); the emitted machine JSON
// re-encodes every non-ASCII codepoint, so the committed files stay clean
// (gitguard). Reproduction:
//   node docs/testing/evidence/2026-10-11-g2147/han-probe-run.mjs --scale 1.0
//   node docs/testing/evidence/2026-10-11-g2147/han-probe-run.mjs --scale 2.0
// Prerequisites per docs/development_setup.md: booted AVD (kudy-test),
// by.kudy.app installed, Metro on :8081 (`npm start`).
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(HERE, "runtime");
const ADB = join(process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`, "platform-tools", "adb");
const SERIAL = "emulator-5554";
const PACKAGE = "by.kudy.app";
const DEEP_LINK = "kudy://han-probe";
const PROBE_CAPTION = "card hans / ui 400 / scaled";
const WAIT_MS = 120000;
const POLL_MS = 2500;
const MAX_SCROLLS = 10;

const argScale = (() => {
  const i = process.argv.indexOf("--scale");
  if (i === -1) fail("usage: han-probe-run.mjs --scale <1.0|2.0> (font_scale is set and then restored)");
  const v = Number(process.argv[i + 1]);
  if (!(v > 0)) fail(`--scale must be a positive number, got ${process.argv[i + 1]}`);
  return v;
})();

function fail(reason) {
  console.error(`SKIP/BLOCKED: ${reason}`);
  process.exit(1);
}

function adb(...args) {
  return execFileSync(ADB, ["-s", SERIAL, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// Escape-encode anything outside ASCII so committed machine files carry no
// raw CJK bytes (the gitguard idiom of G21.40).
const escapeNonAscii = (s) => String(s).replace(/[^\x20-\x7E]/g, (c) => [...c].map((ch) => `\\u${ch.codePointAt(0).toString(16).padStart(4, "0")}`).join(""));

// ---- preconditions: adb, booted device, installed package, Metro up ----
try {
  execFileSync(ADB, ["devices"], { encoding: "utf8" });
} catch {
  fail("adb not available (ANDROID_HOME/platform-tools/adb)");
}
const devices = execFileSync(ADB, ["devices"], { encoding: "utf8" });
if (!devices.split("\n").some((l) => l.startsWith(SERIAL) && l.includes("device"))) {
  fail(`no booted ${SERIAL} in adb devices`);
}
const packages = adb("shell", "pm", "list", "packages");
if (!packages.split("\n").includes(`package:${PACKAGE}`)) {
  fail(`${PACKAGE} is not installed on ${SERIAL}`);
}
let metro = "";
try {
  metro = execFileSync("curl", ["-s", "--max-time", "5", "http://localhost:8081/status"], { encoding: "utf8" });
} catch {}
if (metro.trim() !== "packager-status:running") {
  fail("Metro is not running on :8081 — start it with `npm start` (expo start --dev-client) first");
}

mkdirSync(RUNTIME, { recursive: true });

// ---- device facts (rule 9: the environment state as command output) ----
const props = Object.fromEntries(
  ["ro.build.version.release", "ro.build.version.sdk", "ro.product.model", "ro.hardware"].map((p) => [
    p,
    adb("shell", "getprop", p).trim(),
  ]),
);
const fontScaleBefore = adb("shell", "settings", "get", "system", "font_scale").trim();
const cjkFonts = adb("shell", "ls", "/system/fonts")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => /CJK/i.test(l));
const fontsXml = adb("shell", "cat", "/system/etc/fonts.xml");
const cjkFamilies = [...fontsXml.matchAll(/<family[^>]*lang="([^"]*(?:zh|ja|ko)[^"]*)"[^>]*>([\s\S]*?)<\/family>/g)].map(
  (m) => ({
    lang: m[1],
    faces: [...m[2].matchAll(/<font[^>]*weight="(\d+)"[^>]*style="(\w+)"[^>]*>([^<]+)<\/font>/g)].map((f) => ({
      weight: Number(f[1]),
      style: f[2],
      file: f[3].trim(),
    })),
  }),
);

// ---- set scale, restart the app onto the probe ----
// The dev client intercepts a cold deep link: force-stop + VIEW lands on its
// launcher Home, not in the app. Reliable sequence: restart, tap the Metro
// server entry, wait for the app to take the screen, then deep link again.
adb("shell", "settings", "put", "system", "font_scale", String(argScale));
adb("shell", "am", "force-stop", PACKAGE);
adb("reverse", "tcp:8081", "tcp:8081");
adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", DEEP_LINK, PACKAGE);

function dumpNodes() {
  // uiautomator dump is flaky while the UI is animating — it can fail (and
  // leave the previous file behind) or return a stale frame. Retry until the
  // tool reports a fresh dump and the parse yields nodes.
  for (let attempt = 0; attempt < 6; attempt++) {
    const out = adb("shell", "uiautomator", "dump", "/sdcard/kudy-probe-dump.xml");
    if (/dumped to/i.test(out)) {
      const xml = adb("shell", "cat", "/sdcard/kudy-probe-dump.xml");
      const nodes = [...xml.matchAll(/<node[^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].map((m) => ({
        text: m[1],
        bounds: [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])],
      }));
      if (nodes.length > 0) return nodes;
    }
    execFileSync("sleep", ["1"]);
  }
  adb("shell", "settings", "put", "system", "font_scale", fontScaleBefore);
  fail("uiautomator dump did not produce a fresh hierarchy after 6 attempts");
}

function pollUntil(condition, what) {
  const deadline = Date.now() + WAIT_MS;
  let nodes = [];
  while (Date.now() < deadline) {
    nodes = dumpNodes();
    if (condition(nodes)) return nodes;
    execFileSync("sleep", [POLL_MS / 1000]);
  }
  adb("shell", "settings", "put", "system", "font_scale", fontScaleBefore);
  fail(`did not reach ${what} within ${WAIT_MS} ms`);
}

const serverEntry = (nodes) => nodes.find((n) => n.text === "http://10.0.2.2:8081");
const launcherGone = (nodes) => !nodes.some((n) => n.text === "DEVELOPMENT SERVERS");

let nodes = pollUntil((n) => Boolean(serverEntry(n)), "the dev client launcher with the Metro server entry");
const [bx1, by1, bx2, by2] = serverEntry(nodes).bounds;
adb("shell", "input", "tap", String((bx1 + bx2) >> 1), String((by1 + by2) >> 1));
nodes = pollUntil(launcherGone, "the app session to take over the screen");
adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", DEEP_LINK, PACKAGE);
pollUntil((n) => n.some((x) => x.text === PROBE_CAPTION), "the probe surface");

// ---- walk the scrollable probe: positions until the view stops moving ----
const sameBounds = (a, b) => JSON.stringify(a.map((n) => n.bounds)) === JSON.stringify(b.map((n) => n.bounds));

// A swipe leaves a momentum fling behind: poll until two consecutive dumps
// agree, then the view has settled and the frame is safe to capture.
function waitForStable() {
  let prev = dumpNodes();
  for (let i = 0; i < 10; i++) {
    execFileSync("sleep", ["1"]);
    const cur = dumpNodes();
    if (sameBounds(cur, prev)) return cur;
    prev = cur;
  }
  return prev;
}

const screens = [];
const seen = new Set();
nodes = waitForStable();
for (let pos = 0; pos <= MAX_SCROLLS; pos++) {
  const newCaptions = nodes
    .map((n) => n.text)
    .filter((t) => t && !seen.has(t));
  for (const t of newCaptions) seen.add(t);
  const shot = `probe-scale${argScale}-pos${pos}.png`;
  const png = execFileSync(ADB, ["-s", SERIAL, "exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(RUNTIME, shot), png);
  writeFileSync(join(RUNTIME, `dump-scale${argScale}-pos${pos}.xml`), adb("shell", "cat", "/sdcard/kudy-probe-dump.xml"));
  screens.push({
    position: pos,
    screenshot: `runtime/${shot}`,
    dump: `runtime/dump-scale${argScale}-pos${pos}.xml`,
    newCaptions,
  });
  if (pos === MAX_SCROLLS) break;
  adb("shell", "input", "swipe", "540", "1900", "540", "500", "600");
  const after = waitForStable();
  if (sameBounds(after, nodes)) {
    screens.at(-1).scrolledPastEnd = true;
    break;
  }
  nodes = after;
}

// ---- restore the device ----
adb("shell", "settings", "put", "system", "font_scale", fontScaleBefore);

// ---- machine JSON (non-ASCII re-encoded; raw bytes stay in runtime/) ----
const result = {
  run: {
    task: "G21.47 (issue #671)",
    driver: "han-probe-run.mjs",
    surface: "app/han-probe.tsx (dev-only, __DEV__-gated)",
    device: { serial: SERIAL, ...props, fontScaleBefore, fontScaleRun: argScale, fontScaleRestored: fontScaleBefore },
    metro: "http://localhost:8081/status=packager-status:running",
    probeDeepLink: DEEP_LINK,
  },
  deviceCjkFonts: cjkFonts,
  deviceCjkFamiliesFromFontsXml: cjkFamilies,
  screens,
  // The per-row extraction (bounds, height comparisons across scales, the
  // clipping scan) is done from the runtime dumps by the analysis step and
  // lands in analysis-scale.json next to this file.
};
const out = join(HERE, `raw-run-scale${argScale}.json`);
writeFileSync(out, JSON.stringify(result, null, 2).replace(/[^\x00-\x7F]/g, (c) => `\\u${c.codePointAt(0).toString(16).padStart(4, "0")}`) + "\n");
console.log(`OK scale=${argScale}: ${screens.length} screens captured -> ${out}`);
for (const s of screens) console.log(`  pos${s.position}: +${s.newCaptions.length} new captions, ${s.screenshot}`);
console.log(`CJK font files on device: ${cjkFonts.length}; CJK families in fonts.xml: ${cjkFamilies.length}`);
