// G21.47 (issue #671) — the analysis pass over the runtime dumps the two
// han-probe-run.mjs captures produced (one per system font_scale). Emits the
// committed machine JSON: per-row bounds and heights at both scales, the
// height ratios of the three scaling behaviors, the fully-visible scan over
// the essential rows (empty list = nothing essential stays clipped at either
// scale), and the device CJK font inventory. Raw dumps carry real CJK bytes
// and stay gitignored; every non-ASCII codepoint in the emitted file is
// escape-encoded. Reproduction:
//   node docs/testing/evidence/2026-10-11-g2147/han-probe-analysis.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(HERE, "runtime");

// Escape-encode anything outside ASCII so the committed file carries no raw
// CJK bytes (the gitguard idiom of G21.40).
const esc = (s) =>
  String(s).replace(/[^\x20-\x7E]/g, (c) => [...c].map((ch) => `\\u${ch.codePointAt(0).toString(16).padStart(4, "0")}`).join(""));

// The essential rows by their caption on the surface; `match` is the content
// node's text for rows located by content (the action buttons carry no
// caption). `style` is the requested font style the surface asks RN for.
const ROWS = [
  { key: "card-hans", caption: "card hans / ui 400 / scaled", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "card-hans-strong", caption: "card hans / ui strong 600 / scaled", style: "fontFamilyUiStrong (GolosText_600SemiBold, 600)" },
  { key: "card-hant", caption: "card hant / ui 400 / scaled", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "card-long", caption: "long name, no spaces / ui 400 / scaled", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "card-polish", caption: "latin-ext control / ui 400 / scaled", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "duration", caption: "duration, digits+cjk", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "date", caption: "date, digits+cjk", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "action-primary", caption: null, match: "\u5f00\u59cb\u6e38\u89c8", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "action-secondary", caption: null, match: "\u4e0b\u8f7d\u79bb\u7ebf\u5305", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "action-disabled", caption: null, match: "\u6682\u4e0d\u5f00\u653e", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "error", caption: "error state", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "unavailable", caption: "unavailable state", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "narrative", caption: "narrative / ui 400 / scaled", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "timer", caption: "timer / digits+cjk / middle dot", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "audio-label", caption: "audio identity label", style: "fontFamilyUi (GolosText_400Regular, 400)" },
  { key: "s2-shared", caption: "S2 shared codepoints (regional forms)", style: "fontFamilyUi (GolosText_400Regular, 400), 48px" },
  { key: "scale-scaled-cap", caption: "ScaledText (cap 1.25)", style: "fontFamilyUi, ScaledText (maxFontSizeMultiplier 1.25)" },
  { key: "scale-raw-full", caption: "Text, no cap", style: "fontFamilyUi, raw Text (allowFontScaling default)" },
  { key: "scale-pinned-off", caption: "allowFontScaling=false", style: "fontFamilyUi, Text allowFontScaling=false" },
];

function parseDump(file) {
  const xml = readFileSync(join(RUNTIME, file), "utf8");
  const nodes = [
    ...xml.matchAll(/<node[^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g),
  ].map((m) => ({ text: m[1], x1: +m[2], y1: +m[3], x2: +m[4], y2: +m[5] }));
  const screen = nodes.find((n) => n.text === "" && n.y1 === 0) ?? nodes[0];
  return { nodes, screenW: screen.x2, screenH: screen.y2 };
}

// For a scale: per row, the content node found under its caption (document
// order) or by exact content text. A row can appear in several scroll
// positions (edge-clipped at one, full at the next) — the tallest observed
// placement wins; accessibility boxes shrink to the visible viewport.
function extract(scale) {
  const files = [...Array(10).keys()].map((i) => `dump-scale${scale}-pos${i}.xml`);
  const perRow = new Map();
  let screenW = 0;
  let screenH = 0;
  for (const file of files.filter((f) => {
    try {
      readFileSync(join(RUNTIME, f));
      return true;
    } catch {
      return false;
    }
  })) {
    const { nodes, screenW: w, screenH: h } = parseDump(file);
    screenW = w;
    screenH = h;
    for (const row of ROWS) {
      let idx = -1;
      if (row.caption !== null) {
        idx = nodes.findIndex((n) => n.text === row.caption);
      } else {
        idx = nodes.findIndex((n) => n.text === row.match);
      }
      if (idx === -1) continue;
      if (row.caption !== null) {
        // the content node: the next text node whose top is below the caption
        idx = nodes.findIndex((n, i) => i > idx && n.text && n.y1 >= nodes[idx].y2);
        if (idx === -1) continue;
      }
      const n = nodes[idx];
      const candidate = {
        text: esc(n.text),
        bounds: [n.x1, n.y1, n.x2, n.y2],
        height: n.y2 - n.y1,
        width: n.x2 - n.x1,
      };
      const prev = perRow.get(row.key);
      if (!prev || candidate.height > prev.height) perRow.set(row.key, candidate);
    }
  }
  return { screenW, screenH, rows: Object.fromEntries(perRow) };
}

const s1 = extract(1);
const s2 = extract(2);
const raw1 = JSON.parse(readFileSync(join(HERE, "raw-run-scale1.json"), "utf8"));
const raw2 = JSON.parse(readFileSync(join(HERE, "raw-run-scale2.json"), "utf8"));

// The CJK families come verbatim from the driver's machine output (it parses
// the device fonts.xml during the run — one parser, one source; a second
// copy here was a jscpd clone).
const cjkFamilies = raw1.deviceCjkFamiliesFromFontsXml;

const ESSENTIAL = ROWS.map((r) => r.key);
function fullyVisibleScan(extracted) {
  // A row is flagged when no captured scroll position shows it fully inside
  // the viewport — i.e. the content never fits on screen (empty list = the
  // essential set is fully reachable and visible at this scale).
  return ESSENTIAL.filter((key) => {
    const r = extracted.rows[key];
    if (!r) return true;
    const [, y1, , y2] = r.bounds;
    return !(y1 > 0 && y2 < extracted.screenH);
  });
}

const ratio = (a, b) => (a && b ? Math.round((a / b) * 100) / 100 : null);
const scaling = {
  scaledCap: ratio(s2.rows["scale-scaled-cap"]?.height, s1.rows["scale-scaled-cap"]?.height),
  rawFull: ratio(s2.rows["scale-raw-full"]?.height, s1.rows["scale-raw-full"]?.height),
  pinnedOff: ratio(s2.rows["scale-pinned-off"]?.height, s1.rows["scale-pinned-off"]?.height),
  expected: "scaledCap ~ 1.25 (font.big-text-factor cap), rawFull ~ 2.0 (system scale), pinnedOff 1.0",
};

const rowsOut = ROWS.map((r) => {
  const a = s1.rows[r.key];
  const b = s2.rows[r.key];
  return {
    row: r.key,
    requestedStyle: r.style,
    height1: a?.height ?? null,
    height2: b?.height ?? null,
    bounds1: a?.bounds ?? null,
    bounds2: b?.bounds ?? null,
    text: a?.text ?? b?.text ?? null,
  };
});

const result = {
  run: {
    task: "G21.47 (issue #671)",
    analysis: "han-probe-analysis.mjs over runtime dumps of two han-probe-run.mjs captures",
    device: raw1.run.device,
    note: "same device and app instance for both scales; font_scale restored to 1.0 after each capture",
    screen: { width: s1.screenW, height: s1.screenH, scale1: [s1.screenW, s1.screenH], scale2: [s2.screenW, s2.screenH] },
  },
  deviceCjkFontFiles: raw1.deviceCjkFonts,
  deviceCjkFamiliesFromFontsXml: cjkFamilies,
  // Pixel-measured glyph heights from the screenshots (uiautomator boxes are
  // accessibility frames, not glyph sizes) — see glyph-metrics.py.
  glyphMetrics: JSON.parse(readFileSync(join(HERE, "glyph-metrics.json"), "utf8")),
  scalingBehavior: scaling,
  clippingScan: {
    definition:
      "an essential row is flagged when no captured scroll position shows it fully inside the viewport; empty list at a scale = the essential set is fully reachable and visible",
    scale1: fullyVisibleScan(s1),
    scale2: fullyVisibleScan(s2),
  },
  observedFindings: {
    strongWeight:
      "device inventory has no separate CJK Bold file (only -Regular .ttc files), while fonts.xml declares a variable wght axis 100-900 on NotoSansCJK-Regular.ttc; the strong row paints visibly heavier strokes over identical glyph shapes (strong-weight-compare.png) - consistent with both a variable instance and synthetic emboldening; the mechanism is undetermined by this run",
    regionalForms:
      "the S2 shared-codepoints row renders SC forms (simplified radicals in the canvas radicals) — no JP-form trap (probe-scale2-pos2.png vs the G21.40 S2 comparison)",
    uncappedScalingDefect:
      "at font_scale 2.0 the raw uncapped Text row paints anomalous CJK glyphs (a wrong glyph at the position of U+53F2, correct accessibility string) and a smaller-than-expected advance; the capped and pinned rows render the same string correctly — defect recorded, follow-up issue named in the results file",
    actionsRowOverflow:
      "at font_scale 2.0 the three-button actions row overflows the viewport width and the third button is cut at the screen edge (probe-scale2-pos0.png); production screens have similar fixed rows (app/route/[id].tsx) — follow-up issue named in the results file",
  },
  rows: rowsOut,
};

const out = join(HERE, "han-probe-results.json");
writeFileSync(
  out,
  JSON.stringify(result, null, 2).replace(/[^\x00-\x7F]/g, (c) => `\\u${c.codePointAt(0).toString(16).padStart(4, "0")}`) + "\n",
);
console.log(`OK -> ${out}`);
console.log(`rows extracted: s1=${Object.keys(s1.rows).length}/${ROWS.length}, s2=${Object.keys(s2.rows).length}/${ROWS.length}`);
console.log(`scaling ratios: ${JSON.stringify(scaling)}`);
console.log(`clipping scan: scale1=[${result.clippingScan.scale1}], scale2=[${result.clippingScan.scale2}]`);
