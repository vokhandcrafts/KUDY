// DQ-06 (issue #916) — the a11y unit suite on dump fixtures. The three
// acceptance criteria live here: a seeded unlabeled icon button is caught
// as RULE (canon §9), a labelled one is not, and a hitSlop link produces
// no target finding — the effective target accounts for the hitSlop the
// registry read from code, including the real repo sources (spec §9.7).
// The CLI half proves the report wiring: the a11y counts line, the §6.4
// finding block, the manifest field and the blocking exit on RULE.
import assert from 'node:assert/strict';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { PNG } from 'pngjs';

import {
  MIN_TARGET_DP,
  checkA11y,
  hitSlopForId,
  listHitSlopSources,
  parseA11yTree,
  parseBounds,
  parseHitSlopValue,
  readHitSlops,
} from './visual-a11y.mjs';
import { dumpBasenameForSlot } from './visual-check.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'tools', 'e2e-android', 'visual-check.mjs');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}

// ---------- dump fixtures (uiautomator XML) ----------

function dumpXml(nodes) {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<hierarchy rotation="0">\n${nodes.join('\n')}\n</hierarchy>`;
}

function clickable(id, bounds, { desc = '', text = '', children = [] } = {}) {
  return (
    `<node text="${text}" resource-id="${id}" class="android.view.View" content-desc="${desc}" ` +
    `clickable="true" bounds="${bounds}">${children.join('')}</node>`
  );
}

function leaf({ text = '', desc = '', cls = 'android.widget.ImageView', bounds = '[0,0][0,0]' } = {}) {
  return (
    `<node text="${text}" resource-id="" class="${cls}" content-desc="${desc}" ` +
    `clickable="false" bounds="${bounds}" />`
  );
}

// ---------- parseBounds ----------

test('parseBounds reads the uiautomator rectangle and rejects garbage', () => {
  assert.deepEqual(parseBounds('[10,20][58,148]'), { x: 10, y: 20, width: 48, height: 128 });
  assert.equal(parseBounds('мусор'), null);
  assert.equal(parseBounds(null), null);
});

// ---------- the label rule (criterion 1 + 3a/3b) ----------

test('a seeded unlabeled icon button is caught as RULE citing canon §9', () => {
  const xml = dumpXml([
    clickable('probe/icon-send', '[10,100][58,148]', { children: [leaf({ bounds: '[18,108][50,140]' })] }),
  ]);
  const findings = checkA11y({ clickable: parseA11yTree(xml).clickable, pxPerDp: 2, registry: [], dumpName: 'dump-fixture.xml' });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].class, 'RULE');
  assert.match(findings[0].rule, /visual-language\.md §9/);
  assert.match(findings[0].rule, /screen-reader подпісы на кожнай icon-only кнопцы/);
  assert.match(findings[0].evidence, /dump-fixture\.xml; probe\/icon-send/);
});

test('a content-desc label and a text child both keep the button silent', () => {
  // Full-size targets (96×98 dp): only the label behaviour is under test here.
  const xml = dumpXml([
    clickable('probe/labeled', '[10,100][202,296]', { desc: 'Адкрыць' }),
    clickable('probe/text-child', '[10,300][202,496]', { children: [leaf({ text: 'Побач', cls: 'android.widget.TextView' })] }),
  ]);
  const findings = checkA11y({ clickable: parseA11yTree(xml).clickable, pxPerDp: 2, registry: [], dumpName: 'dump-fixture.xml' });
  assert.deepEqual(findings, []);
});

// The tree parser itself is fail-closed: garbage in, diagnostics out.
test('parseA11yTree reports what it could not read', () => {
  const partial = parseA11yTree('<hierarchy><node text="a" resource-id="x" class="c" content-desc="" clickable="true" bounds="[0,0][4,4]" />');
  assert.equal(partial.clickable.length, 1);
  const broken = parseA11yTree(dumpXml(['<node text="" resource-id="y" class="c" content-desc="" clickable="true" bounds="[0,0][4,4]">']));
  assert.ok(broken.diagnostics.length > 0);
  assert.ok(parseA11yTree(42).diagnostics.length > 0);
});

// ---------- the target rule (criterion 1b + 2) ----------

test('a clickable node below 48 dp without hitSlop is OPINION, not RULE', () => {
  const xml = dumpXml([clickable('probe/tiny', '[0,0][24,24]', { desc: 'дробная' })]);
  const findings = checkA11y({ clickable: parseA11yTree(xml).clickable, pxPerDp: 2, registry: [], dumpName: 'dump-fixture.xml' });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].class, 'OPINION');
  assert.match(findings[0].rule, /§12, пытанне 4/);
  assert.match(findings[0].measured, /12×12 dp/);
});

test('the effective target accounts for hitSlop — an Explore link stays silent (§9.7)', () => {
  const registry = readHitSlops([{ file: 'app/(tabs)/explore.tsx', code: EXPLORE_SOURCE }]);
  // 48 px = 24 dp visible at density 2; hitSlop 12 dp on every side lifts
  // the effective target to exactly 48 dp — measured, not flagged.
  const xml = dumpXml([clickable('link-nearby', '[10,10][58,58]', { children: [leaf({ text: 'Побач', cls: 'android.widget.TextView' })] })]);
  const findings = checkA11y({ clickable: parseA11yTree(xml).clickable, pxPerDp: 2, registry, dumpName: 'dump-explore-a-font1.xml' });
  assert.deepEqual(findings, []);
  // The same node without the hitSlop credit is below the minimum.
  const withoutSlop = checkA11y({ clickable: parseA11yTree(xml).clickable, pxPerDp: 2, registry: [], dumpName: 'dump-explore-a-font1.xml' });
  assert.equal(withoutSlop.length, 1);
  assert.equal(withoutSlop[0].class, 'OPINION');
});

test('an unknown density disables the size check, bounds garbage is NOT-VERIFIED', () => {
  const xml = dumpXml([clickable('probe/tiny', '[0,0][24,24]', { desc: 'дробная' }), clickable('probe/broken', '[0,0][x,y]', { desc: 'ламаная' })]);
  const findings = checkA11y({ clickable: parseA11yTree(xml).clickable, pxPerDp: null, registry: [], dumpName: 'd.xml' });
  assert.deepEqual(findings, []);
  const withDensity = checkA11y({ clickable: parseA11yTree(xml).clickable, pxPerDp: 2, registry: [], dumpName: 'd.xml' });
  assert.equal(withDensity.filter((finding) => finding.class === 'OPINION').length, 1);
  assert.equal(withDensity.filter((finding) => finding.class === 'NOT-VERIFIED').length, 1);
});

test(`MIN_TARGET_DP is the spec value 48`, () => {
  assert.equal(MIN_TARGET_DP, 48);
});

// ---------- hitSlop from code (criterion 2) ----------

const EXPLORE_SOURCE = `import { PressableSurface } from 'kudy-ui';

function SurfaceLink({ href, label, testID }: { href: string; label: string; testID: string }) {
  return (
    <PressableSurface accessibilityRole="link" accessibilityLabel={label} hitSlop={12} style={styles.middleRow} testID={testID}>
      <ScaledText style={styles.middleLink}>{label}</ScaledText>
    </PressableSurface>
  );
}

<SurfaceLink href="/map" label={strings.nearby} testID="link-nearby" />;
<SurfaceLink href="/discovery" label={strings.whatToDo} testID="link-discovery" />;
<SurfaceLink href="/my" label={strings.kudyLink} testID="link-kudy" />;
`;

test('readHitSlops binds a literal testID on the same tag', () => {
  const registry = readHitSlops([{ file: 'components/guide-card.tsx', code: '<PressableSurface accessibilityLabel={x} hitSlop={12} testID="link-guides">' }]);
  assert.equal(registry.length, 1);
  assert.equal(registry[0].testID, 'link-guides');
  assert.deepEqual(registry[0].slop, { top: 12, right: 12, bottom: 12, left: 12 });
  assert.equal(registry[0].source, 'components/guide-card.tsx:1');
});

test('readHitSlops resolves a testID prop variable through same-file call sites', () => {
  const registry = readHitSlops([{ file: 'app/(tabs)/explore.tsx', code: EXPLORE_SOURCE }]);
  assert.deepEqual(
    registry.map((entry) => entry.testID).sort(),
    ['link-discovery', 'link-kudy', 'link-nearby'],
  );
  for (const entry of registry) assert.deepEqual(entry.slop, { top: 12, right: 12, bottom: 12, left: 12 });
});

test('readHitSlops turns a template testID into a prefix binding', () => {
  const source =
    '<PressableSurface\n  style={styles.playButton}\n  hitSlop={{ top: 4, bottom: 4 }}\n' +
    '  testID={`place-moment-resume-${moment.momentId}`}\n  onPress={resume}\n/>';
  const registry = readHitSlops([{ file: 'app/place/[id].tsx', code: source }]);
  assert.equal(registry.length, 1);
  assert.equal(registry[0].testID, null);
  assert.equal(registry[0].testIDPrefix, 'place-moment-resume-');
  assert.deepEqual(registry[0].slop, { top: 4, right: 0, bottom: 4, left: 0 });
  assert.equal(hitSlopForId('place-moment-resume-42', registry).top, 4);
  assert.equal(hitSlopForId('place-moment-other-42', registry), null);
});

test('readHitSlops reports unbindable and unreadable hitSlop instead of guessing', () => {
  const unbound = readHitSlops([{ file: 'a.tsx', code: '<Pressable hitSlop={12} onPress={go}>' }]);
  assert.deepEqual(unbound, [{ testID: null, testIDPrefix: null, slop: { top: 12, right: 12, bottom: 12, left: 12 }, source: 'a.tsx:1' }]);
  const garbage = readHitSlops([{ file: 'b.tsx', code: '<Pressable hitSlop={oops} testID="x">' }]);
  assert.equal(garbage[0].slop, null);
  const braces = readHitSlops([{ file: 'c.tsx', code: '<Pressable hitSlop={{ weird: 1 }} testID="x">' }]);
  assert.equal(braces[0].slop, null);
});

test('call-site resolution never binds a tag outside every function body', () => {
  // An arrow component after a closed declaration must not inherit the
  // declaration's call sites — a wrong bind would grant hitSlop credit to a
  // node the code never slops (review finding, hitSlop-misbinding).
  const source = [
    'function LegacyBanner() {',
    '  return <Pressable hitSlop={8} testID="probe-banner">;',
    '}',
    '',
    'const Chip = (props) => (',
    '  <Pressable hitSlop={12} testID={chipID}>',
    ');',
  ].join('\n');
  const registry = readHitSlops([{ file: 'd.tsx', code: source }]);
  assert.deepEqual(
    registry.map((entry) => [entry.testID, entry.testIDPrefix]),
    [['probe-banner', null], [null, null]],
  );
});

test('hitSlopForId prefers an exact testID over a longer registry of prefixes', () => {
  const registry = [
    { testID: 'link-guides', testIDPrefix: null, slop: { top: 1, right: 1, bottom: 1, left: 1 }, source: 'a:1' },
    { testID: null, testIDPrefix: 'link-', slop: { top: 2, right: 2, bottom: 2, left: 2 }, source: 'b:2' },
  ];
  assert.deepEqual(hitSlopForId('link-guides', registry).top, 1);
  assert.deepEqual(hitSlopForId('link-other', registry).top, 2);
  assert.equal(hitSlopForId('elsewhere', registry), null);
  assert.equal(hitSlopForId('', registry), null);
});

// ---------- the real repo registry (drift guard, implementation-rules 2) ----------

test('the real sources bind every V1 hitSlop site the spec names', () => {
  const registry = readHitSlops(listHitSlopSources(REPO_ROOT));
  const byId = (id) => registry.find((entry) => entry.testID === id);
  const allSides = (n) => ({ top: n, right: n, bottom: n, left: n });
  assert.deepEqual(byId('link-guides')?.slop, allSides(12));
  assert.deepEqual(byId('link-nearby')?.slop, allSides(12));
  assert.deepEqual(byId('link-discovery')?.slop, allSides(12));
  assert.deepEqual(byId('link-kudy')?.slop, allSides(12));
  assert.deepEqual(byId('map-attribution')?.slop, allSides(8));
  const byPrefix = (prefix) => registry.find((entry) => entry.testIDPrefix === prefix);
  assert.equal(byPrefix('place-moment-resume-')?.slop.top, 4);
  assert.equal(byPrefix('place-moment-play-')?.slop.bottom, 4);
  assert.deepEqual(byPrefix('place-moment-guide-')?.slop, allSides(12));
  // back-button carries hitSlop but binds to no testID in the same file —
  // it must surface as NOT-VERIFIED, never silently vanish.
  const back = registry.find((entry) => entry.source.startsWith('components/back-button.tsx:'));
  assert.ok(back, 'back-button hitSlop must be in the registry');
  assert.equal(back.testID, null);
  assert.equal(back.testIDPrefix, null);
  assert.deepEqual(back.slop, allSides(8));
});

// ---------- dump names (implementation-rules 2: one definition) ----------

test('dumpBasenameForSlot names the files captureAll writes', () => {
  assert.equal(dumpBasenameForSlot({ surface: 'explore-a', story: null, scale: 1 }), 'dump-explore-a-font1.xml');
  assert.equal(dumpBasenameForSlot({ surface: 'explore-b', story: null, scale: 1.5 }), 'dump-explore-b-font1.5.xml');
  assert.equal(dumpBasenameForSlot({ surface: 'guide-card-free', story: 'free', scale: 1 }), 'dump-story-free-font1.xml');
});

// ---------- CLI wiring ----------

const SIZE = [108, 240];

function solidPng(width, height, [r, g, b]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 120000, cwd: REPO_ROOT });
}

// One --from run seeded the same way every CLI test: identical captures and
// baselines for both explore-a slots, optional density manifest, optional
// dump content for both slots (null = no dumps at all). `layout: 'driver'`
// seeds the REAL capture layout — dumps in `<dir>/driver`, captures in
// `<dir>/captures` — so a --from session must find them through
// `<captures>/../driver`; the default 'captures' layout is what hand-made
// --from directories and the earlier tests use.
function seedExploreRun({ dir, color, density = null, dump = null, layout = 'captures' }) {
  const capturesDir = path.join(dir, 'captures');
  const baselinesDir = path.join(dir, 'baselines');
  const dumpDir = layout === 'driver' ? path.join(dir, 'driver') : capturesDir;
  fs.mkdirSync(capturesDir, { recursive: true });
  fs.mkdirSync(baselinesDir, { recursive: true });
  fs.mkdirSync(dumpDir, { recursive: true });
  if (density !== null) {
    fs.writeFileSync(path.join(capturesDir, 'manifest.json'), `${JSON.stringify({ a11y: { densityPxPerDp: density } })}\n`);
  }
  for (const scale of [1, 1.5]) {
    if (dump !== null) {
      fs.writeFileSync(path.join(dumpDir, dumpBasenameForSlot({ surface: 'explore-a', story: null, scale })), dump);
    }
    fs.writeFileSync(path.join(capturesDir, `explore-a_font${scale}-be.png`), solidPng(...SIZE, color));
    fs.writeFileSync(path.join(baselinesDir, `explore-a@font${scale}-be.png`), solidPng(...SIZE, color));
  }
  return { capturesDir, baselinesDir };
}

// Seed a --from fixture, run the CLI against it and return the result with
// a lazy report reader — the one shape every CLI test asserts on.
function runFromFixture({ name, color = [7, 7, 7], density = 2, dump = null, layout = 'captures' }) {
  const dir = tmpDir(name);
  const outDir = path.join(dir, 'out');
  const { capturesDir, baselinesDir } = seedExploreRun({ dir, color, density, dump, layout });
  const result = runCli(['--from', capturesDir, '--baselines-dir', baselinesDir, '--out', outDir, '--surface', 'explore-a']);
  return { result, outDir, report: () => fs.readFileSync(path.join(outDir, 'report.md'), 'utf8') };
}

// A --from run over fixture dumps: the unlabeled icon button in both slots
// is a RULE, the run exits non-zero and the manifest carries the findings.
test('CLI --from reports dump RULE findings, blocks the exit and fills the manifest', () => {
  const { result, outDir, report } = runFromFixture({
    name: 'a11y-rule-',
    dump: dumpXml([clickable('probe/icon-send', '[10,100][58,148]')]),
  });
  assert.equal(result.status, 1, `stderr: ${result.stderr}`);
  // The +1 NOT-VERIFIED is the registry-level unbound back-button hitSlop —
  // every run states it openly instead of silently ignoring the site.
  assert.match(result.stdout, /a11y — RULE 2 · OPINION 0 · NOT-VERIFIED 1/);
  assert.match(report(), /## Даступнасць \(дамп\)/);
  assert.match(report(), /\[RULE\] explore-a@font1-be/);
  assert.match(report(), /screen-reader подпісы на кожнай icon-only кнопцы/);
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.a11y.densityPxPerDp, 2);
  assert.equal(manifest.a11y.findings.filter((finding) => finding.class === 'RULE').length, 2);
  assert.ok(manifest.a11y.hitSlopSources.some((source) => source.startsWith('app/(tabs)/explore.tsx:')));
});

test('CLI --from without dumps is NOT-VERIFIED per slot and does not block', () => {
  const { result } = runFromFixture({ name: 'a11y-nodump-', color: [8, 8, 8], density: null });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /a11y — RULE 0 · OPINION 0 · NOT-VERIFIED 3/);
});

test('CLI --from measures an OPINION for a small labelled node outside the registry', () => {
  const { result, report } = runFromFixture({
    name: 'a11y-opinion-',
    color: [9, 9, 9],
    dump: dumpXml([clickable('probe/tiny', '[0,0][24,24]', { desc: 'дробная' })]),
  });
  assert.equal(result.status, 0, 'an OPINION never blocks');
  assert.match(result.stdout, /a11y — RULE 0 · OPINION 2 · NOT-VERIFIED 1/);
  assert.match(report(), /\[OPINION\] explore-a@font1-be/);
  assert.match(report(), /эфектыўная з hitSlop 12×12 dp/);
});

// The real capture layout: dumps live in `<dir>/driver`, the --from call
// points at `<dir>/captures` — the run must find them through
// `<captures>/../driver` or the a11y pass silently degrades to NOT-VERIFIED.
test('CLI --from finds the dumps of a real capture run through captures/../driver', () => {
  const { result, report } = runFromFixture({
    name: 'a11y-driver-',
    dump: dumpXml([clickable('probe/icon-send', '[10,100][58,148]')]),
    layout: 'driver',
  });
  assert.equal(result.status, 1, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /a11y — RULE 2 · OPINION 0 · NOT-VERIFIED 1/);
  assert.match(report(), /\[RULE\] explore-a@font1-be/);
});

// A truncated dump must surface as NOT-VERIFIED with a reason, never vanish
// into a clean verdict (implementation-rules 14).
test('CLI --from reports a corrupt dump as NOT-VERIFIED (цэласны дамп)', () => {
  const { result, report } = runFromFixture({
    name: 'a11y-corrupt-',
    color: [8, 8, 8],
    dump: '<hierarchy rotation="0"><node text="" resource-id="probe/x" class="c" content-desc="" clickable="true" bounds="[0,0][24,24]">',
  });
  assert.equal(result.status, 0, 'NOT-VERIFIED never blocks');
  assert.match(result.stdout, /a11y — RULE 0 · OPINION 0 · NOT-VERIFIED 3/);
  assert.match(report(), /цэласны дамп/);
});
