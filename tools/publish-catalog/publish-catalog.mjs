// G02.04 — publish-catalog: real publication of the catalog pointer with
// rollback (issue #56). The interim derivation in web/lib/content stands in
// for the fixture stage; this is the tool that publishes for real.
//
// Contract sources (copied, never restated):
//   contracts/schemas/catalog.schema.json  envelope v1: {catalog_schema_version,
//     generated_at?, routes[], discovery_index?}; route.version pattern
//     `^[0-9]+$`; discovery_index.path pattern `^discovery/.../index\.json$`
//   contracts/reader.mjs readCatalogDoc — the single catalog interpreter
//     (v1 full; unknown major not interpreted; legacy v0 bare array = catalog
//     without discovery)
//   09 §4  lock.json = [{path, bytes, sha256}] per layer; published versions
//     are immutable; rollback = restore the previous catalog.json entry
//   09 §4  atomic rename only within one directory (temp file next to target)
//   09 §8  a locale exists in the catalog when its base stops.json is published
//   21 §3.3  discovery_index pointer: bytes/sha256 verified before load
//   21 §5.2  G02.04 stores the immutable registry export together with the
//     release manifest; `prepared` targets never depend on feedback tables
//
// Publication order (criteria 1/4): the full staging package is verified
// first — every release-manifest artifact against its bytes+sha256, every
// lock.json entry against its file — and only then are artifacts laid, the
// release files stored, and the pointer swapped last via temp+rename. An
// interrupted publish leaves the previous catalog live; unreferenced orphan
// files are overwritten by the next run. The private layer is verified but
// never laid into the public target (09 §5 grant boundary: extended content
// reaches the app through grants, not the catalog origin).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { canonicalJson, isIdentifier, sha256Hex } from '../build-bundle/build-bundle.mjs';
import { readCatalogDoc } from '../../contracts/reader.mjs';

export class PublishError extends Error {
  constructor(code, ids = {}) {
    super(code);
    this.name = 'PublishError';
    this.code = code;
    this.ids = ids;
  }
}

const fail = (code, ids) => {
  throw new PublishError(code, ids);
};

// Diagnostic text renders the path, so anything outside printable ASCII
// (a tampered name cannot pass the charset gate anyway) is flattened to '?'
// — a raw newline must not corrupt the log line itself.
const shownPath = (rel) => String(rel).replace(/[^\x20-\x7e]/g, '?');

// Every manifest path interpolates into a filesystem read or a target write,
// so each slash segment is pinned to the charset the packager writes
// (identifiers and fixed file names). A tampered manifest answers with a
// named diagnostic instead of touching an attacker-chosen path.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function safeSegments(rel) {
  const segments = String(rel).split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || !SAFE_SEGMENT.test(s))) {
    fail('unsafe-artifact-path', { path: shownPath(rel) });
  }
  return segments;
}

function readJsonFile(abs, rel) {
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch {
    fail('missing-file', { path: rel });
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail('invalid-json', { path: rel });
  }
}

// One interpretation for every catalog byte string this tool reads — the
// target file before a publish, the stored previous before a rollback. A
// target this tool cannot interpret is never clobbered: unknown major
// versions and schema-invalid v1 catalogs abort (the web reader would refuse
// them too — one interpretation, contracts/reader.mjs).
function interpretCatalogBytes(bytes, rel) {
  let doc;
  try {
    doc = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('invalid-json', { path: rel });
  }
  const read = readCatalogDoc(doc);
  if (read.status === 'unknown-major') fail('catalog-unknown-major', { found: doc.catalog_schema_version });
  if (read.status === 'invalid' || (read.status === 'v1' && !read.ok)) {
    fail('catalog-invalid', { errors: read.errors.map((e) => e.rule).join(',') });
  }
  return read;
}

function readTargetCatalog(targetAbs) {
  let bytes;
  try {
    bytes = fs.readFileSync(path.join(targetAbs, 'catalog.json'));
  } catch {
    return { bytes: null, read: null };
  }
  return { bytes, read: interpretCatalogBytes(bytes, 'catalog.json') };
}

function verifyArtifact(rootAbs, artifact) {
  const segments = safeSegments(artifact.path);
  let buf;
  try {
    buf = fs.readFileSync(path.join(rootAbs, ...segments));
  } catch {
    fail('manifest-missing-artifact', { path: shownPath(artifact.path) });
  }
  if (buf.length !== artifact.bytes) {
    fail('manifest-mismatch', { path: shownPath(artifact.path), field: 'bytes', expected: artifact.bytes, actual: buf.length });
  }
  const sha = sha256Hex(buf);
  if (sha !== artifact.sha256) {
    fail('manifest-mismatch', { path: shownPath(artifact.path), field: 'sha256', expected: artifact.sha256, actual: sha });
  }
  return buf;
}

// 09 §4: the manifest already covers the lock files themselves, so re-checking
// every lock entry against its file proves manifest, lock and bytes agree —
// the publication gate the criteria call "the full package is checked first".
function verifyLayerLocks(stagingAbs, manifest) {
  for (const artifact of manifest.artifacts) {
    if (!artifact.path.startsWith('public/bundle/') || !artifact.path.endsWith('/lock.json')) continue;
    const lock = readJsonFile(path.join(stagingAbs, ...safeSegments(artifact.path)), artifact.path);
    if (!Array.isArray(lock)) fail('lock-invalid', { path: shownPath(artifact.path) });
    const layerDir = path.join(stagingAbs, ...safeSegments(artifact.path).slice(0, -1));
    for (const entry of lock) {
      const segments = safeSegments(entry?.path ?? '');
      let buf;
      try {
        buf = fs.readFileSync(path.join(layerDir, ...segments));
      } catch {
        fail('lock-missing-entry', { lock: shownPath(artifact.path), entry: shownPath(entry?.path) });
      }
      if (buf.length !== entry.bytes || sha256Hex(buf) !== entry.sha256) {
        fail('lock-mismatch', {
          lock: shownPath(artifact.path),
          entry: shownPath(entry.path),
          expected_sha256: entry.sha256,
          actual_sha256: sha256Hex(buf),
        });
      }
    }
  }
}

// Catalog facts come from the verified manifest, never from a second walk of
// the tree. locales: base stops.json published per locale (09 §8); layers:
// extended present among public artifacts; sizes.base: the sum over the whole
// published version directory — the same set web/lib/content derives from disk
// (contract-parity test pins the two together).
function deriveCatalogEntry(manifest, routeDoc) {
  const prefix = `public/bundle/${manifest.route_id}/${manifest.version}/`;
  const publicArts = manifest.artifacts.filter((a) => a.path.startsWith(prefix));
  const localeNames = new Set(publicArts.map((a) => a.path.slice(prefix.length).split('/')[0]));
  const locales = [...localeNames].filter((locale) => publicArts.some((a) => a.path === `${prefix}${locale}/base/stops.json`)).sort();
  if (locales.length === 0) fail('no-published-locale', { route_id: manifest.route_id, version: manifest.version });
  // Layers follow the route contract, not the public tree: extended stops
  // live in the private layer (09 §5), the catalog advertises the layer set
  // the route declares — the same rule web/lib/content derives from disk
  // (contract-parity test pins the two together).
  const layers = routeDoc.stops.some((s) => s?.access_tier === 'extended') ? ['base', 'extended'] : ['base'];
  const base = publicArts.reduce((sum, a) => sum + a.bytes, 0);
  return { route_id: manifest.route_id, version: manifest.version, locales, layers, sizes: { base } };
}

// Path pattern copied verbatim from catalog.schema.json (discovery_index.path).
const DISCOVERY_POINTER_PATH = /^discovery\/[a-z0-9._-]{1,64}\/[a-z0-9._-]{1,64}\/index\.json$/;

function deriveDiscoveryPointer(manifest) {
  const indices = manifest.artifacts.filter((a) => a.path.startsWith('public/') && DISCOVERY_POINTER_PATH.test(a.path.slice('public/'.length)));
  if (indices.length !== 1) fail('discovery-index-count', { found: indices.length });
  const artifact = indices[0];
  const rel = artifact.path.slice('public/'.length);
  return { schema_version: 1, revision: rel.split('/')[2], path: rel, bytes: artifact.bytes, sha256: artifact.sha256 };
}

async function atomicWrite(fileAbs, bytes) {
  const tmp = `${fileAbs}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, bytes);
  await fsp.rename(tmp, fileAbs);
}

export async function publishCatalog({ staging, target, now }) {
  let stagingAbs;
  try {
    stagingAbs = fs.realpathSync(staging);
  } catch {
    fail('staging-missing', { path: shownPath(staging) });
  }
  const generatedAt = now ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) fail('invalid-now', { now: shownPath(generatedAt) });
  await fsp.mkdir(target, { recursive: true });
  const targetAbs = fs.realpathSync(target);

  // ---- full package verification, before any target mutation (criterion 1)
  const manifest = readJsonFile(path.join(stagingAbs, 'release', 'release-manifest.json'), 'release/release-manifest.json');
  if (manifest.schema_version !== 1) fail('unknown-schema', { part: 'release-manifest', found: manifest.schema_version });
  if (!Array.isArray(manifest.artifacts)) fail('manifest-invalid', { field: 'artifacts' });
  for (const artifact of manifest.artifacts) verifyArtifact(stagingAbs, artifact);
  verifyLayerLocks(stagingAbs, manifest);
  if (!isIdentifier(manifest.route_id)) fail('unsafe-release-segment', { segment: shownPath(manifest.route_id) });
  // route.version pattern copied verbatim from catalog.schema.json.
  if (!/^[0-9]+$/.test(manifest.version) || manifest.version.length > 64) {
    fail('unsafe-release-segment', { segment: shownPath(manifest.version) });
  }
  // The registry export travels with the release manifest (21 §5.2); the
  // manifest's own metadata block is the source of truth for its bytes.
  const registryMeta = manifest.feedback_target_registry;
  if (!registryMeta?.path) fail('missing-registry', {});
  const registrySegments = safeSegments(registryMeta.path);
  let registryBytes;
  try {
    registryBytes = await fsp.readFile(path.join(stagingAbs, ...registrySegments));
  } catch {
    fail('missing-registry', { path: shownPath(registryMeta.path) });
  }
  if (registryBytes.length !== registryMeta.bytes || sha256Hex(registryBytes) !== registryMeta.sha256) {
    fail('manifest-mismatch', {
      path: shownPath(registryMeta.path),
      field: registryBytes.length !== registryMeta.bytes ? 'bytes' : 'sha256',
      expected: registryBytes.length !== registryMeta.bytes ? registryMeta.bytes : registryMeta.sha256,
      actual: registryBytes.length !== registryMeta.bytes ? registryBytes.length : sha256Hex(registryBytes),
    });
  }

  const entry = deriveCatalogEntry(manifest, readJsonFile(
    path.join(stagingAbs, ...safeSegments(`public/bundle/${manifest.route_id}/${manifest.version}/route.json`)),
    `public/bundle/${manifest.route_id}/${manifest.version}/route.json`,
  ));
  const pointer = deriveDiscoveryPointer(manifest);

  // ---- target state: what is ready right now (criterion 2)
  const { bytes: currentBytes, read: current } = readTargetCatalog(targetAbs);
  // Legacy v0 (bare array) is read as a catalog without discovery; its entry
  // shape is not re-interpreted into v1 — the file is preserved verbatim for
  // rollback and the v1 envelope starts fresh from this release.
  const readyPrefixes = new Set(
    current?.status === 'v1' ? current.routes.map((r) => `bundle/${r.route_id}/${r.version}/`) : [],
  );
  const readyIndexPath = current?.status === 'v1' ? current.discovery_index?.path ?? null : null;

  // ---- lay public artifacts; immutable ready versions refuse byte drift
  let copied = 0;
  let kept = 0;
  for (const artifact of manifest.artifacts) {
    if (!artifact.path.startsWith('public/')) continue; // private verified, never laid (09 §5)
    const rel = artifact.path.slice('public/'.length);
    const segments = safeSegments(rel);
    const targetFile = path.join(targetAbs, ...segments);
    let existing;
    try {
      existing = await fsp.readFile(targetFile);
    } catch {
      existing = null;
    }
    if (existing) {
      if (sha256Hex(existing) === artifact.sha256) {
        kept += 1;
        continue;
      }
      const ready = readyIndexPath !== null && rel === readyIndexPath
        ? true
        : [...readyPrefixes].some((p) => rel.startsWith(p));
      if (ready) {
        fail('version-immutable', { path: shownPath(rel), expected_sha256: artifact.sha256, actual_sha256: sha256Hex(existing) });
      }
      // not ready → orphan of an interrupted publish; overwriting is the recovery
    }
    await fsp.mkdir(path.dirname(targetFile), { recursive: true });
    await fsp.copyFile(path.join(stagingAbs, ...safeSegments(artifact.path)), targetFile);
    copied += 1;
  }

  // ---- store the release manifest + registry export (21 §5.2)
  const manifestBytes = await fsp.readFile(path.join(stagingAbs, 'release', 'release-manifest.json'));
  const releaseDir = path.join(targetAbs, 'releases', manifest.route_id, manifest.version);
  for (const [name, bytes] of [
    ['release-manifest.json', manifestBytes],
    ['feedback-target-registry.json', registryBytes],
  ]) {
    const releaseRel = `releases/${manifest.route_id}/${manifest.version}/${name}`;
    const targetFile = path.join(releaseDir, name);
    let existing;
    try {
      existing = await fsp.readFile(targetFile);
    } catch {
      existing = null;
    }
    if (existing) {
      if (existing.equals(bytes)) {
        kept += 1;
        continue;
      }
      fail('version-immutable', { path: shownPath(releaseRel) });
    }
    await fsp.mkdir(releaseDir, { recursive: true });
    await fsp.writeFile(targetFile, bytes);
    copied += 1;
  }

  // ---- merged envelope, validated by the reader the app and web share
  const merged = new Map();
  for (const route of current?.status === 'v1' ? current.routes : []) merged.set(route.route_id, route);
  merged.set(entry.route_id, entry);
  const routes = [...merged.values()].sort((a, b) => (a.route_id < b.route_id ? -1 : a.route_id > b.route_id ? 1 : 0));
  const catalog = { catalog_schema_version: 1, generated_at: generatedAt, routes, discovery_index: pointer };
  const verdict = readCatalogDoc(catalog);
  if (verdict.status !== 'v1' || !verdict.ok) {
    fail('catalog-invalid', { errors: verdict.errors.map((e) => e.rule).join(',') });
  }
  const catalogBytes = Buffer.from(canonicalJson(catalog), 'utf8');

  // ---- pointer swap last (criteria 3/4): previous first, pointer last —
  // a crash anywhere before the rename leaves the previous catalog live.
  if (currentBytes) await atomicWrite(path.join(targetAbs, 'catalog.previous.json'), currentBytes);
  await atomicWrite(path.join(targetAbs, 'catalog.json'), catalogBytes);

  return {
    published: true,
    route_id: manifest.route_id,
    version: manifest.version,
    routes: routes.length,
    copied,
    kept,
    catalog_bytes: catalogBytes.length,
    catalog_sha256: sha256Hex(catalogBytes),
    discovery_index: pointer.path,
    release: `releases/${manifest.route_id}/${manifest.version}`,
  };
}

export async function rollbackCatalog({ target }) {
  await fsp.mkdir(target, { recursive: true });
  const targetAbs = fs.realpathSync(target);
  let previousBytes;
  try {
    previousBytes = await fsp.readFile(path.join(targetAbs, 'catalog.previous.json'));
  } catch {
    fail('no-previous', { path: 'catalog.previous.json' });
  }
  const read = interpretCatalogBytes(previousBytes, 'catalog.previous.json');
  let currentBytes;
  try {
    currentBytes = await fsp.readFile(path.join(targetAbs, 'catalog.json'));
  } catch {
    currentBytes = null; // crash between previous-write and pointer-write: restore is the recovery
  }
  // Rollback goal first (pointer), housekeeping after: a crash between the two
  // renames leaves the rollback done, the previous file stale but harmless.
  await atomicWrite(path.join(targetAbs, 'catalog.json'), previousBytes);
  if (currentBytes) await atomicWrite(path.join(targetAbs, 'catalog.previous.json'), currentBytes);
  return {
    rolled_back: true,
    routes: read.routes.length,
    discovery_index: read.discovery_index?.path ?? null,
  };
}

// --------------------------------------------------------------------- CLI

// Same output contract as build-bundle: canonical JSON on stdout, a named
// error object with exit 1 on PublishError, usage with exit 2 on bad args.
function parseArgs(argv) {
  const values = {};
  const valued = ['--staging', '--target', '--now'];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--rollback') values.rollback = true;
    else if (valued.includes(argv[i])) values[argv[i].slice(2)] = argv[i + 1];
  }
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { staging, target, now, rollback } = parseArgs(process.argv.slice(2));
  if (!target || (rollback ? staging !== undefined : !staging)) {
    console.error('usage: node tools/publish-catalog/publish-catalog.mjs (--staging <dir> | --rollback) --target <dir> [--now <iso>]');
    process.exit(2);
  }
  try {
    const result = rollback ? await rollbackCatalog({ target }) : await publishCatalog({ staging, target, now });
    console.log(canonicalJson(result).trimEnd());
  } catch (error) {
    if (error instanceof PublishError) {
      console.error(canonicalJson({ error: { code: error.code, ...error.ids } }).trimEnd());
      process.exit(1);
    }
    throw error;
  }
}
