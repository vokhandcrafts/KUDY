// Negative tests for the tree-walk trust boundary (implementation-rules 14):
// the interim catalog derivation only accepts packager-shaped entry names and
// fails a tampered tree with a named diagnostic, and the leak guard never
// reads through links in the tree it scans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDemoFixture } from './test-fixture.ts';
import { deriveInterimCatalog } from '../../../contracts/interim-catalog.mjs';
import { scanWebContentInput } from './leak-guard.ts';

// Host-capability probes (the tools/corpus/import.test.mjs pattern, G21.07):
// a capability a security case depends on is probed once at load; an incapable
// host skips that case with the reason named — never silently — and the deny
// assertions on a capable host stay untouched.
let symlinkProblem: string | null = null;
{
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-boundary-symlink-probe-'));
  const probeTarget = path.join(probeRoot, 'target.json');
  fs.writeFileSync(probeTarget, '{}');
  try {
    fs.symlinkSync(probeTarget, path.join(probeRoot, 'probe-link.json'));
  } catch (error) {
    symlinkProblem =
      `symlinks cannot be created on this host (${(error as NodeJS.ErrnoException).code}) — ` +
      'the symlink escape cases need the symlink privilege (Windows: elevated shell or Developer Mode); ' +
      'they stay mandatory on capable platforms';
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
}

let controlNameProblem: string | null = null;
{
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-boundary-control-name-probe-'));
  try {
    fs.mkdirSync(path.join(probeRoot, 'probe\nname'));
  } catch (error) {
    controlNameProblem =
      `filenames with control characters cannot be created on this host (${(error as NodeJS.ErrnoException).code}) — ` +
      'the control-name rejection cases need a filesystem that accepts arbitrary names; ' +
      'they stay mandatory on capable platforms';
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
}

test('an unsafe bundle entry name fails the catalog derivation with a named diagnostic', async () => {
  const { publicRoot } = await buildDemoFixture();
  fs.mkdirSync(path.join(publicRoot, 'bundle', 'bad name'));
  assert.throws(() => deriveInterimCatalog(publicRoot), /unsafe bundle entry name: bundle\/bad name/);
});

test('the leak guard never reads through links in the scanned tree', { skip: symlinkProblem ?? undefined }, async () => {
  const { publicRoot, buildRoot } = await buildDemoFixture();
  const outside = path.join(buildRoot, 'outside.json');
  fs.writeFileSync(outside, JSON.stringify({ audio_path: 'private/bundle/demo-route-a1/1/be/extended/stops.json' }));
  fs.symlinkSync(outside, path.join(publicRoot, 'evil.json'));
  const res = scanWebContentInput({ publicDir: publicRoot });
  assert.deepEqual(res, { ok: true, violations: [] });
});

test('the leak guard never reads through a directory symlink in the scanned tree', { skip: symlinkProblem ?? undefined }, async () => {
  const { publicRoot, buildRoot } = await buildDemoFixture();
  const outsideDir = path.join(buildRoot, 'outside-dir');
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(
    path.join(outsideDir, 'nasty.json'),
    JSON.stringify({ audio_path: 'private/bundle/demo-route-a1/1/be/extended/stops.json' }),
  );
  fs.symlinkSync(outsideDir, path.join(publicRoot, 'linked'));
  const res = scanWebContentInput({ publicDir: publicRoot });
  assert.deepEqual(res, { ok: true, violations: [] });
});

test('a symlinked bundle entry is ignored by the catalog derivation', { skip: symlinkProblem ?? undefined }, async () => {
  const { publicRoot, buildRoot } = await buildDemoFixture();
  const outsideDir = path.join(buildRoot, 'outside-route');
  // A packager-shaped foreign tree: if the walk ever followed the link, the
  // foreign route would enter the catalog, so the fixture carries a real
  // version/route.json, not just a bare route.json.
  fs.mkdirSync(path.join(outsideDir, 'v1'), { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'v1', 'route.json'), JSON.stringify({ route_id: 'evil-route' }));
  fs.symlinkSync(outsideDir, path.join(publicRoot, 'bundle', 'evil'));
  const catalog = deriveInterimCatalog(publicRoot);
  assert.deepEqual(
    catalog.routes.map((route) => route.route_id),
    ['demo-route-a1'],
  );
});

test('a symlink planted on the bundle root itself fails the derivation with a named diagnostic', { skip: symlinkProblem ?? undefined }, async () => {
  const { publicRoot, buildRoot } = await buildDemoFixture();
  const outsideDir = path.join(buildRoot, 'outside-bundle');
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, 'route.json'), JSON.stringify({ route_id: 'evil-route' }));
  fs.rmSync(path.join(publicRoot, 'bundle'), { recursive: true });
  fs.symlinkSync(outsideDir, path.join(publicRoot, 'bundle'));
  assert.throws(() => deriveInterimCatalog(publicRoot), /unsafe bundle entry/);
});

test('a locale entry with a non-identifier name fails the derivation with a named diagnostic', async () => {
  const { publicRoot } = await buildDemoFixture();
  fs.mkdirSync(path.join(publicRoot, 'bundle', 'demo-route-a1', '1', 'bad locale'), { recursive: true });
  assert.throws(
    () => deriveInterimCatalog(publicRoot),
    /unsafe bundle entry name: bundle\/demo-route-a1\/1\/bad locale/,
  );
});

test('a route entry name with a control character fails with the name escaped in the diagnostic', { skip: controlNameProblem ?? undefined }, async () => {
  const { publicRoot } = await buildDemoFixture();
  fs.mkdirSync(path.join(publicRoot, 'bundle', 'bad\nroute'));
  assert.throws(() => deriveInterimCatalog(publicRoot), /unsafe bundle entry name: bundle\/bad\\u000aroute/);
});

test('a locale name with a control character fails with the name escaped in the diagnostic', { skip: controlNameProblem ?? undefined }, async () => {
  const { publicRoot } = await buildDemoFixture();
  fs.mkdirSync(path.join(publicRoot, 'bundle', 'demo-route-a1', '1', 'bad\nname'), { recursive: true });
  assert.throws(
    () => deriveInterimCatalog(publicRoot),
    /unsafe bundle entry name: bundle\/demo-route-a1\/1\/bad\\u000aname/,
  );
});

test('a locale whose base tail is a symlink outside the tree does not enter the catalog', { skip: symlinkProblem ?? undefined }, async () => {
  const { publicRoot, buildRoot } = await buildDemoFixture();
  const versionDir = path.join(publicRoot, 'bundle', 'demo-route-a1', '1');
  const outsideStops = path.join(buildRoot, 'outside-stops.json');
  fs.writeFileSync(outsideStops, '{}');
  fs.mkdirSync(path.join(versionDir, 'evil', 'base'), { recursive: true });
  fs.symlinkSync(outsideStops, path.join(versionDir, 'evil', 'base', 'stops.json'));
  const outsideBase = path.join(buildRoot, 'outside-base');
  fs.mkdirSync(outsideBase);
  fs.writeFileSync(path.join(outsideBase, 'stops.json'), '{}');
  fs.mkdirSync(path.join(versionDir, 'evbase'));
  fs.symlinkSync(outsideBase, path.join(versionDir, 'evbase', 'base'));
  const catalog = deriveInterimCatalog(publicRoot);
  assert.deepEqual(catalog.routes.map((route) => route.route_id), ['demo-route-a1']);
  assert.ok(!catalog.routes[0]!.locales.includes('evil'));
  assert.ok(!catalog.routes[0]!.locales.includes('evbase'));
  assert.deepEqual(catalog.routes[0]!.locales, ['be', 'en', 'uk']);
});

test('a symlink planted on the discovery root itself fails the derivation with a named diagnostic', { skip: symlinkProblem ?? undefined }, async () => {
  const { publicRoot, buildRoot } = await buildDemoFixture();
  const outsideDir = path.join(buildRoot, 'outside-discovery');
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, 'index.json'), JSON.stringify({ revision: 'evil' }));
  fs.rmSync(path.join(publicRoot, 'discovery'), { recursive: true });
  fs.symlinkSync(outsideDir, path.join(publicRoot, 'discovery'));
  assert.throws(() => deriveInterimCatalog(publicRoot), /unsafe bundle entry/);
});

test('a directory symlink inside discovery does not surface a foreign index.json', { skip: symlinkProblem ?? undefined }, async () => {
  const { publicRoot, buildRoot } = await buildDemoFixture();
  const outsideDir = path.join(buildRoot, 'outside-discovery');
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, 'index.json'), JSON.stringify({ revision: 'evil' }));
  fs.symlinkSync(outsideDir, path.join(publicRoot, 'discovery', 'linked'));
  // A second counted index would fail the single-index check; the foreign
  // one behind the link is dropped by the realpath containment filter.
  const catalog = deriveInterimCatalog(publicRoot);
  assert.equal(catalog.discovery_index.revision, 'r-demo-1');
  assert.equal(catalog.discovery_index.path, 'discovery/demo-city/r-demo-1/index.json');
});
