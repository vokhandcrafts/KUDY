// DQ-03 (issue #913) — the visual:check unit suite. Every device-free
// acceptance criterion is exercised here on synthetic PNG pairs: identical
// → PASS, a changed block → DIFF with a diff image, a size mismatch → an
// explicit FAIL (criterion 3); the baseline guard — a run without
// `--update` never writes a baseline, the flag does (criterion 2); the CLI
// fail-closed contract — missing adb, no booted emulator or a missing APK
// exits non-zero with the reason and never reports a pass (criterion 5).
// The story-matrix baseline check (criterion 4) lives in
// visual-baselines.test.mjs, wired into the same npm-test glob.
import assert from 'node:assert/strict';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { PNG } from 'pngjs';

import {
  COMPARISON,
  DEFAULT_BASELINES_DIR,
  allSlots,
  captureFileName,
  comparePair,
  loadMatrix,
  parseStoryNames,
  slotId,
  storySurfacesFromNames,
  writeBaselines,
} from './visual-check.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'tools', 'e2e-android', 'visual-check.mjs');
const STORIES_FILE = path.join(REPO_ROOT, 'components', 'guide-card.stories.tsx');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}

// A deterministic PNG: a uniform fill plus optional solid blocks — no
// randomness anywhere, so two runs produce byte-identical images.
function makePng(width, height, [r, g, b], blocks = []) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const block = blocks.find(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh);
      const color = block ? block[4] : [r, g, b];
      png.data[index] = color[0];
      png.data[index + 1] = color[1];
      png.data[index + 2] = color[2];
      png.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function writePng(dir, name, buffer) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// ---------- matrix ----------

test('parseStoryNames reads the real single-source stories file', () => {
  const names = parseStoryNames(fs.readFileSync(STORIES_FILE, 'utf8'));
  assert.deepEqual(names, ['free', 'paid', 'mixed', 'long-title']);
});

test('parseStoryNames is fail-closed: no names and duplicates both throw', () => {
  assert.throws(() => parseStoryNames('export const stories = [];'), /no story names/);
  assert.throws(() => parseStoryNames('name: "a"\nname: "a"'), /duplicate story names/);
  assert.throws(() => parseStoryNames(null), /must be a string/);
});

test('the V1 matrix slots: 4 stories + 2 screens × 2 scales', () => {
  const matrix = loadMatrix();
  const slots = allSlots(matrix);
  assert.equal(matrix.locale, 'be');
  assert.deepEqual(matrix.scales, [1, 1.5]);
  assert.deepEqual(matrix.surfaces.map((surface) => surface.id), [
    'guide-card-free',
    'guide-card-paid',
    'guide-card-mixed',
    'guide-card-long-title',
    'explore-a',
    'explore-b',
  ]);
  assert.equal(slots.length, 12);
  assert.deepEqual(
    slots.slice(0, 2).map((slot) => slot.slot),
    ['guide-card-free@font1-be', 'guide-card-free@font1.5-be'],
  );
});

test('captureFileName maps the slot id to the driver-safe name and rejects non-slots', () => {
  assert.equal(captureFileName(slotId('explore-a', 1.5, 'be')), 'explore-a_font1.5-be.png');
  assert.throws(() => captureFileName('no-at-sign'), /has no @/);
});

test('storySurfacesFromNames names the surfaces after the stories', () => {
  assert.deepEqual(storySurfacesFromNames(['free']).map((surface) => surface.id), ['guide-card-free']);
});

// ---------- comparison (criterion 3) ----------

const SIZE = [108, 240];

test('comparePair: identical PNGs pass with zero differing pixels', () => {
  const dir = tmpDir('visual-identical-');
  const baselinePath = writePng(dir, 'baseline.png', makePng(...SIZE, [200, 180, 160]));
  const currentPath = writePng(dir, 'current.png', makePng(...SIZE, [200, 180, 160]));
  const result = comparePair({ baselinePath, currentPath });
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.diffPixels, 0);
  assert.equal(result.diffImage, null);
});

test('comparePair: a changed block is a DIFF with a decodable diff image', () => {
  const dir = tmpDir('visual-diff-');
  const baselinePath = writePng(dir, 'baseline.png', makePng(...SIZE, [200, 180, 160]));
  const currentPath = writePng(dir, 'current.png', makePng(...SIZE, [200, 180, 160], [[10, 110, 88, 20, [255, 0, 0]]]));
  const result = comparePair({ baselinePath, currentPath });
  assert.equal(result.verdict, 'DIFF');
  assert.ok(result.diffPixels >= 88 * 20, `diffPixels ${result.diffPixels} must cover the changed block`);
  assert.ok(result.diffImage && result.diffImage.length > 0);
  const decoded = PNG.sync.read(result.diffImage);
  assert.equal(decoded.width, SIZE[0]);
  assert.equal(decoded.height, SIZE[1] - COMPARISON.cropTopPx);
});

test('comparePair: a size mismatch is an explicit FAIL, never a pass', () => {
  const dir = tmpDir('visual-size-');
  const baselinePath = writePng(dir, 'baseline.png', makePng(108, 240, [200, 180, 160]));
  const currentPath = writePng(dir, 'current.png', makePng(108, 234, [200, 180, 160]));
  const result = comparePair({ baselinePath, currentPath });
  assert.equal(result.verdict, 'FAIL');
  assert.match(result.reason, /baseline 108×240, current 108×234/);
  assert.equal(result.diffPixels, null);
});

test('comparePair: a crop taller than the image throws instead of passing', () => {
  const dir = tmpDir('visual-crop-');
  const baselinePath = writePng(dir, 'baseline.png', makePng(108, 50, [1, 2, 3]));
  const currentPath = writePng(dir, 'current.png', makePng(108, 50, [1, 2, 3]));
  assert.throws(() => comparePair({ baselinePath, currentPath }), /leaves no content/);
});

// ---------- baseline guard (criterion 2) ----------

test('writeBaselines copies only the slots that have captures into the baselines dir', () => {
  const dir = tmpDir('visual-guard-');
  const capturesDir = path.join(dir, 'captures');
  const baselinesDir = path.join(dir, 'baselines');
  const slots = [{ slot: slotId('explore-a', 1, 'be') }, { slot: slotId('explore-b', 1, 'be') }];
  writePng(capturesDir, captureFileName(slots[0].slot), makePng(...SIZE, [9, 9, 9]));
  const written = writeBaselines({ slots, capturesDir, baselinesDir });
  assert.equal(written.length, 1);
  assert.ok(fs.existsSync(path.join(baselinesDir, `${slots[0].slot}.png`)));
  assert.ok(!fs.existsSync(path.join(baselinesDir, `${slots[1].slot}.png`)));
});

function runCli(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
  });
}

test('CLI --from without --update never writes a baseline (criterion 2)', () => {
  const dir = tmpDir('visual-noflag-');
  const capturesDir = path.join(dir, 'captures');
  const baselinesDir = path.join(dir, 'baselines');
  const outDir = path.join(dir, 'out');
  const slots = [slotId('explore-a', 1, 'be'), slotId('explore-a', 1.5, 'be')];
  // The first capture differs from its baseline by a 2×2 px block — inside
  // the noise budget (PASS, exit 0) but byte-different, so an unguarded
  // baseline write cannot hide behind identical bytes.
  const baselineBytes = makePng(...SIZE, [1, 2, 3]);
  const captureBytes = makePng(...SIZE, [1, 2, 3], [[10, 110, 2, 2, [9, 9, 9]]]);
  const firstCapture = writePng(capturesDir, captureFileName(slots[0]), captureBytes);
  writePng(capturesDir, captureFileName(slots[1]), makePng(...SIZE, [1, 2, 3]));
  const firstBaseline = writePng(baselinesDir, `${slots[0]}.png`, baselineBytes);
  writePng(baselinesDir, `${slots[1]}.png`, makePng(...SIZE, [1, 2, 3]));
  const result = runCli(['--from', capturesDir, '--baselines-dir', baselinesDir, '--out', outDir, '--surface', 'explore-a'], {});
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(fs.readFileSync(path.join(outDir, 'report.md'), 'utf8'), /PASS 2/);
  // The baseline bytes are untouched by a run without --update.
  assert.deepEqual(fs.readFileSync(firstBaseline), baselineBytes);
  assert.deepEqual(fs.readdirSync(baselinesDir).sort(), slots.map((slot) => `${slot}.png`).sort());
});

test('CLI --from --update writes the baseline from the capture', () => {
  const dir = tmpDir('visual-update-');
  const capturesDir = path.join(dir, 'captures');
  const baselinesDir = path.join(dir, 'baselines');
  const outDir = path.join(dir, 'out');
  const slot = slotId('explore-a', 1, 'be');
  // The second scale slot passes, so the run's only blocker is the seeded
  // change on the first slot — not a missing capture.
  writePng(capturesDir, captureFileName(slotId('explore-a', 1.5, 'be')), makePng(...SIZE, [4, 5, 6]));
  writePng(baselinesDir, `${slotId('explore-a', 1.5, 'be')}.png`, makePng(...SIZE, [4, 5, 6]));
  // The block sits below the 100 px statusbar crop — the compared region.
  const capture = writePng(capturesDir, captureFileName(slot), makePng(...SIZE, [4, 5, 6], [[10, 110, 88, 20, [250, 250, 250]]]));
  writePng(baselinesDir, `${slot}.png`, makePng(...SIZE, [4, 5, 6]));
  const result = runCli(['--from', capturesDir, '--baselines-dir', baselinesDir, '--out', outDir, '--update', '--surface', 'explore-a'], {});
  assert.equal(result.status, 1, 'the +10px block exceeds the noise budget — the run must exit non-zero');
  const report = fs.readFileSync(path.join(outDir, 'report.md'), 'utf8');
  assert.match(report, /DIFF 1/);
  assert.match(report, /PASS 1/);
  assert.deepEqual(fs.readFileSync(path.join(baselinesDir, `${slot}.png`)), fs.readFileSync(capture));
});

// ---------- fail-closed CLI (criterion 5) ----------

const STUB_ADB = [
  '#!/bin/sh',
  'case "$1 $2" in',
  '  "version "*) echo "Android Debug Bridge version 1.0.41"; exit 0;;',
  '  "devices "*) printf \'List of devices attached\\n\'; exit 0;;',
  '  *) exit 0;;',
  'esac',
].join('\n');

const STUB_ADB_WITH_EMULATOR = STUB_ADB.replace(
  "printf 'List of devices attached\\n'",
  "printf 'List of devices attached\\nemulator-5556\\tdevice\\n'",
);

function stubAdb(dir, content) {
  const stubPath = path.join(dir, 'adb-stub');
  fs.writeFileSync(stubPath, content, { mode: 0o755 });
  return stubPath;
}

test('CLI without adb exits non-zero with the reason and never reports a pass', () => {
  const outDir = tmpDir('visual-noadb-');
  const result = runCli(['--out', outDir], { KUDY_ADB: '/nonexistent/adb', ANDROID_HOME: '', PATH: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FAILED TO RUN: adb not found/);
  assert.doesNotMatch(result.stdout, /PASS \d/);
  assert.equal(fs.existsSync(path.join(outDir, 'report.md')), false, 'no verdict file on a failed run');
});

test('CLI without a booted emulator exits non-zero with the reason', () => {
  const dir = tmpDir('visual-noemu-');
  const outDir = path.join(dir, 'out');
  const result = runCli(['--out', outDir], { KUDY_ADB: stubAdb(dir, STUB_ADB), ANDROID_HOME: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FAILED TO RUN: no booted emulator found/);
  assert.doesNotMatch(result.stdout, /PASS \d/);
});

test('CLI without the APK exits non-zero with the reason', () => {
  const dir = tmpDir('visual-noapk-');
  const outDir = path.join(dir, 'out');
  const result = runCli(
    ['--out', outDir, '--apk', '/nonexistent/app-debug.apk'],
    { KUDY_ADB: stubAdb(dir, STUB_ADB_WITH_EMULATOR), ANDROID_HOME: '' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FAILED TO RUN: dev-client APK not found/);
  assert.doesNotMatch(result.stdout, /PASS \d/);
});

test('CLI with an unknown surface name exits with a usage error naming the known surfaces', () => {
  const dir = tmpDir('visual-usage-');
  const outDir = path.join(dir, 'out');
  const result = runCli(['--out', outDir, '--from', dir, '--surface', 'nowhere'], { KUDY_ADB: stubAdb(dir, STUB_ADB), ANDROID_HOME: '' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown surface\(s\): nowhere/);
  assert.match(result.stderr, /guide-card-free/);
});

test('CLI --from with a missing capture file is a FAIL row in the report, not a silent pass', () => {
  const dir = tmpDir('visual-missing-');
  const outDir = path.join(dir, 'out');
  const slot = slotId('explore-a', 1, 'be');
  writePng(path.join(dir, 'captures'), captureFileName(slot), makePng(...SIZE, [1, 2, 3]));
  const result = runCli(['--from', path.join(dir, 'captures'), '--baselines-dir', path.join(dir, 'baselines'), '--out', outDir], {});
  assert.equal(result.status, 1);
  const report = fs.readFileSync(path.join(outDir, 'report.md'), 'utf8');
  assert.match(report, /FAIL 11/);
  assert.match(report, /capture file missing/);
});

test('the default baselines directory is docs/design-qa/baselines (criterion 2)', () => {
  assert.equal(DEFAULT_BASELINES_DIR, path.join(REPO_ROOT, 'docs', 'design-qa', 'baselines'));
});
