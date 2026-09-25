// G05.01.d (issue #201) — criterion 1's count comparison: every scenario the
// frozen model suite (docs/run-model/run-model.test.mjs) registers must also
// run in the ported parity suite (core/engine/model-parity.test.ts), under the
// model's own title. Both sides come from real runs — never a hand-typed
// number. The parity suite runs from a byte-identical temporary copy, so the
// engine zone spawns nothing; run-model files are frozen (19 §7.2) and only
// executed. Standalone, like the model's check-regressions.mjs: both suites
// run end to end here, so this is not part of npm test.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const engineDir = fileURLToPath(new URL('../../core/engine/', import.meta.url));
const modelTest = fileURLToPath(new URL('../../docs/run-model/run-model.test.mjs', import.meta.url));

// The engine files the parity suite loads at runtime.
const ENGINE_FILES = ['reducer.ts', 'state.ts', 'model-parity.test.ts'];

function topTitles(label, args) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 600_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${label} must pass before the count comparison`);
  // Top-level TAP lines only: subtests print indented, the anchors exclude them.
  const titles = [...result.stdout.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  assert.ok(titles.length > 0, `${label} must report its tests`);
  return new Set(titles);
}

const modelTitles = topTitles('the model suite', [
  '--test',
  '--experimental-strip-types',
  '--test-reporter=tap',
  modelTest,
]);

const directory = mkdtempSync(join(tmpdir(), 'kudy-parity-count-'));
try {
  for (const name of ENGINE_FILES) {
    writeFileSync(join(directory, name), readFileSync(join(engineDir, name), 'utf8'));
  }
  const portedTitles = topTitles('the ported parity suite', [
    '--test',
    '--experimental-strip-types',
    '--test-reporter=tap',
    join(directory, 'model-parity.test.ts'),
  ]);

  const missing = [...modelTitles].filter((title) => !portedTitles.has(title));
  assert.deepEqual(missing, [], 'every model scenario must be ported under its own title');
  console.log(
    `the model registers ${modelTitles.size} scenarios; the ported suite registers `
      + `${portedTitles.size} tests — all ${modelTitles.size} model scenarios are ported, `
      + `plus ${portedTitles.size - modelTitles.size} property tests.`,
  );
  console.log(`PARITY COUNT: ${modelTitles.size}/${modelTitles.size} — every model scenario is ported.`);
} finally {
  for (const name of ENGINE_FILES) {
    try { unlinkSync(join(directory, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  rmdirSync(directory);
}
