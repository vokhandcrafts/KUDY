// G02.04 — publish-catalog tests. Every suite goes through the production
// path: buildBundle on the demo fixture produces the staging tree, then
// publishCatalog/rollbackCatalog run against it (implementation-rules 15).
// Each named diagnostic of the publisher has one isolating case (rule 14).

import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildBundle,
  canonicalJson,
  manifestHygieneViolations,
  publicReleaseManifest,
  sha256Hex,
} from '../build-bundle/build-bundle.mjs';
import { PublishError, publishCatalog, rollbackCatalog } from './publish-catalog.mjs';
import { deriveInterimCatalog } from '../../contracts/interim-catalog.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureDir = path.join(repoRoot, 'fixtures', 'content', 'demo-route');
const NOW = '2026-09-21T00:00:00.000Z';

async function tempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

// Rebuilds the demo fixture with an optionally retargeted guide identity and
// returns a fresh staging tree built by the real packager. The discovery
// offer/collection refs follow the guide, otherwise the packager refuses the
// foreign-ref build.
async function makeStaging({ version, routeId, revision, mutateAuthor } = {}) {
  const author = await tempDir('kudy-pub-author-');
  await fsp.cp(fixtureDir, author, { recursive: true });
  if (mutateAuthor) await mutateAuthor(author);
  const routeFile = path.join(author, 'route.json');
  const route = await readJson(routeFile);
  if (version !== undefined) route.version = version;
  if (routeId !== undefined) route.route_id = routeId;
  await fsp.writeFile(routeFile, canonicalJson(route));
  const discoveryFile = path.join(author, 'discovery.json');
  const discovery = await readJson(discoveryFile);
  if (revision !== undefined) discovery.revision = revision;
  for (const offer of discovery.offers ?? []) {
    if (offer.ref?.kind === 'guide') {
      offer.ref.route_id = route.route_id;
      offer.ref.version = route.version;
    }
  }
  for (const collection of discovery.collections ?? []) {
    for (const member of collection.members ?? []) {
      if (member.kind === 'guide') {
        member.route_id = route.route_id;
        member.version = route.version;
      }
    }
  }
  await fsp.writeFile(discoveryFile, canonicalJson(discovery));
  const staging = await tempDir('kudy-pub-stage-');
  await buildBundle({ inDir: author, outDir: staging });
  return { author, staging };
}

async function expectPublishError(run, code) {
  await assert.rejects(run, (error) => error instanceof PublishError && error.code === code, `expected ${code}`);
}

function targetFile(target, rel) {
  return path.join(target, ...rel.split('/'));
}

async function sha256File(file) {
  return sha256Hex(await fsp.readFile(file));
}

// Rewrites the manifest (and optionally the layer lock) so they agree with an
// already-tampered file: the internal-consistency checks pass and a later
// stage — the lock cross-check or the immutability guard — is what fires.
async function reconcileManifest(staging, tamperedRel, { withLock }) {
  const bytes = await fsp.readFile(targetFile(staging, tamperedRel));
  const manifestFile = targetFile(staging, 'release/release-manifest.json');
  const manifest = await readJson(manifestFile);
  const setArtifact = (rel, buf) => {
    const artifact = manifest.artifacts.find((a) => a.path === rel);
    artifact.bytes = buf.length;
    artifact.sha256 = sha256Hex(buf);
  };
  setArtifact(tamperedRel, bytes);
  if (!withLock) {
    await fsp.writeFile(manifestFile, canonicalJson(manifest));
    return;
  }
  // The lock file is itself a manifest artifact, so reconciling the layer
  // reconciles both copies.
  const layerRel = tamperedRel.split('/').slice(0, -1).join('/');
  const lockFile = targetFile(staging, `${layerRel}/lock.json`);
  const lock = await readJson(lockFile);
  const entry = lock.find((e) => e.path === tamperedRel.split('/').pop());
  entry.bytes = bytes.length;
  entry.sha256 = sha256Hex(bytes);
  const lockBytes = Buffer.from(canonicalJson(lock), 'utf8');
  await fsp.writeFile(lockFile, lockBytes);
  setArtifact(`${layerRel}/lock.json`, lockBytes);
  await fsp.writeFile(manifestFile, canonicalJson(manifest));
}

// ------------------------------------------------- AC1: full package first

test('AC1: tampered staging file aborts the publish before the target changes', async () => {
  const { staging } = await makeStaging();
  const target = await tempDir('kudy-pub-target-');
  const victim = targetFile(staging, 'public/bundle/demo-route-a1/1/be/base/stops.json');
  await fsp.writeFile(victim, Buffer.concat([await fsp.readFile(victim), Buffer.from(' ')]));
  await expectPublishError(() => publishCatalog({ staging, target, now: NOW }), 'manifest-mismatch');
  assert.deepEqual(await fsp.readdir(target), [], 'target must stay untouched');
});

test('AC1: corrupt, missing and hostile manifests answer with named diagnostics', async () => {
  const empty = await tempDir('kudy-pub-empty-');
  await expectPublishError(
    async () => publishCatalog({ staging: empty, target: await tempDir('kudy-pub-t1-'), now: NOW }),
    'missing-file',
  );

  const { staging } = await makeStaging();
  const manifestFile = targetFile(staging, 'release/release-manifest.json');
  const pristine = await fsp.readFile(manifestFile);
  await fsp.writeFile(manifestFile, '{not json');
  await expectPublishError(
    async () => publishCatalog({ staging, target: await tempDir('kudy-pub-t2-'), now: NOW }),
    'invalid-json',
  );

  const manifest = await JSON.parse(pristine.toString('utf8'));
  await fsp.writeFile(manifestFile, canonicalJson({ ...manifest, schema_version: 2 }));
  await expectPublishError(
    async () => publishCatalog({ staging, target: await tempDir('kudy-pub-t3-'), now: NOW }),
    'unknown-schema',
  );

  await fsp.writeFile(manifestFile, canonicalJson({ ...manifest, schema_version: 1, artifacts: [{ path: '../evil', bytes: 1, sha256: '0'.repeat(64) }] }));
  await expectPublishError(
    async () => publishCatalog({ staging, target: await tempDir('kudy-pub-t4-'), now: NOW }),
    'unsafe-artifact-path',
  );
});

test('AC1: registry export is verified against the manifest metadata block', async () => {
  const { staging } = await makeStaging();
  const registryFile = targetFile(staging, 'release/feedback-target-registry.json');
  await fsp.writeFile(registryFile, canonicalJson({ schema_version: 1, status: 'prepared', targets: [] }));
  await expectPublishError(
    async () => publishCatalog({ staging, target: await tempDir('kudy-pub-target-'), now: NOW }),
    'manifest-mismatch',
  );
});

test('AC1: lock.json entries are re-checked against the laid files', async () => {
  const { staging } = await makeStaging();
  // Tamper a file and reconcile the manifest with it, so only the lock entry
  // can still notice the drift — manifest and file agree, the lock does not.
  const victimRel = 'public/bundle/demo-route-a1/1/be/base/stops.json';
  const victim = targetFile(staging, victimRel);
  await fsp.writeFile(victim, Buffer.concat([await fsp.readFile(victim), Buffer.from(' ')]));
  await reconcileManifest(staging, victimRel, { withLock: false });
  await expectPublishError(
    async () => publishCatalog({ staging, target: await tempDir('kudy-pub-target-'), now: NOW }),
    'lock-mismatch',
  );
});

// ------------------------------------------------- AC2: versions immutable

test('AC2: byte-identical republish is idempotent and rewrites nothing', async () => {
  const { staging } = await makeStaging();
  const target = await tempDir('kudy-pub-target-');
  await publishCatalog({ staging, target, now: NOW });
  const before = await fsp.readFile(targetFile(target, 'catalog.json'));
  const second = await publishCatalog({ staging, target, now: NOW });
  assert.equal(second.copied, 0);
  assert.ok(second.kept > 0);
  assert.deepEqual(await fsp.readFile(targetFile(target, 'catalog.json')), before);
});

test('AC2: same route/version with changed content refuses as version-immutable', async () => {
  const { staging } = await makeStaging();
  const target = await tempDir('kudy-pub-target-');
  await publishCatalog({ staging, target, now: NOW });
  const catalogBefore = await fsp.readFile(targetFile(target, 'catalog.json'));
  const { staging: tampered } = await makeStaging();
  const victimRel = 'public/bundle/demo-route-a1/1/be/base/stops.json';
  await fsp.appendFile(targetFile(tampered, victimRel), '\n');
  // A fully consistent staging tree: only the immutability guard can refuse it.
  await reconcileManifest(tampered, victimRel, { withLock: true });
  await expectPublishError(
    () => publishCatalog({ staging: tampered, target, now: NOW }),
    'version-immutable',
  );
  assert.deepEqual(await fsp.readFile(targetFile(target, 'catalog.json')), catalogBefore);
});

test('AC2: same discovery revision with changed index content refuses', async () => {
  const target = await tempDir('kudy-pub-target-');
  const { staging } = await makeStaging();
  await publishCatalog({ staging, target, now: NOW });
  // A new bundle version keeps the old index revision: the index path is the
  // same, the offers inside reference the new version, so the bytes drift —
  // the publisher must refuse instead of silently overwriting the ready index.
  const { staging: next } = await makeStaging({ version: '2' });
  await expectPublishError(() => publishCatalog({ staging: next, target, now: NOW }), 'version-immutable');
});

// ------------------------------------------------- AC3: rollback

test('AC3: rollback restores the previous ready version, both ways', async () => {
  const target = await tempDir('kudy-pub-target-');
  const { staging } = await makeStaging();
  await publishCatalog({ staging, target, now: NOW });
  const v1 = await fsp.readFile(targetFile(target, 'catalog.json'));
  const { staging: staging2 } = await makeStaging({ version: '2', revision: 'r-demo-2' });
  await publishCatalog({ staging: staging2, target, now: NOW });
  const v2 = await fsp.readFile(targetFile(target, 'catalog.json'));
  assert.notDeepEqual(v2, v1);

  const back = await rollbackCatalog({ target });
  assert.equal(back.rolled_back, true);
  assert.deepEqual(await fsp.readFile(targetFile(target, 'catalog.json')), v1);

  const forth = await rollbackCatalog({ target });
  assert.equal(forth.rolled_back, true);
  assert.deepEqual(await fsp.readFile(targetFile(target, 'catalog.json')), v2);
});

test('AC3: rollback without a previous catalog answers no-previous', async () => {
  const target = await tempDir('kudy-pub-target-');
  await expectPublishError(() => rollbackCatalog({ target }), 'no-previous');
});

// ------------------------------------------------- AC4: interrupted publish

test('AC4: an interrupted publish leaves the old catalog live, orphans are recovered', async () => {
  const target = await tempDir('kudy-pub-target-');
  const { staging } = await makeStaging();
  await publishCatalog({ staging, target, now: NOW });
  const v1 = await fsp.readFile(targetFile(target, 'catalog.json'));

  // Simulate a crash mid-publish of v2: files laid, pointer never swapped.
  const { staging: staging2 } = await makeStaging({ version: '2', revision: 'r-demo-2' });
  const manifest = await readJson(targetFile(staging2, 'release/release-manifest.json'));
  for (const artifact of manifest.artifacts) {
    if (!artifact.path.startsWith('public/')) continue;
    const dst = targetFile(target, artifact.path.slice('public/'.length));
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(targetFile(staging2, artifact.path), dst);
  }
  assert.deepEqual(await fsp.readFile(targetFile(target, 'catalog.json')), v1, 'pointer untouched by the crash');

  const result = await publishCatalog({ staging: staging2, target, now: NOW });
  assert.equal(result.published, true);
  const catalog = await readJson(targetFile(target, 'catalog.json'));
  assert.equal(catalog.routes.length, 1);
  assert.equal(catalog.routes[0].version, '2');
});

// ------------------------------------------------- AC5: pointer and release storage

test('AC5: pointer and stored release files agree with the manifest; routes accumulate', async () => {
  const target = await tempDir('kudy-pub-target-');
  const { staging } = await makeStaging();
  await publishCatalog({ staging, target, now: NOW });
  const { staging: stagingB } = await makeStaging({ routeId: 'route-b', revision: 'r-route-b-1' });
  await publishCatalog({ staging: stagingB, target, now: NOW });

  const catalog = await readJson(targetFile(target, 'catalog.json'));
  assert.deepEqual(catalog.routes.map((r) => r.route_id), ['demo-route-a1', 'route-b']);
  const indexFile = targetFile(target, catalog.discovery_index.path);
  const indexBytes = await fsp.readFile(indexFile);
  assert.equal(catalog.discovery_index.bytes, indexBytes.length);
  assert.equal(catalog.discovery_index.sha256, sha256Hex(indexBytes));

  const manifestB = await readJson(targetFile(stagingB, 'release/release-manifest.json'));
  const storedManifest = await readJson(targetFile(target, 'releases/route-b/1/release-manifest.json'));
  assert.deepEqual(storedManifest, publicReleaseManifest(manifestB));
  assert.ok(manifestB.artifacts.some((artifact) => artifact.path.startsWith('private/')));
  const registryFile = targetFile(target, 'releases/route-b/1/feedback-target-registry.json');
  assert.equal(await sha256File(registryFile), manifestB.feedback_target_registry.sha256);
  const registry = await readJson(registryFile);
  assert.equal(registry.status, 'prepared');
});

// ------------------------------------------------- AC6: legacy / unknown / rollback

test('AC6: legacy v0 target bootstraps v1 and rollback restores the v0 bytes', async () => {
  const target = await tempDir('kudy-pub-target-');
  const legacy = Buffer.from(canonicalJson([{ route_id: 'legacy-route', note: 'v0 bare array' }]));
  await fsp.writeFile(targetFile(target, 'catalog.json'), legacy);
  const { staging } = await makeStaging();
  await publishCatalog({ staging, target, now: NOW });
  const catalog = await readJson(targetFile(target, 'catalog.json'));
  assert.equal(catalog.catalog_schema_version, 1);
  assert.deepEqual(await fsp.readFile(targetFile(target, 'catalog.previous.json')), legacy, 'v0 kept verbatim');
  await rollbackCatalog({ target });
  assert.deepEqual(await fsp.readFile(targetFile(target, 'catalog.json')), legacy);
});

test('AC6: unknown catalog major refuses both publish and rollback', async () => {
  const target = await tempDir('kudy-pub-target-');
  const future = canonicalJson({ catalog_schema_version: 2, routes: [] });
  await fsp.writeFile(targetFile(target, 'catalog.json'), future);
  const { staging } = await makeStaging();
  await expectPublishError(() => publishCatalog({ staging, target, now: NOW }), 'catalog-unknown-major');
  await fsp.writeFile(targetFile(target, 'catalog.previous.json'), future);
  await expectPublishError(() => rollbackCatalog({ target }), 'catalog-unknown-major');
});

test('AC6: schema-invalid v1 target refuses the publish', async () => {
  const target = await tempDir('kudy-pub-target-');
  await fsp.writeFile(targetFile(target, 'catalog.json'), canonicalJson({ catalog_schema_version: 1, routes: 'not-an-array' }));
  const { staging } = await makeStaging();
  await expectPublishError(() => publishCatalog({ staging, target, now: NOW }), 'catalog-invalid');
});

// ------------------------------------------------- parity with the interim derivation

test('parity: the published entry and pointer match deriveInterimCatalog', async () => {
  const { staging } = await makeStaging();
  const target = await tempDir('kudy-pub-target-');
  await publishCatalog({ staging, target, now: NOW });
  const catalog = await readJson(targetFile(target, 'catalog.json'));
  const interim = deriveInterimCatalog(path.join(staging, 'public'));
  assert.deepEqual(catalog.routes, interim.routes);
  assert.deepEqual(catalog.discovery_index, interim.discovery_index);
});

// G14.04.b (issue #303): 09 §8 — a locale exists in the catalog when its
// base stops.json is published; the catalog shows `uk` by content fact only,
// never by promise.
test('G14.04.b: the catalog lists uk only when its base stops.json is published', async () => {
  const { staging } = await makeStaging();
  const target = await tempDir('kudy-pub-target-uk-');
  await publishCatalog({ staging, target, now: NOW });
  const catalog = await readJson(targetFile(target, 'catalog.json'));
  const entry = catalog.routes.find((r) => r.route_id === 'demo-route-a1');
  assert.deepEqual(entry.locales, ['be', 'en', 'uk']);

  const { staging: withoutUk } = await makeStaging({
    mutateAuthor: async (author) => fsp.rm(path.join(author, 'uk'), { recursive: true, force: true }),
  });
  const target2 = await tempDir('kudy-pub-target-nouk-');
  await publishCatalog({ staging: withoutUk, target: target2, now: NOW });
  const catalog2 = await readJson(targetFile(target2, 'catalog.json'));
  const entry2 = catalog2.routes.find((r) => r.route_id === 'demo-route-a1');
  assert.deepEqual(entry2.locales, ['be', 'en']);
});

// ------------------------------------------------- G21.44.b manifest hygiene

test('manifest-hygiene: the published release manifest lists only public entries', async () => {
  const { staging } = await makeStaging();
  const target = await tempDir('kudy-pub-hygiene-');
  await publishCatalog({ staging, target, now: NOW });
  const storedPath = targetFile(target, 'releases/demo-route-a1/1/release-manifest.json');
  const stored = await readJson(storedPath);
  const staged = await readJson(targetFile(staging, 'release/release-manifest.json'));
  const violations = manifestHygieneViolations(stored);
  assert.deepEqual(violations, [], `manifest-hygiene: ${violations.map((item) => item.path).join(',')}`);
  const privateEntries = staged.artifacts.filter((artifact) => !artifact.path.startsWith('public/'));
  assert.ok(privateEntries.length > 0, 'staging keeps the full manifest');
  const raw = await fsp.readFile(storedPath, 'utf8');
  for (const entry of privateEntries) {
    assert.equal(raw.includes(entry.path), false, 'manifest-hygiene');
    assert.equal(raw.includes(entry.sha256), false, 'manifest-hygiene');
  }
  assert.equal(raw.includes('/extended/'), false, 'manifest-hygiene');
  assert.deepEqual(stored, publicReleaseManifest(staged));
  assert.notDeepEqual(await fsp.readFile(storedPath), await fsp.readFile(targetFile(staging, 'release/release-manifest.json')));
  await assert.rejects(fsp.access(targetFile(target, 'private')));
});

test('manifest-hygiene: one private entry is named by the rule', () => {
  const violations = manifestHygieneViolations({
    schema_version: 1,
    artifacts: [
      { path: 'public/bundle/demo/1/route.json', bytes: 2, sha256: 'ab' },
      { path: 'private/bundle/demo/1/be/extended/stops.json', bytes: 9, sha256: 'cd' },
    ],
  });
  assert.deepEqual(violations, [
    { rule: 'manifest-hygiene', path: 'private/bundle/demo/1/be/extended/stops.json' },
  ]);
});

test('manifest-hygiene: an extended segment under public/ refuses before the target changes', async () => {
  const { staging } = await makeStaging();
  const target = await tempDir('kudy-pub-hyg-ext-');
  const manifestFile = targetFile(staging, 'release/release-manifest.json');
  const manifest = await readJson(manifestFile);
  const donor = manifest.artifacts.find((artifact) => artifact.path.endsWith('/be/base/stops.json'));
  const extendedPath = donor.path.replace('/base/', '/extended/');
  await fsp.mkdir(path.dirname(targetFile(staging, extendedPath)), { recursive: true });
  await fsp.copyFile(targetFile(staging, donor.path), targetFile(staging, extendedPath));
  manifest.artifacts.push({ ...donor, path: extendedPath });
  await fsp.writeFile(manifestFile, canonicalJson(manifest));
  await expectPublishError(() => publishCatalog({ staging, target, now: NOW }), 'manifest-hygiene');
  assert.deepEqual(await fsp.readdir(target), []);
});

test('manifest-hygiene: corrupt manifest input is a diagnostic', () => {
  assert.deepEqual(manifestHygieneViolations(null), [{ rule: 'manifest-hygiene', path: '' }]);
  assert.deepEqual(manifestHygieneViolations({ artifacts: 'nope' }), [{ rule: 'manifest-hygiene', path: '' }]);
  assert.deepEqual(manifestHygieneViolations({ artifacts: [null] }), [{ rule: 'manifest-hygiene', path: '' }]);
  assert.deepEqual(manifestHygieneViolations({ artifacts: [{ bytes: 1 }] }), [{ rule: 'manifest-hygiene', path: '' }]);
});

test('AC2: an already-published full release manifest refuses as version-immutable', async () => {
  const { staging } = await makeStaging();
  const target = await tempDir('kudy-pub-immutable-full-');
  await publishCatalog({ staging, target, now: NOW });
  const storedPath = targetFile(target, 'releases/demo-route-a1/1/release-manifest.json');
  const fullBytes = await fsp.readFile(targetFile(staging, 'release/release-manifest.json'));
  await fsp.writeFile(storedPath, fullBytes);
  const catalogBefore = await fsp.readFile(targetFile(target, 'catalog.json'));
  await expectPublishError(() => publishCatalog({ staging, target, now: NOW }), 'version-immutable');
  assert.deepEqual(await fsp.readFile(storedPath), fullBytes);
  assert.deepEqual(await fsp.readFile(targetFile(target, 'catalog.json')), catalogBefore);

  const { staging: staging2 } = await makeStaging({ version: '2', revision: 'r-demo-2' });
  await publishCatalog({ staging: staging2, target, now: NOW });
  assert.deepEqual(await fsp.readFile(storedPath), fullBytes);
  const publishedV2 = await readJson(targetFile(target, 'releases/demo-route-a1/2/release-manifest.json'));
  assert.deepEqual(manifestHygieneViolations(publishedV2), []);
  assert.equal(
    publishedV2.artifacts.some((artifact) => artifact.path.startsWith('private/')),
    false,
  );
});
