// G23.01 guard tests (issue #659). The fixture must reach the production
// publishing path (build-bundle → publish-catalog), stay valid against the
// package schemas, and lay byte-identical files on every build; the origin
// server must honour the fault switch with visible diagnostics.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { readCatalogDoc } from '../../contracts/reader.mjs';
import { validatePackage, validateDiscoveryIndex } from '../validate/validate-package.mjs';
import {
  E2EOriginError,
  buildE2EOrigin,
  createE2EOriginServer,
  formatOriginSummary,
  parseFaultSpec,
  parsePackageSet,
} from './serve-e2e-origin.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Walks rel → sha256 over every file of a built origin, so two builds can be
// compared byte for byte (criterion 4).
async function digestTree(root) {
  const out = new Map();
  async function walk(rel) {
    const entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true });
    for (const entry of entries) {
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(relChild);
      else {
        const bytes = await fsp.readFile(path.join(root, relChild));
        out.set(relChild, `${bytes.length}:${createHash('sha256').update(bytes).digest('hex')}`);
      }
    }
  }
  await walk('');
  return out;
}

test('both fixture packages validate against the package schemas (criterion 2)', () => {
  for (const pkg of ['free-guide', 'paid-guide']) {
    const report = validatePackage(path.join(REPO_ROOT, 'fixtures', 'e2e', pkg));
    assert.equal(
      report.ok,
      true,
      `fixtures/e2e/${pkg} must validate: ${JSON.stringify(report.errors)}`,
    );
  }
});

test('the guard fails when a fixture stops validating against the schema (criterion 6)', () => {
  const corrupt = tmpDir('kudy-e2e-corrupt-');
  fs.cpSync(path.join(REPO_ROOT, 'fixtures', 'e2e', 'free-guide'), corrupt, { recursive: true });
  const routePath = path.join(corrupt, 'route.json');
  const route = JSON.parse(fs.readFileSync(routePath, 'utf8'));
  route.access = 'bogus'; // route.schema.json enum is ["free_base", "paid"]
  fs.writeFileSync(routePath, JSON.stringify(route, null, 2));
  const report = validatePackage(corrupt);
  assert.equal(report.ok, false, 'a corrupted fixture must fail the package validator');
  assert.ok(report.errors.length > 0, 'the validator must name the violation');
  fs.rmSync(corrupt, { recursive: true, force: true });
});

test('the production publishing path lays a valid two-route catalog (criterion 2)', async () => {
  const out = tmpDir('kudy-e2e-build-');
  const build = await buildE2EOrigin({ outDir: out });
  const catalog = JSON.parse(await fsp.readFile(path.join(build.target, 'catalog.json'), 'utf8'));
  const read = readCatalogDoc(catalog);
  assert.equal(read.status, 'v1');
  assert.equal(read.ok, true);
  const routes = new Map(catalog.routes.map((r) => [r.route_id, r]));
  assert.deepEqual(
    [...routes.keys()].sort(),
    ['e2e-free-guide', 'e2e-paid-guide'],
    'both synthetic guides must be merged into the catalog',
  );
  assert.deepEqual(routes.get('e2e-free-guide').layers, ['base']);
  assert.deepEqual(routes.get('e2e-paid-guide').layers, ['base', 'extended']);
  for (const route of routes.values()) {
    assert.deepEqual(route.locales, ['be', 'en']);
  }
  // The full synthetic city joins the two independently published indexes.
  assert.equal(catalog.discovery_index.path, 'discovery/e2e-city/r-e2e-city-1/index.json');
  const indexBytes = await fsp.readFile(path.join(build.target, catalog.discovery_index.path));
  assert.equal(createHash('sha256').update(indexBytes).digest('hex'), catalog.discovery_index.sha256);
  const index = JSON.parse(indexBytes.toString('utf8'));
  assert.ok(index.offers.some((offer) => offer.offer_id === 'offer-guide-e2e-paid'));
  await fsp.rm(out, { recursive: true, force: true });
});

test('the Android city includes a second downloadable free guide for a live nearby hint', async () => {
  const out = tmpDir('kudy-e2e-nearby-');
  const build = await buildE2EOrigin({ outDir: out, packages: ['paid-guide,nearby-guide,free-guide'] });
  const catalog = JSON.parse(await fsp.readFile(path.join(build.target, 'catalog.json'), 'utf8'));
  assert.deepEqual(catalog.routes.map((route) => route.route_id).sort(),
    ['e2e-free-guide', 'e2e-nearby-guide', 'e2e-paid-guide']);
  assert.equal(catalog.discovery_index.revision, 'r-e2e-city-3');
  const index = JSON.parse(await fsp.readFile(path.join(build.target, catalog.discovery_index.path), 'utf8'));
  assert.equal(validateDiscoveryIndex(index).ok, true);
  assert.ok(index.offers.some((offer) => offer.offer_id === 'offer-guide-e2e-nearby'));
  await fsp.rm(out, { recursive: true, force: true });
});

test('two builds lay byte-identical files (criterion 4)', async () => {
  const first = await buildE2EOrigin({ outDir: tmpDir('kudy-e2e-det-a-') });
  const second = await buildE2EOrigin({ outDir: tmpDir('kudy-e2e-det-b-') });
  const treeA = await digestTree(first.target);
  const treeB = await digestTree(second.target);
  assert.deepEqual(
    [...treeA.keys()].sort(),
    [...treeB.keys()].sort(),
    'both builds must lay the same file set',
  );
  for (const [rel, digest] of treeA) {
    assert.equal(treeB.get(rel), digest, `${rel} must be byte-identical across builds`);
  }
  assert.ok(treeA.get('catalog.json'), 'catalog.json must be part of the compared tree');
  await fsp.rm(first.target, { recursive: true, force: true });
  await fsp.rm(second.target, { recursive: true, force: true });
});

test('parseFaultSpec answers with named diagnostics on bad input (rule 14)', () => {
  assert.deepEqual([...parseFaultSpec(['404:a.json', '500:b/index.json']).entries()],
    [['a.json', '404'], ['b/index.json', '500']]);
  for (const [bad, code] of [
    ['path-without-kind.json', 'fault-missing-kind'],
    ['999:x.json', 'fault-unknown-kind'],
    ['404:', 'fault-unsafe-path'],
    ['404:../etc/passwd', 'fault-unsafe-path'],
    ['404:has space.json', 'fault-unsafe-path'],
    ['', 'fault-empty-entry'],
  ]) {
    assert.throws(() => parseFaultSpec([bad]), (error) => {
      assert.ok(error instanceof E2EOriginError);
      assert.equal(error.code, code);
      return true;
    }, `spec "${bad}" must fail with ${code}`);
  }
  assert.throws(() => parseFaultSpec(['404:x.json', '500:x.json']), (error) => error.code === 'fault-conflict');
});

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('synthetic feedback endpoint authenticates and keeps revisions private per target', async () => {
  const server = createE2EOriginServer({ root: tmpDir('kudy-e2e-feedback-') });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}/functions/v1/feedback`;
  const target = { kind: 'guide', route_id: 'e2e-free-guide', version: '1', locale: 'be' };
  const send = (path, body, secret = 'kudy-synthetic-feedback-secret') => fetch(`${base}${path}`, {
    method: path === '' ? 'PUT' : 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await send('/read', { target }, 'wrong')).status, 401);
    const first = { mutation_id: '00000000-0000-4000-8000-000000000001', target,
      expected_revision: 0, score: 4, reason_codes: [], disclosure_version: 'feedback-disclosure-1' };
    assert.deepEqual(await (await send('', first)).json(), { revision: 1, saved: true });
    assert.deepEqual(await (await send('', first)).json(), { revision: 1, saved: true });
    assert.deepEqual(await (await send('/read', { target })).json(),
      { revision: 1, score: 4, reason_codes: [], deleted: false });
    assert.equal((await send('', { ...first, mutation_id: '00000000-0000-4000-8000-000000000002' })).status, 409);
    const remove = { mutation_id: '00000000-0000-4000-8000-000000000003', target, expected_revision: 1 };
    assert.deepEqual(await (await send('/delete', remove)).json(), { revision: 2, deleted: true });
    assert.deepEqual(await (await send('/read', { target })).json(),
      { revision: 2, score: null, reason_codes: [], deleted: true });
    assert.equal((await fetch(`http://127.0.0.1:${port}/functions/v1/feedback/list`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('synthetic feedback endpoint rejects corrupt bodies and remains usable', async () => {
  const root = tmpDir('kudy-e2e-feedback-invalid-');
  const server = createE2EOriginServer({ root });
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}/functions/v1/feedback`;
  const headers = {
    authorization: 'Bearer kudy-synthetic-feedback-secret',
    'content-type': 'application/json',
  };
  try {
    const broken = await fetch(url, { method: 'PUT', headers, body: '{"target":' });
    assert.equal(broken.status, 422);
    assert.deepEqual(await broken.json(), { error: 'invalid_request' });
    const invalidTarget = await fetch(`${url}/read`, {
      method: 'POST', headers,
      body: JSON.stringify({ target: { kind: 'guide', route_id: 7, version: '1', locale: 'be' } }),
    });
    assert.equal(invalidTarget.status, 422);
    assert.deepEqual(await invalidTarget.json(), { error: 'invalid_target' });
    const healthy = await fetch(`${url}/read`, {
      method: 'POST', headers,
      body: JSON.stringify({ target: { kind: 'guide', route_id: 'e2e-free-guide', version: '1', locale: 'be' } }),
    });
    assert.equal(healthy.status, 200, 'a rejected request does not break the next operation');
    assert.deepEqual(await healthy.json(), { revision: 0, score: null, reason_codes: [], deleted: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('the fault switch answers 404/500/stall for named files (criterion 5)', async () => {
  const build = await buildE2EOrigin({ outDir: tmpDir('kudy-e2e-fault-') });
  const faults = parseFaultSpec([
    '404:discovery/e2e-city/r-e2e-free-1/index.json',
    '500:catalog.json',
    'stall:catalog.previous.json',
  ]);
  const stallEvents = [];
  const server = createE2EOriginServer({ root: build.target, faults, stallMs: 300,
    onStall: (target, phase) => stallEvents.push(`${phase}:${target}`) });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const notFound = await fetch(`${base}/discovery/e2e-city/r-e2e-free-1/index.json`);
    assert.equal(notFound.status, 404);
    const serverError = await fetch(`${base}/catalog.json`);
    assert.equal(serverError.status, 500);
    const stalledAt = Date.now();
    const stalled = await fetch(`${base}/catalog.previous.json`);
    assert.ok(Date.now() - stalledAt >= 300, 'a stalled file must answer no earlier than the stall');
    assert.equal(stalled.status, 200, 'a stalled file answers normally after the stall');
    await stalled.arrayBuffer();
    assert.deepEqual(stallEvents, ['start:catalog.previous.json', 'complete:catalog.previous.json']);
    const healthy = await fetch(`${base}/bundle/e2e-free-guide/1/route.json`);
    assert.equal(healthy.status, 200);
  } finally {
    server.close();
    await fsp.rm(build.target, { recursive: true, force: true });
  }
});

test('an unnamed missing file answers 404 and containment holds (rule 3)', async () => {
  const build = await buildE2EOrigin({ outDir: tmpDir('kudy-e2e-srv-') });
  const server = createE2EOriginServer({ root: build.target, faults: new Map() });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/no-such-file.json`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404, 'traversal must not escape the origin root');
  } finally {
    server.close();
    await fsp.rm(build.target, { recursive: true, force: true });
  }
});

test('fault targets match canonical spellings of a path (non-canonical requests)', async () => {
  const build = await buildE2EOrigin({ outDir: tmpDir('kudy-e2e-canon-') });
  const faults = parseFaultSpec(['500:catalog.json']);
  const server = createE2EOriginServer({ root: build.target, faults, stallMs: 300 });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/catalog%2Ejson`)).status, 500, 'percent-encoded spelling must hit the fault');
    assert.equal((await fetch(`${base}//catalog.json`)).status, 500, 'duplicate-slash spelling must hit the fault');
    assert.equal((await fetch(`${base}/catalog%2Fjson`)).status, 404, 'a different file is not the fault target');
  } finally {
    server.close();
    await fsp.rm(build.target, { recursive: true, force: true });
  }
});

test('the summary prints the app origin, the emulator origin and the digest', () => {
  const summary = formatOriginSummary({
    port: 8791,
    build: { target: '/tmp/origin', catalog_sha256: 'abc', routes: 2, discovery_index: 'discovery/e2e-city/r-e2e-free-1/index.json' },
    faults: parseFaultSpec(['404:catalog.json']),
    stallMs: 15000,
  });
  assert.match(summary, /EXPO_PUBLIC_CATALOG_ORIGIN=http:\/\/localhost:8791/);
  assert.match(summary, /EXPO_PUBLIC_CATALOG_ORIGIN=http:\/\/10\.0\.2\.2:8791/);
  assert.match(summary, /catalog sha256: abc/);
  assert.match(summary, /faults: 404:catalog\.json/);
});

test('the e2e:origin npm script stays wired to this tool (implementation-rules 1)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['e2e:origin'], 'node tools/e2e-origin/serve-e2e-origin.mjs');
});

// G23.02 (issue #660): the package subset keeps the pinned publish order,
// builds only the named packages and answers bad input with named
// diagnostics — the web E2E publishes the paid-guide package alone.
test('parsePackageSet narrows the build and answers bad input with named diagnostics (rule 14)', () => {
  assert.deepEqual(parsePackageSet(undefined), ['paid-guide', 'free-guide'], 'the default stays the full city');
  assert.deepEqual(parsePackageSet(['paid-guide']), ['paid-guide']);
  assert.deepEqual(parsePackageSet(['free-guide,paid-guide']), ['paid-guide', 'free-guide'], 'pinned order wins');
  assert.deepEqual(parsePackageSet(['free-guide,nearby-guide']), ['nearby-guide', 'free-guide']);
  assert.deepEqual(parsePackageSet(['paid-guide', 'paid-guide']), ['paid-guide'], 'duplicates collapse');
  for (const [bad, code] of [
    [['paid-guide,'], 'packages-empty-entry'],
    [['no-such-package'], 'packages-unknown'],
  ]) {
    assert.throws(() => parsePackageSet(bad), (error) => error instanceof E2EOriginError && error.code === code);
  }
});

test('building the paid-guide subset lays a one-route catalog with its own discovery pointer', async () => {
  const out = tmpDir('kudy-e2e-subset-');
  const build = await buildE2EOrigin({ outDir: out, packages: ['paid-guide'] });
  const catalogBytes = await fsp.readFile(path.join(build.target, 'catalog.json'));
  const catalog = readCatalogDoc(JSON.parse(catalogBytes.toString('utf8')));
  assert.equal(catalog.status, 'v1');
  assert.deepEqual(catalog.routes.map((route) => route.route_id), ['e2e-paid-guide']);
  assert.equal(catalog.discovery_index.path, 'discovery/e2e-city/r-e2e-paid-1/index.json');
  await fsp.rm(out, { recursive: true, force: true });
});

test('the e2e:web runner stays wired to this tool and its npm script (implementation-rules 1)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['e2e:web'], 'node web/e2e/run-e2e.mjs');
  // The runner must keep invoking this tool through the production path.
  const runner = fs.readFileSync(path.join(REPO_ROOT, 'web', 'e2e', 'run-e2e.mjs'), 'utf8');
  assert.match(runner, /serve-e2e-origin\.mjs/, 'the web E2E runner must build the origin through serve-e2e-origin.mjs');
});
