// DQ-03 (issue #913) — the one command behind `npm run visual:check`: it
// captures the V1 specimen and screen matrix on the emulator (spec §6.4,
// §8.1), compares every shot with its baseline through pixelmatch and
// writes `manifest.json` + `report.md` the owner reads in five minutes.
//
//   npm run visual:check -- --surface guide-card-free,explore-a
//   npm run visual:check -- --update                       # write baselines
//   npm run visual:check -- --update --from <captures-dir> # adopt CI captures
//   npm run visual:check -- --from <captures-dir>          # compare only
//
// The V1 matrix (spec §8.1): light theme × font scale 1 / 1.5 × locale `be`.
// Surfaces: the four guide-card stories (the specimen screen renders one
// story per deep link) and the Explore screen in both phases (A — no
// catalog origin, B — the G23.01 fixture origin). Baselines live under
// `docs/design-qa/baselines/` and are written ONLY with `--update`
// (criterion 2) — a run without the flag never touches that directory.
//
// Comparison follows DQ-01: pixelmatch 5.3.0 at threshold 0.1, a slot
// passes when the differing-pixel fraction of the compared area is at most
// 0.05 %, and the top 100 px (the statusbar clock) are cropped away —
// SystemUI demo mode is forbidden (it ANRs, DQ-01). A size mismatch is an
// explicit FAIL, never a pass (criterion 3).
//
// Environment failures are hard exits, not skips: missing adb, no booted
// emulator or a missing APK exits non-zero with the reason and never
// reports a pass (criterion 5). This is deliberate — run-e2e skips with
// exit 0 because it is a test suite; visual:check is a verdict tool and a
// silent skip would read as a clean verdict.
//
// Nothing here restates another tool's internals: the Metro/origin chain,
// the cold start and the target resolution are imported from the G23.03
// runner and driver (implementation-rules 2/3), every device touch goes
// through E2eDriver, and the story list is parsed from the single source
// `components/guide-card.stories.tsx` — fail-closed, never duplicated.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { DriverError, E2eDriver, findNode, listBootedDevices, parseDump, resolveAdb } from './driver.mjs';
import { MIN_TARGET_DP, checkA11y, listHitSlopSources, parseA11yTree, readHitSlops } from './visual-a11y.mjs';
import {
  APP_PACKAGE,
  BUNDLE_TIMEOUT_MS,
  FIRST_BUNDLE_TIMEOUT_MS,
  FIXTURE_GUIDE_ROUTE_ID,
  coldStart,
  devClientUrl,
  resolveTarget,
  startMetro,
  startOriginServer,
  stopGroupProcess,
} from './run-e2e.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORIES_FILE = path.join(REPO_ROOT, 'components', 'guide-card.stories.tsx');
export const DEFAULT_BASELINES_DIR = path.join(REPO_ROOT, 'docs', 'design-qa', 'baselines');
const ARTIFACTS_ROOT = path.join(REPO_ROOT, 'tools', 'e2e-android', 'artifacts');
const SETTLE_MS = 5000;
const INSTALL_SETTLE_MS = 45000;
const ANR_WAIT_LABEL = 'Wait';

// The DQ-01 comparison constants (results doc "Рэкамендацыі"): threshold and
// the maximum differing-pixel fraction, and the statusbar crop.
export const COMPARISON = Object.freeze({
  cropTopPx: 100,
  threshold: 0.1,
  maxDiffFraction: 0.0005,
});

// The V1 matrix axes (spec §8.1). `scales` are Android `font_scale` values;
// the device stays in the light theme and the app UI locale is `be` (the
// app's default on an unconfigured emulator, measured in DQ-01).
export const MATRIX = Object.freeze({
  locale: 'be',
  scales: [1, 1.5],
  screenSurfaces: Object.freeze([
    Object.freeze({ id: 'explore-a', fixture: 'phase A — no catalog origin (honest unavailable state)' }),
    Object.freeze({ id: 'explore-b', fixture: `tools/e2e-origin G23.01 fixture catalog (${FIXTURE_GUIDE_ROUTE_ID})` }),
  ]),
});

// System settings the capture pins, with the Android settings namespace for
// each. Every value is snapshotted before the run and restored after — on
// the failure path too (the DQ-01 idiom).
const SETTINGS_SPECS = Object.freeze([
  Object.freeze({ key: 'font_scale', ns: 'system' }),
  Object.freeze({ key: 'window_animation_scale', ns: 'global' }),
  Object.freeze({ key: 'transition_animation_scale', ns: 'global' }),
  Object.freeze({ key: 'animator_duration_scale', ns: 'global' }),
]);

// ---------- matrix ----------

// The story names of the single-source stories file. Parsing the real
// source keeps the matrix tied to DQ-02's `stories` array (a restated list
// here would drift — implementation-rules 2). Fail-closed: zero names is an
// error, never an empty matrix that would pass everything.
export function parseStoryNames(source) {
  if (typeof source !== 'string') throw new Error('parseStoryNames: source must be a string');
  const names = [...source.matchAll(/\bname: "([^"]+)"/g)].map((match) => match[1]);
  const unique = [...new Set(names)];
  if (unique.length === 0) {
    throw new Error(`parseStoryNames: no story names found in the stories source (${names.length} matches)`);
  }
  if (unique.length !== names.length) {
    throw new Error(`parseStoryNames: duplicate story names in the source: ${names.join(', ')}`);
  }
  return unique;
}

// `guide-card free` → `guide-card-free`; the story surfaces share the
// fixture provenance of the stories file.
export function storySurfacesFromNames(names) {
  return names.map((name) => ({
    id: `guide-card-${name}`,
    story: name,
    fixture: 'synthetic fixtures — components/guide-card.stories.tsx',
  }));
}

// The slot id of one matrix cell: surface × font scale × locale. This exact
// string names the baseline file, so the fast baseline check (criterion 4)
// and the report speak the same names.
export function slotId(surfaceId, scale, locale) {
  return `${surfaceId}@font${scale}-${locale}`;
}

// Driver artifacts reject `@` (ARTIFACT_BASENAME) — one sanitize point maps
// a slot id to its capture file name everywhere.
export function captureFileName(slot) {
  if (/@/.test(slot) === false) throw new Error(`captureFileName: slot ${JSON.stringify(slot)} has no @`);
  return `${slot.replace('@', '_')}.png`;
}

// The dump file the capture writes for one slot (captureAll) — the DQ-06
// a11y pass re-derives the same name from this single definition instead
// of restating the pattern (implementation-rules 2).
export function dumpBasenameForSlot({ surface, story, scale }) {
  return story ? `dump-story-${story}-font${scale}.xml` : `dump-${surface}-font${scale}.xml`;
}

export function loadMatrix() {
  const storyNames = parseStoryNames(fs.readFileSync(STORIES_FILE, 'utf8'));
  return {
    locale: MATRIX.locale,
    scales: MATRIX.scales,
    surfaces: [...storySurfacesFromNames(storyNames), ...MATRIX.screenSurfaces],
  };
}

// Which capture phases the selected surfaces need — the pure half of the
// capture orchestration (unit-tested without a device). The per-scale cold
// start always runs when any phase needs the device: it loads the bundle
// and applies the font scale the story links and shots rely on.
export function planCapture(matrix) {
  const ids = new Set(matrix.surfaces.map((surface) => surface.id));
  return {
    exploreA: ids.has('explore-a'),
    stories: matrix.surfaces.some((surface) => surface.story),
    exploreB: ids.has('explore-b'),
  };
}

export function allSlots(matrix) {
  const slots = [];
  for (const surface of matrix.surfaces) {
    for (const scale of matrix.scales) {
      slots.push({
        slot: slotId(surface.id, scale, matrix.locale),
        surface: surface.id,
        story: surface.story ?? null,
        scale,
        locale: matrix.locale,
        fixture: surface.fixture,
      });
    }
  }
  return slots;
}

// ---------- PNG helpers (pngjs, the one decoder the tool pins) ----------

function decodePng(buffer) {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

function encodePng({ width, height, data }) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return PNG.sync.write(png);
}

function cropTop({ width, height, data }, cropTopPx) {
  if (cropTopPx === 0) return { width, height, data };
  if (cropTopPx < 0 || cropTopPx >= height) {
    throw new Error(`cropTop: ${cropTopPx} px leaves no content (height ${height})`);
  }
  const croppedHeight = height - cropTopPx;
  const out = new Uint8Array(width * croppedHeight * 4);
  out.set(data.subarray(cropTopPx * width * 4));
  return { width, height: croppedHeight, data: out };
}

// ---------- comparison ----------

// Compare one capture with its baseline. Verdicts:
//   PASS  — within the DQ-01 noise budget (fraction ≤ maxDiffFraction);
//   DIFF  — beyond it, with a diff image written next to the report;
//   FAIL  — a size mismatch or unreadable input: an explicit failure,
//           never a pass (criterion 3).
export function comparePair({ baselinePath, currentPath, cropTopPx = COMPARISON.cropTopPx, threshold = COMPARISON.threshold, maxDiffFraction = COMPARISON.maxDiffFraction }) {
  const baseline = decodePng(fs.readFileSync(baselinePath));
  const current = decodePng(fs.readFileSync(currentPath));
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      verdict: 'FAIL',
      reason:
        `size mismatch: baseline ${baseline.width}×${baseline.height}, current ${current.width}×${current.height} ` +
        `(different device profile? the reference environment is the DQ-01 CI profile)`,
      diffPixels: null,
      diffFraction: null,
    };
  }
  const a = cropTop(baseline, cropTopPx);
  const b = cropTop(current, cropTopPx);
  const diff = new Uint8Array(a.width * a.height * 4);
  const diffPixels = pixelmatch(a.data, b.data, diff, a.width, a.height, { threshold });
  const diffFraction = diffPixels / (a.width * a.height);
  return {
    verdict: diffFraction <= maxDiffFraction ? 'PASS' : 'DIFF',
    diffPixels,
    diffFraction,
    width: a.width,
    height: a.height,
    diffImage: diffFraction > 0 && diffPixels > 0 ? encodePng({ width: a.width, height: a.height, data: diff }) : null,
  };
}

// ---------- baseline guard (criterion 2) ----------

// Write capture PNGs into the baselines directory. The caller invokes this
// only for `--update` runs — the guard lives at the single call site in
// main(), and the negative test proves a run without the flag never gets
// here.
export function writeBaselines({ slots, capturesDir, baselinesDir }) {
  fs.mkdirSync(baselinesDir, { recursive: true });
  const written = [];
  for (const { slot } of slots) {
    const source = path.join(capturesDir, captureFileName(slot));
    if (!fs.existsSync(source)) continue;
    const target = path.join(baselinesDir, `${slot}.png`);
    fs.copyFileSync(source, target);
    written.push(target);
  }
  return written;
}

// ---------- report and manifest (spec §6.4 shape) ----------

const pct = (fraction) => (fraction === null ? '—' : `${(fraction * 100).toFixed(4)}%`);

const VERDICT_ORDER = ['PASS', 'DIFF', 'FAIL', 'NOT-VERIFIED'];

function verdictCounts(results) {
  const counts = Object.fromEntries(VERDICT_ORDER.map((verdict) => [verdict, 0]));
  for (const result of results) counts[result.verdict] += 1;
  return counts;
}

function relativeLink(fromDir, targetPath) {
  return path.relative(fromDir, targetPath).replaceAll(path.sep, '/');
}

export function buildReport({ results, outDir, baselinesDir, mode, a11y = null }) {
  const counts = verdictCounts(results);
  const verdictLine = `visual:check — ${VERDICT_ORDER.map((verdict) => `${verdict} ${counts[verdict]}`).join(' · ')}`;
  const lines = [];
  lines.push(`# visual:check — справаздача (${mode})`);
  lines.push('');
  lines.push(`**${verdictLine}**`);
  lines.push('');
  lines.push(`Паверхні: ${[...new Set(results.map((result) => result.surface))].join(', ')}.`);
  lines.push('');
  lines.push(
    `Матрыца V1: светлая тэма × шрыфт 1 / 1.5 × мова be. Параўнанне без верхніх ${COMPARISON.cropTopPx} px ` +
      `(статусбар, DQ-01); pixelmatch 5.3.0, парог ${COMPARISON.threshold}, максімальная доля розных пікселяў ` +
      `${COMPARISON.maxDiffFraction * 100}% ад параўноўванай вобласці.`,
  );
  lines.push('');
  lines.push('## Слоты');
  lines.push('');
  lines.push('| Слот | Вердыкт | Розных пікселяў | Доля |');
  lines.push('|---|---|---|---|');
  for (const result of results) {
    lines.push(`| ${result.slot} | ${result.verdict} | ${result.diffPixels ?? '—'} | ${pct(result.diffFraction)} |`);
  }
  const diffs = results.filter((result) => result.verdict === 'DIFF');
  lines.push('');
  lines.push('## DIFF');
  lines.push('');
  if (diffs.length === 0) {
    lines.push('Розніц за парогам няма.');
  } else {
    lines.push('| Слот | Узор | Бягучы | Розніца |');
    lines.push('|---|---|---|---|');
    for (const result of diffs) {
      lines.push(
        `| ${result.slot} | [узор](${relativeLink(outDir, result.baselinePath)}) | ` +
          `[бягучы](${relativeLink(outDir, result.currentPath)}) | ` +
          `[розніца](${relativeLink(outDir, result.diffImagePath)}) |`,
      );
    }
  }
  const notVerified = results.filter((result) => result.verdict === 'NOT-VERIFIED');
  lines.push('');
  lines.push('## NOT-VERIFIED');
  lines.push('');
  if (notVerified.length === 0) {
    lines.push('Усё праверанае.');
  } else {
    for (const result of notVerified) {
      lines.push(`- ${result.slot} — ${result.reason}`);
    }
  }
  const failures = results.filter((result) => result.verdict === 'FAIL');
  if (failures.length > 0) {
    lines.push('');
    lines.push('## FAIL');
    lines.push('');
    for (const result of failures) {
      lines.push(`- ${result.slot} — ${result.reason}`);
    }
  }
  if (a11y !== null) {
    const a11yCounts = a11yCountsOf(a11y.findings);
    lines.push('');
    lines.push('## Даступнасць (дамп)');
    lines.push('');
    lines.push(
      `**a11y — ${A11Y_ORDER.map((cls) => `${cls} ${a11yCounts[cls]}`).join(' · ')}**`,
    );
    lines.push('');
    lines.push(
      a11y.densityPxPerDp === null
        ? 'Шчыльнасць прылады невядомая — памеры мішэняў не вымераныя (NOT-VERIFIED).'
        : `Шчыльнасць ${a11y.densityPxPerDp} px/dp; мінімум мішэні ${MIN_TARGET_DP} dp; hitSlop прачытаны з кода (дамп яго не бачыць, exceptions.md).`,
    );
    const byClass = (cls) => a11y.findings.filter((finding) => finding.class === cls);
    lines.push('');
    for (const finding of byClass('RULE')) lines.push(...a11yFindingLines(finding));
    // OPINION is capped at three per report (spec §6.4); the manifest keeps
    // every finding, so nothing measured is lost.
    const opinions = byClass('OPINION');
    for (const finding of opinions.slice(0, 3)) lines.push(...a11yFindingLines(finding));
    if (opinions.length > 3) {
      lines.push(`яшчэ ${opinions.length - 3} OPINION не паказана — поўны спіс у manifest.json`);
      lines.push('');
    }
    for (const finding of byClass('NOT-VERIFIED')) lines.push(`- ${finding.slot ?? 'рэестр hitSlop'} — ${finding.evidence}; патрабуецца: ${finding.requires}`);
  }
  lines.push('');
  return { report: lines.join('\n'), verdictLine, counts, a11yCounts: a11y === null ? null : a11yCountsOf(a11y.findings) };
}

const A11Y_ORDER = ['RULE', 'OPINION', 'NOT-VERIFIED'];

function a11yCountsOf(findings) {
  const counts = Object.fromEntries(A11Y_ORDER.map((cls) => [cls, 0]));
  for (const finding of findings) counts[finding.class] += 1;
  return counts;
}

// One finding in the spec §6.4 shape: class + slot, rule, measurement,
// evidence, need.
function a11yFindingLines(finding) {
  const lines = [
    `[${finding.class}] ${finding.slot ?? 'рэестр hitSlop'}`,
    `Правіла: ${finding.rule}`,
  ];
  if (finding.measured) lines.push(`Вымерана: ${finding.measured}`);
  lines.push(`Доказ: ${finding.evidence}`, `Патрабуецца: ${finding.requires}`, '');
  return lines;
}

export function buildManifest({ mode, results, matrix, device, commit, apkSha256, baselinesDir, a11y = null }) {
  return {
    tool: 'visual:check',
    mode,
    commit,
    device,
    theme: 'light',
    fontScale: matrix.scales,
    locale: matrix.locale,
    fixture: Object.fromEntries(matrix.surfaces.map((surface) => [surface.id, surface.fixture])),
    comparison: COMPARISON,
    apkSha256: apkSha256 ?? null,
    baselinesDir,
    a11y:
      a11y === null
        ? null
        : {
            densityPxPerDp: a11y.densityPxPerDp,
            hitSlopSources: a11y.hitSlopSources,
            findings: a11y.findings,
          },
    slots: results.map((result) => ({
      slot: result.slot,
      surface: result.surface,
      fontScale: result.scale,
      locale: result.locale,
      fixture: result.fixture,
      verdict: result.verdict,
      diffPixels: result.diffPixels,
      diffFraction: result.diffFraction,
      baseline: path.basename(result.baselinePath ?? ''),
      current: path.basename(result.currentPath ?? ''),
      diffImage: result.diffImagePath ? path.basename(result.diffImagePath) : null,
    })),
  };
}

// ---------- device capture ----------

async function getprop(driver, name) {
  const result = await driver.exec(['shell', 'getprop', name]);
  return result.stdout.trim();
}

async function snapshotSettings(driver) {
  const snapshot = {};
  for (const { key, ns } of SETTINGS_SPECS) {
    const result = await driver.exec(['shell', 'settings', 'get', ns, key]);
    snapshot[key] = result.stdout.trim();
  }
  const mode = await driver.exec(['shell', 'cmd', 'uimode', 'night']);
  const match = /Night mode: (yes|no)/.exec(mode.stdout);
  snapshot.nightMode = match ? match[1] : 'no';
  return snapshot;
}

// `settings get` answers the literal string `null` for an unset value; the
// restore deletes the entry instead of storing that string back.
async function restoreSettings(driver, snapshot) {
  for (const { key, ns } of SETTINGS_SPECS) {
    const value = snapshot[key];
    if (value === 'null') {
      await driver.exec(['shell', 'settings', 'delete', ns, key]).catch(() => {});
    } else {
      await driver.exec(['shell', 'settings', 'put', ns, key, value]);
    }
  }
  await driver.exec(['shell', 'cmd', 'uimode', 'night', snapshot.nightMode]).catch(() => {});
}

async function applyCaptureSettings(driver, scale) {
  for (const { key, ns } of SETTINGS_SPECS) {
    if (key !== 'font_scale') await driver.exec(['shell', 'settings', 'put', ns, key, '0']);
  }
  await driver.exec(['shell', 'settings', 'put', 'system', 'font_scale', String(scale)]);
  await driver.exec(['shell', 'cmd', 'uimode', 'night', 'no']);
}

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Wait for a selector with the settle pause and the SystemUI-ANR guard from
// DQ-01: when the frozen SystemUI dialog appears, press its own Wait button
// and keep polling. Every poll reads a fresh dump — an old screen never
// reads as the expected one.
async function waitSettled(driver, selector, { timeoutMs, settleMs = SETTLE_MS, dumpBasename }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new DriverError(`timeout after ${timeoutMs} ms waiting for ${JSON.stringify(selector)}`);
    }
    const dump = await driver.dump(dumpBasename, { timeoutMs: Math.min(15000, remainingMs) });
    const nodes = parseDump(dump.xml);
    if (findNode(nodes, { textContains: 'System UI' }) && findNode(nodes, { text: ANR_WAIT_LABEL })) {
      await driver.tapSelector({ text: ANR_WAIT_LABEL }, { timeoutMs: Math.min(10000, remainingMs) });
    }
    if (findNode(nodes, selector)) {
      await sleep(settleMs);
      return;
    }
    await sleep(Math.min(500, Math.max(0, deadline - Date.now())));
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function gitCommit() {
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

// The live capture: per phase, per scale — cold start (fresh process reads
// the just-set font scale), settle, screenshot. Phase A carries the Explore
// screen without the catalog origin plus every story surface; phase B adds
// the origin and captures Explore with the fixture catalog.
export async function captureAll({ driver, matrix, capturesDir, metroPort, originPort, logDir }) {
  fs.mkdirSync(capturesDir, { recursive: true });
  const captured = [];
  const shot = async (surface, scale) => {
    const slot = slotId(surface, scale, matrix.locale);
    const localPath = await driver.screenshot(captureFileName(slot));
    const target = path.join(capturesDir, captureFileName(slot));
    fs.renameSync(localPath, target);
    captured.push(slot);
    return target;
  };
  const snapshot = await snapshotSettings(driver);
  const plan = planCapture(matrix);
  let metro = null;
  let origin = null;
  try {
    // Phase A: Metro without a catalog origin — the honest Explore state and
    // the story surfaces the plan asks for. One Metro serves both font
    // scales; each scale is applied before its cold start so the fresh
    // process reads it. The cold start itself always runs: the bundle load
    // and the font scale it applies are what the story links rely on.
    if (plan.exploreA || plan.stories) {
      metro = await startMetro({ port: metroPort, env: {}, logPath: path.join(logDir, 'metro-a.log') });
      for (const scale of matrix.scales) {
        await applyCaptureSettings(driver, scale);
        await driver.exec(['reverse', `tcp:${metroPort}`, `tcp:${metroPort}`]);
        await coldStart(driver, devClientUrl(metroPort), {
          timeoutMs: scale === matrix.scales[0] ? FIRST_BUNDLE_TIMEOUT_MS : BUNDLE_TIMEOUT_MS,
          caseSlug: `explore-a-font${scale}`,
        });
        if (plan.exploreA) {
          await waitSettled(driver, { testID: 'screen-Explore' }, { timeoutMs: 30000, dumpBasename: dumpBasenameForSlot({ surface: 'explore-a', story: null, scale }) });
          await shot('explore-a', scale);
        }

        if (plan.stories) {
          for (const surface of matrix.surfaces.filter((entry) => entry.story)) {
            await driver.launchDeepLink(`kudy:///dev-specimen?component=guide-card&story=${surface.story}`);
            await waitSettled(
              driver,
              { testID: `dev-specimen/story-${surface.story}` },
              { timeoutMs: 30000, dumpBasename: dumpBasenameForSlot({ surface: surface.id, story: surface.story, scale }) },
            );
            await shot(surface.id, scale);
          }
        }
      }
      await stopGroupProcess(metro, metroPort, 'metro-visual-a');
      metro = null;
    }

    // Phase B: the fixture catalog origin, a fresh Metro with the origin
    // baked into the bundle, and Explore with the catalog loaded — only
    // when an explore surface is selected.
    if (plan.exploreB) {
      origin = await startOriginServer({ port: originPort, logPath: path.join(logDir, 'origin-b.log'), outDir: path.join(logDir, 'origin') });
      await driver.exec(['reverse', `tcp:${originPort}`, `tcp:${originPort}`]);
      metro = await startMetro({
        port: metroPort,
        env: { EXPO_PUBLIC_CATALOG_ORIGIN: `http://localhost:${originPort}` },
        logPath: path.join(logDir, 'metro-b.log'),
      });
      for (const scale of matrix.scales) {
        await applyCaptureSettings(driver, scale);
        await driver.exec(['reverse', `tcp:${metroPort}`, `tcp:${metroPort}`]);
        await coldStart(driver, devClientUrl(metroPort), {
          timeoutMs: scale === matrix.scales[0] ? FIRST_BUNDLE_TIMEOUT_MS : BUNDLE_TIMEOUT_MS,
          caseSlug: `explore-b-font${scale}`,
        });
        await waitSettled(
          driver,
          { testID: `guide-card-${FIXTURE_GUIDE_ROUTE_ID}` },
          { timeoutMs: 30000, dumpBasename: dumpBasenameForSlot({ surface: 'explore-b', story: null, scale }) },
        );
        await shot('explore-b', scale);
      }
    }
  } finally {
    const cleanup = await Promise.allSettled([
      metro === null ? Promise.resolve() : stopGroupProcess(metro, metroPort, 'metro-visual'),
      origin === null ? Promise.resolve() : stopGroupProcess(origin, originPort, 'origin-visual'),
    ]);
    for (const result of cleanup) {
      if (result.status === 'rejected') console.error(`cleanup failed: ${String(result.reason)}`);
    }
    await driver.exec(['reverse', '--remove', `tcp:${metroPort}`]).catch(() => {});
    await driver.exec(['reverse', '--remove', `tcp:${originPort}`]).catch(() => {});
    // The device leaves the run exactly as it entered it — on the failure
    // path too (the DQ-01 restore discipline).
    await restoreSettings(driver, snapshot).catch((error) => {
      console.error(`settings restore failed: ${error.message}`);
    });
  }

  return { captured };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : argv[index + 1] ?? null;
  };
  if (argv.includes('--surface') && value('--surface') === null) {
    console.error('--surface requires a value (example: --surface guide-card,explore)');
    process.exit(2);
  }
  const has = (flag) => argv.includes(flag);
  const surfaceArg = value('--surface');
  return {
    surfaceArg,
    update: has('--update'),
    from: value('--from'),
    out: value('--out'),
    baselinesDir: value('--baselines-dir') ?? DEFAULT_BASELINES_DIR,
    serial: value('--serial'),
    apk: value('--apk'),
    metroPort: Number(value('--metro-port') ?? 8083),
    originPort: Number(value('--origin-port') ?? 8792),
  };
}

function failToRun(reason) {
  console.log(`visual:check — FAILED TO RUN: ${reason}`);
  console.log('No verdict was produced. A run that cannot reach the device never reports a pass (DQ-03 criterion 5).');
  process.exit(1);
}

// A --from run has no device to ask — it takes the density the original
// capture recorded in its manifest. No readable manifest → null, and the
// a11y pass reports the target sizes as NOT-VERIFIED instead of guessing.
function densityFromManifest(capturesDir) {
  for (const candidate of [path.join(capturesDir, '..', 'manifest.json'), path.join(capturesDir, 'manifest.json')]) {
    try {
      const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      const density = manifest?.a11y?.densityPxPerDp;
      if (typeof density === 'number' && Number.isFinite(density) && density > 0) return density;
    } catch {
      // missing or unreadable manifest — try the next candidate
    }
  }
  return null;
}

// Group aliases of --surface: the spec §9.1 acceptance command names the
// groups, not the individual surfaces. Each alias expands against the full
// matrix, never a hand-maintained list.
const SURFACE_ALIASES = Object.freeze({
  'guide-card': (surfaces) => surfaces.filter((surface) => surface.story),
  explore: (surfaces) => surfaces.filter((surface) => /^explore-/.test(surface.id)),
});

function selectSurfaces(matrix, surfaceArg) {
  if (surfaceArg === null) return matrix.surfaces;
  const requested = surfaceArg.split(',').map((name) => name.trim()).filter(Boolean);
  if (requested.length === 0) {
    console.error('--surface selected nothing (example: --surface guide-card,explore)');
    process.exit(2);
  }
  const unknown = requested.filter(
    (name) => !SURFACE_ALIASES[name] && !matrix.surfaces.some((surface) => surface.id === name),
  );
  if (unknown.length > 0) {
    console.error(`unknown surface(s): ${unknown.join(', ')} (known: guide-card, explore, ${matrix.surfaces.map((surface) => surface.id).join(', ')})`);
    process.exit(2);
  }
  const selected = [];
  const seen = new Set();
  for (const name of requested) {
    for (const surface of SURFACE_ALIASES[name] ? SURFACE_ALIASES[name](matrix.surfaces) : [matrix.surfaces.find((surface) => surface.id === name)]) {
      if (!seen.has(surface.id)) {
        seen.add(surface.id);
        selected.push(surface);
      }
    }
  }
  return selected;
}

async function runCheck(args) {
  const matrix = loadMatrix();
  const surfaces = selectSurfaces(matrix, args.surfaceArg);
  const filteredMatrix = { ...matrix, surfaces };
  const slots = allSlots(filteredMatrix);

  const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const outDir = args.out ?? path.join(ARTIFACTS_ROOT, `${runId}-visual`);
  fs.mkdirSync(outDir, { recursive: true });
  const capturesDir = args.from ?? path.join(outDir, 'captures');
  const mode = args.from ? 'from' : 'capture';
  let device = null;
  let apkSha256 = null;
  let driver = null;
  let densityPxPerDp = null;

  if (mode === 'capture') {
    // Hard prerequisites (criterion 5): resolveTarget answers with a skip
    // reason for every missing piece — here a skip reason is a failure.
    const adbPath = resolveAdb();
    if (adbPath === null) failToRun('adb not found (set KUDY_ADB or ANDROID_HOME, or install platform-tools)');
    const devices = await listBootedDevices(adbPath);
    const chosen = args.serial ?? process.env.KUDY_E2E_SERIAL ?? null;
    if (chosen === null && devices.filter((name) => /^emulator-\d+$/.test(name)).length === 0) {
      failToRun(`no booted emulator found; adb devices: [${devices.join(', ') || 'none'}]`);
    }
    const target = await resolveTarget({ serial: args.serial, apk: args.apk });
    if (target.skip !== undefined) failToRun(target.skip);
    driver = new E2eDriver({ adbPath: target.adbPath, serial: target.serial, artifactsDir: path.join(outDir, 'driver'), pkg: APP_PACKAGE });
    device = {
      model: await getprop(driver, 'ro.product.model'),
      api: Number(await getprop(driver, 'ro.build.version.sdk')),
      serial: target.serial,
    };
    apkSha256 = fs.existsSync(target.apkPath) ? sha256File(target.apkPath) : null;
    // DQ-06: the dump bounds are px — the dp math needs the panel density.
    const densityProp = Number(await getprop(driver, 'ro.sf.lcd_density'));
    densityPxPerDp = Number.isFinite(densityProp) && densityProp > 0 ? densityProp / 160 : null;
    if (!target.skipInstall) {
      console.log(`-- installing ${APP_PACKAGE} from ${target.apkPath}`);
      await driver.install(target.apkPath);
      // DQ-01: a heavy install window can leave SystemUI in an ANR — the
      // pause plus the Wait-button guard below keep the capture honest.
      await sleep(INSTALL_SETTLE_MS);
    }
  }

  const commit = await gitCommit();
  if (mode !== 'capture' && densityPxPerDp === null) {
    densityPxPerDp = densityFromManifest(capturesDir);
  }
  let results;
  if (mode === 'capture') {
    console.log('-- capturing the V1 matrix (light theme, font 1/1.5, locale be) — this starts Metro and the origin');
    await captureAll({
      driver,
      matrix: filteredMatrix,
      capturesDir,
      metroPort: args.metroPort,
      originPort: args.originPort,
      logDir: outDir,
    });
  }
  results = slots.map(({ slot, surface, story, scale, locale, fixture }) => {
    const currentPath = path.join(capturesDir, captureFileName(slot));
    const baselinePath = path.join(args.baselinesDir, `${slot}.png`);
    const base = { slot, surface, story, scale, locale, fixture, currentPath, baselinePath };
    if (!fs.existsSync(currentPath)) {
      return { ...base, verdict: 'FAIL', reason: `capture file missing: ${currentPath}`, diffPixels: null, diffFraction: null };
    }
    if (!fs.existsSync(baselinePath)) {
      return {
        ...base,
        verdict: 'NOT-VERIFIED',
        reason: 'узору няма — базавая лінія для гэтага слота яшчэ не створаная (`--update` піша яе; ухваляе ўладальнік, DQ-04)',
        diffPixels: null,
        diffFraction: null,
      };
    }
    const comparison = comparePair({ baselinePath, currentPath });
    let diffImagePath = null;
    if (comparison.diffImage) {
      diffImagePath = path.join(outDir, `${slot.replace('@', '_')}.diff.png`);
      fs.writeFileSync(diffImagePath, comparison.diffImage);
    }
    return { ...base, ...comparison, diffImagePath };
  });

  // DQ-06: measured accessibility facts from the captured dumps (spec §5,
  // §6.2). The registry reads hitSlop from the sources on every run — a new
  // hitSlop site is picked up without touching this file; a site that
  // cannot bind to a testID is NOT-VERIFIED, never silently ignored.
  const slopRegistry = readHitSlops(listHitSlopSources(REPO_ROOT));
  const a11yFindings = [];
  for (const entry of slopRegistry) {
    if (entry.slop === null) {
      a11yFindings.push({ slot: null, class: 'NOT-VERIFIED', rule: null, measured: null, requires: 'чытэльнае значэнне hitSlop у кодзе', evidence: entry.source });
    } else if (entry.testID === null && entry.testIDPrefix === null) {
      a11yFindings.push({ slot: null, class: 'NOT-VERIFIED', rule: null, measured: null, requires: 'прывязка hitSlop да testID (літарал, шаблон альбо сайты выкліку)', evidence: entry.source });
    }
  }
  // The real capture layout (captureAll) writes dumps into the run's driver
  // artifacts directory — from a `--from <captures-dir>` session that is
  // `<captures>/../driver`. The other candidates serve hand-made --from
  // directories and unit tests.
  const dumpDirs = [path.join(outDir, 'driver'), path.join(capturesDir, '..', 'driver'), capturesDir, path.join(capturesDir, 'driver')];
  for (const slotEntry of slots) {
    const dumpName = dumpBasenameForSlot(slotEntry);
    const dumpPath = dumpDirs.map((dir) => path.join(dir, dumpName)).find((candidate) => fs.existsSync(candidate));
    if (dumpPath === undefined) {
      a11yFindings.push({ slot: slotEntry.slot, class: 'NOT-VERIFIED', rule: null, measured: null, requires: dumpName, evidence: `шукалі ў: ${dumpDirs.join(', ')}` });
      continue;
    }
    const tree = parseA11yTree(fs.readFileSync(dumpPath, 'utf8'));
    for (const message of tree.diagnostics) {
      a11yFindings.push({ slot: slotEntry.slot, class: 'NOT-VERIFIED', rule: null, measured: null, requires: 'цэласны дамп', evidence: `${dumpName}; ${message}` });
    }
    for (const finding of checkA11y({ clickable: tree.clickable, pxPerDp: densityPxPerDp, registry: slopRegistry, dumpName })) {
      a11yFindings.push({ slot: slotEntry.slot, ...finding });
    }
  }
  const a11y = {
    densityPxPerDp,
    hitSlopSources: slopRegistry.filter((entry) => entry.slop !== null).map((entry) => entry.source),
    findings: a11yFindings,
  };

  // The baseline guard (criterion 2): this is the only call site, and it is
  // reached only when the flag is present — a run without `--update` leaves
  // the baselines directory untouched.
  if (args.update) {
    const written = writeBaselines({ slots, capturesDir, baselinesDir: args.baselinesDir });
    console.log(`-- baselines written: ${written.length} (owner approval pending, DQ-04)`);
  }

  const { report, verdictLine, counts, a11yCounts } = buildReport({ results, outDir, baselinesDir: args.baselinesDir, mode, a11y });
  fs.writeFileSync(path.join(outDir, 'report.md'), report);
  const manifest = buildManifest({ mode, results, matrix: filteredMatrix, device, commit, apkSha256, baselinesDir: args.baselinesDir, a11y });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(verdictLine);
  if (a11yCounts !== null) {
    console.log(`a11y — ${A11Y_ORDER.map((cls) => `${cls} ${a11yCounts[cls]}`).join(' · ')}`);
  }
  console.log(`report: ${path.join(outDir, 'report.md')}`);
  console.log(`manifest: ${path.join(outDir, 'manifest.json')}`);
  // A RULE finding blocks like a pixel FAIL: it is a violated accepted rule
  // (spec §6.4). OPINION and NOT-VERIFIED never block.
  const blocked = counts.DIFF + counts.FAIL + (a11yCounts?.RULE ?? 0);
  process.exit(blocked > 0 ? 1 : 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    await runCheck(args);
  } catch (error) {
    failToRun(error instanceof Error ? error.message : String(error));
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) await main();
