// Negative tests for the tree-walk trust boundary (implementation-rules 14):
// the interim catalog derivation only accepts packager-shaped entry names and
// fails a tampered tree with a named diagnostic, and the leak guard never
// reads through links in the tree it scans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDemoFixture } from './test-fixture.ts';
import { deriveInterimCatalog } from './interim-catalog.ts';
import { scanWebContentInput } from './leak-guard.ts';

test('an unsafe bundle entry name fails the catalog derivation with a named diagnostic', async () => {
  const { publicRoot } = await buildDemoFixture();
  fs.mkdirSync(path.join(publicRoot, 'bundle', 'bad name'));
  assert.throws(() => deriveInterimCatalog(publicRoot), /unsafe bundle entry name: bundle\/bad name/);
});

test('the leak guard never reads through links in the scanned tree', async () => {
  const { publicRoot, buildRoot } = await buildDemoFixture();
  const outside = path.join(buildRoot, 'outside.json');
  fs.writeFileSync(outside, JSON.stringify({ audio_path: 'private/bundle/demo-route-a1/1/be/extended/stops.json' }));
  fs.symlinkSync(outside, path.join(publicRoot, 'evil.json'));
  const res = scanWebContentInput({ publicDir: publicRoot });
  assert.deepEqual(res, { ok: true, violations: [] });
});
