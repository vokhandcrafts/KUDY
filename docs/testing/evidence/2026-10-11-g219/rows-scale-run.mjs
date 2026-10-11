// G21.47 follow-up (issue #719) — the device-run driver: the production
// surfaces with fixed horizontal rows swept at one system font_scale,
// screenshots plus a horizontal clipping scan over the uiautomator dumps.
// Zero dependencies, the web e2e idiom (waits on conditions with timeouts,
// never fixed sleeps; a missing precondition skips with a reason and never
// reports a pass). Raw uiautomator dumps stay in the gitignored runtime/;
// the emitted machine JSON re-encodes every non-ASCII codepoint, so the
// committed files stay clean (the G21.47 idiom). Reproduction:
//   node docs/testing/evidence/2026-10-11-g219/rows-scale-run.mjs --scale 1.0
//   node docs/testing/evidence/2026-10-11-g219/rows-scale-run.mjs --scale 2.0
// Prerequisites per docs/development_setup.md: booted AVD (kudy-test),
// by.kudy.app installed (the Oct-11 rebuild — the installed Oct-2 build
// predates the expo-sqlite binding and dies in the device composition),
// Metro on :8081 started with EXPO_PUBLIC_CATALOG_ORIGIN=http://10.0.2.2:8791
// and the G23.01 origin on :8791 (`npm run e2e:origin`).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  adb,
  assertPreconditions,
  deviceProps,
  ensureRuntimeDir,
  escapeNonAscii,
  fail,
  PACKAGE,
  PORT,
  SERIAL,
  screencap,
} from "../device-run-lib.mjs";

// The driver's own directory: the artifacts land beside the driver, never
// beside the shared lib it imports.
const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(HERE, "runtime");
const WAIT_MS = 60000;
const POLL_MS = 1500;
const MAX_SCROLLS = 8;

const argScale = (() => {
  const i = process.argv.indexOf("--scale");
  if (i === -1) fail("usage: rows-scale-run.mjs --scale <1.0|2.0> (font_scale is set and then restored)");
  const v = Number(process.argv[i + 1]);
  if (v !== 1 && v !== 2) fail(`--scale must be 1.0 or 2.0, got ${process.argv[i + 1]}`);
  return v;
})();

// ---- preconditions: adb, booted device, installed package, Metro up ----
assertPreconditions();
ensureRuntimeDir(RUNTIME);

// ---- device facts (rule 9: the environment state as command output) ----
const props = deviceProps();
const wmSize = adb("shell", "wm", "size").trim();
const windowMatch = /(\d+)x(\d+)/.exec(wmSize);
if (!windowMatch) fail(`unreadable window size: ${wmSize}`);
const WINDOW = { width: Number(windowMatch[1]), height: Number(windowMatch[2]) };

function dumpXml() {
  // uiautomator fails to produce a dump while the screen wakes or the window
  // transitions (a fresh boot lands on the keyguard) — retry with a wake
  // nudge instead of crashing the sweep; an empty dump just polls again.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      adb("shell", "uiautomator", "dump", "/sdcard/kudy-dump.xml");
      const out = adb("shell", "cat", "/sdcard/kudy-dump.xml");
      if (out.includes("<hierarchy")) return out;
    } catch {
      // fall through to the wake nudge
    }
    adb("shell", "input", "keyevent", "82");
  }
  return "";
}

function parseNodes(xml) {
  const nodes = [];
  const re = /<node [^>]*>/g;
  for (const tag of xml.match(re) ?? []) {
    const attr = (name) => {
      const m = new RegExp(`${name}="([^"]*)"`, "u").exec(tag);
      return m ? m[1] : "";
    };
    const bounds = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attr("bounds"));
    if (!bounds) continue;
    nodes.push({
      text: attr("text"),
      desc: attr("content-desc"),
      id: attr("resource-id"),
      bounds: [Number(bounds[1]), Number(bounds[2]), Number(bounds[3]), Number(bounds[4])],
    });
  }
  return nodes;
}

// The clipping scan (the G21.47 definition, horizontal form): in a single
// dump every visible text/desc node must sit inside the window's width —
// a node painted past the right edge is the #719 defect class. Vertical
// partial visibility in one dump is not a finding: the sweep dumps every
// scrollable surface at top and at its scroll end.
function clipFindings(nodes) {
  return nodes
    .filter((n) => (n.text.length > 0 || n.desc.length > 0) && (n.bounds[2] > WINDOW.width || n.bounds[0] < 0))
    .map((n) => ({ text: escapeNonAscii(n.text || n.desc), bounds: n.bounds }));
}

function deepLink(uri) {
  adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", uri);
}

function scrollBottom() {
  for (let i = 0; i < MAX_SCROLLS; i += 1) {
    adb("shell", "input", "swipe", "540", "1800", "540", "500", "250");
  }
}

// The swept surfaces: the deep link, the marker texts (any one proves the
// surface rendered — the run surface renders active or its honest
// unavailable state), and the essential row texts the scan must find. The
// feedback seams and the live-run Start gate are absent on the device
// composition, so the feedback form and a refused run record their honest
// unavailable states.
const RUN_ACTIVE = "Прыпыніць прагулку";
const RUN_PAUSED = "Прагулка прыпынена";
const RUN_UNAVAILABLE = "Сесія недаступная";
const SURFACES = [
  { name: "city", uri: "kudy:///", markers: ["Гданьск"], essential: ["Побач →", "Гіды →"] },
  {
    name: "preview",
    uri: "kudy:///route/e2e-free-guide",
    markers: ["E2E-гід: тры свабодныя кропкі"],
    essential: ["Час: ад 40 да 60 хв", "Кропкі: 3"],
  },
  { name: "map", uri: "kudy:///map", markers: ["Побач"], essential: ["Агляд"] },
  { name: "my", uri: "kudy:///my", markers: ["Мова"], essential: ["Беларуская"] },
  { name: "feedback-unavailable", uri: "kudy:///feedback?kind=guide&id=e2e-free-guide&version=1&locale=be", markers: ["Водгук недаступны"], essential: [] },
  // The run last: a live walk changes the my surface's own-walk line, and
  // the sweep leaves the walk running for the next scale's restore.
  { name: "run", uri: "kudy:///run/e2e-free-guide", markers: [RUN_ACTIVE, RUN_PAUSED, RUN_UNAVAILABLE], essential: [RUN_ACTIVE, "Завяршыць прагулку"] },
];

// A fresh launch after force-stop lands in the dev launcher, not the app:
// tap the listed dev-server entry once, then wait for the root marker.
function tapLauncherServer() {
  const server = parseNodes(dumpXml()).find((n) => n.text === `http://10.0.2.2:${PORT}` || n.text === `http://localhost:${PORT}`);
  if (!server) return false;
  adb(
    "shell",
    "input",
    "tap",
    String(Math.round((server.bounds[0] + server.bounds[2]) / 2)),
    String(Math.round((server.bounds[1] + server.bounds[3]) / 2)),
  );
  return true;
}

async function launchApp(rootMarker) {
  // The kudy:// deep link races the fresh install's intent resolution after
  // a force-stop; the LAUNCHER intent is the reliable bring-up. The loop
  // then walks the dev launcher (tap the server entry once) to the root.
  adb("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");
  const started = Date.now();
  let tapped = false;
  let monkeyRetries = 0;
  for (;;) {
    const nodes = parseNodes(dumpXml());
    if (nodes.some((n) => n.text === rootMarker)) return;
    if (!tapped && nodes.some((n) => n.text === "DEVELOPMENT SERVERS")) {
      tapped = tapLauncherServer();
    } else if (nodes.length > 0 && !nodes.some((n) => n.text.length > 0) && monkeyRetries < 3) {
      monkeyRetries += 1;
      adb("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");
    }
    if (Date.now() - started > WAIT_MS * 2) {
      fail(`root surface: marker ${JSON.stringify(rootMarker)} not reached in ${WAIT_MS * 2}ms`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

function tapByText(word) {
  const node = parseNodes(dumpXml()).find((n) => n.text === word && n.bounds[2] > n.bounds[0]);
  if (!node) return false;
  adb(
    "shell",
    "input",
    "tap",
    String(Math.round((node.bounds[0] + node.bounds[2]) / 2)),
    String(Math.round((node.bounds[1] + node.bounds[3]) / 2)),
  );
  return true;
}

function capture(surface, tag, nodes) {
  writeFileSync(
    join(HERE, `${surface}-${tag}-scale${argScale === 1 ? 1 : 2}.png`),
    screencap(),
  );
  return {
    tag,
    nodes: nodes.filter((n) => n.text || n.desc).map((n) => ({ ...n, text: escapeNonAscii(n.text), desc: escapeNonAscii(n.desc) })),
    clipFindings: clipFindings(nodes),
    visibleTexts: nodes
      .filter((n) => n.text.length > 0 || n.desc.length > 0)
      .map((n) => escapeNonAscii(n.text || n.desc)),
  };
}

async function waitAny(markers, label) {
  const started = Date.now();
  for (;;) {
    const nodes = parseNodes(dumpXml());
    const hit = markers.find((m) => nodes.some((n) => n.text === m || n.desc === m || n.id === m));
    if (hit) return { nodes, marker: hit };
    if (Date.now() - started > WAIT_MS) {
      fail(`surface ${label}: none of ${JSON.stringify(markers)} reached in ${WAIT_MS}ms`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// The live-walk sub-sweep (issue #719's affected surface): the actions row
// active, paused, and resumed. An unavailable run cannot prove this fix.
async function runSubSweep() {
  const states = [];
  if (!tapByText(RUN_ACTIVE)) fail("run: pause not tapped");
  {
    const { nodes } = await waitAny(["Працягнуць"], "run-paused");
    states.push({ state: "paused", ...capture("run", "paused", nodes) });
    if (!tapByText("Працягнуць")) fail("run-paused: resume not tapped");
    await waitAny([RUN_ACTIVE], "run-resumed");
  }
  states.push({ state: "resumed", ...capture("run", "resumed", parseNodes(dumpXml())) });
  return states;
}

// ---- run: set font_scale, restart the app so the config is fresh ----
adb("shell", "input", "keyevent", "224");
let results = [];
let appliedScale = "?";
try {
  adb("shell", "settings", "put", "system", "font_scale", String(argScale));
  adb("shell", "am", "force-stop", PACKAGE);
  await new Promise((r) => setTimeout(r, 1500));
  await launchApp("Гданьск");
  appliedScale = adb("shell", "settings", "get", "system", "font_scale").trim();

  for (const surface of SURFACES) {
    deepLink(surface.uri);
    let { nodes, marker } = await waitAny(surface.markers, surface.name);
    if (surface.name === "run") {
      if (marker === RUN_UNAVAILABLE) fail("run unavailable: cannot verify the actions row");
      if (marker === RUN_PAUSED) {
        if (!tapByText("Працягнуць")) fail("run: resume not tapped");
        ({ nodes, marker } = await waitAny([RUN_ACTIVE], "run-active"));
      }
    }
    const captures = [capture(surface.name, "main", nodes)];
    // The scrolled pass: the same surface at its scroll end — rows past the
    // fold must not gain horizontal overflow.
    scrollBottom();
    await new Promise((r) => setTimeout(r, 2000));
    captures.push(capture(surface.name, "scrolled", parseNodes(dumpXml())));
    if (surface.name === "run" && (marker === RUN_ACTIVE || marker === RUN_PAUSED)) {
      captures.push(...(await runSubSweep()));
    }
    const allTexts = captures.flatMap((c) => c.visibleTexts);
    const essentialMissing = surface.essential.filter((word) =>
      !allTexts.some((t) => t.includes(escapeNonAscii(word))),
    );
    if (essentialMissing.length) fail(`${surface.name}: essential elements missing: ${essentialMissing.join(", ")}`);
    results.push({
      surface: surface.name,
      uri: surface.uri,
      markerReached: escapeNonAscii(marker),
      essentialMissing,
      captures,
    });
  }
} finally {
  // ---- restore: font_scale back to 1.0 whatever the sweep outcome ----
  adb("shell", "settings", "put", "system", "font_scale", "1.0");
  adb("shell", "am", "force-stop", PACKAGE);
}

const out = {
  run: {
    task: "G21.47 follow-up (issue #719)",
    device: { serial: SERIAL, ...props, fontScaleRun: argScale, fontScaleApplied: appliedScale, fontScaleRestored: "1.0" },
    window: WINDOW,
    metroPort: PORT,
    note: "font_scale set per run and restored to 1.0 after; app restarted per scale so the RN config is fresh",
  },
  surfaces: results,
  horizontalClipScan: results.flatMap((r) =>
    r.captures.flatMap((c) => c.clipFindings.map((f) => ({ surface: r.surface, state: c.tag, ...f }))),
  ),
};
writeFileSync(join(HERE, `rows-scale${argScale === 1 ? 1 : 2}.json`), `${JSON.stringify(out, null, 2)}\n`);
if (out.horizontalClipScan.length) fail("horizontal clipping detected; inspect the saved evidence");
console.log(`rows-scale-run: scale ${argScale} done; surfaces=${results.length}; clipFindings=${out.horizontalClipScan.length}`);
