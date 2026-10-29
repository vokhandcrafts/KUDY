// Executable regression proof against the independent frozen acceptance suite.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = await readFile(new URL('./tap-drag.mjs', import.meta.url), 'utf8');
const tests = await readFile(new URL('./tap-drag.test.mjs', import.meta.url), 'utf8');
const directory = await mkdtemp(join(tmpdir(), 'kudy-map07-'));
try {
  await writeFile(join(directory, 'tap-drag.test.mjs'), tests);
  const variants = [
    ['original', null, null, 0],
    ['disabled navigates', 'if (tap && !disabled)', 'if (tap)', 1],
    ['drag navigates', '&& !gesture.dragging', '', 1],
    ['movement removed', 'onMove({ ...current });', 'current = { ...gesture.origin };', 1],
  ];
  for (const [name, before, after, expected] of variants) {
    if (before) assert.ok(source.includes(before), `mutation target missing: ${name}`);
    await writeFile(join(directory, 'tap-drag.mjs'), before ? source.replace(before, after) : source);
    const result = spawnSync(process.execPath, ['--test', 'tap-drag.test.mjs'], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, expected, result.stdout + result.stderr);
    if (expected) assert.match(result.stdout + result.stderr, /AssertionError/);
    console.log(`${name}: ${expected ? 'rejected' : 'passed'}`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
