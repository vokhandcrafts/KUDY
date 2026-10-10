// G23.01 — e2e-origin: one command builds and serves the deterministic
// synthetic catalog fixture (fixtures/e2e/*) so the app and the E2E suites
// see the same city, guides, stops, Moments and collection through
// EXPO_PUBLIC_CATALOG_ORIGIN (issue #659).
//
// The catalog is produced only by the production publishing path —
// tools/build-bundle (packager) then tools/publish-catalog (verifier +
// pointer swap) — never by a test-only shortcut. Determinism: the build is
// timestamp-free and publish pins --now, so two runs lay byte-identical
// files and suites can assert exact content (criterion 4). The served root
// is the publish target itself; containment and mime reuse the shared
// tools/serve-static.mjs idiom.
//
// Fault switch (criterion 5, for G23.05/G23.06): --fault "KIND:PATH[,KIND:PATH…]"
// with KIND ∈ {404, 500, stall}. Named files answer 404/500 without a disk
// read, or stall for --stall-ms and then answer normally — suites use a
// client timeout shorter than the stall. A malformed spec is a named
// diagnostic, never a silent pass.
//
// Usage:
//   npm run e2e:origin                              # build + serve :8791
//   node tools/e2e-origin/serve-e2e-origin.mjs --port 8792 \
//     --fault "404:discovery/e2e-city/r-e2e-free-1/index.json,500:catalog.json" \
//     --stall-ms 15000
//   node tools/e2e-origin/serve-e2e-origin.mjs --no-serve   # build + print only
//   node tools/e2e-origin/serve-e2e-origin.mjs --no-serve --packages paid-guide
//
// Package subset (G23.02): --packages narrows the build to named fixture
// packages in the pinned publish order. The web E2E builds the paid-guide
// package alone: the web reader resolves every catalog route against the
// ACTIVE discovery revision, and a one-package city keeps catalog.json and
// the pointer coherent without touching the production path.
//
// From the Android emulator the origin is http://10.0.2.2:<port>
// (10.0.2.2 is the host loopback); from a host browser or a web test it is
// http://localhost:<port>. See docs/development_setup.md.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildBundle, canonicalJson, sha256Hex } from '../build-bundle/build-bundle.mjs';
import { publishCatalog } from '../publish-catalog/publish-catalog.mjs';
import { readCatalogDoc } from '../../contracts/reader.mjs';
import { resolveStaticFile } from '../serve-static.mjs';

export class E2EOriginError extends Error {
  constructor(code, ids = {}) {
    super(code);
    this.name = 'E2EOriginError';
    this.code = code;
    this.ids = ids;
  }
}

const fail = (code, ids) => {
  throw new E2EOriginError(code, ids);
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_PACKAGES = ['paid-guide', 'free-guide'];
// Publish order matters: catalog.json merges routes across publishes and the
// discovery pointer comes from the LAST publish — the free-guide package
// owns the city offers (guide, place with the Moment, collection) that the
// Explore journeys in G23.04–G23.06 walk through.
const PINNED_NOW = '2026-10-07T00:00:00.000Z';

const FAULT_KINDS = new Set(['404', '500', 'stall']);
// Fault targets are compared against request paths, never interpolated into
// filesystem reads, but the charset is pinned anyway so a tampered flag
// cannot smuggle whitespace or traversal into the spec.
const FAULT_PATH = /^[A-Za-z0-9._/-]+$/;

// The package subset to build and publish (G23.02): the default stays the
// full two-package city; the web E2E publishes the paid-guide package alone,
// because the web reader resolves every catalog route against the ACTIVE
// discovery revision and a one-package city keeps that coherent. Names must
// be known fixture packages; the pinned publish order is preserved.
export function parsePackageSet(values, repoRoot = REPO_ROOT) {
  if (values === undefined || values.length === 0) return [...FIXTURE_PACKAGES];
  const names = new Set();
  for (const value of values) {
    for (const entry of String(value).split(',')) {
      if (entry === '') fail('packages-empty-entry', {});
      if (!FIXTURE_PACKAGES.includes(entry)) fail('packages-unknown', { entry });
      names.add(entry);
    }
  }
  for (const name of names) {
    if (!fs.existsSync(path.join(repoRoot, 'fixtures', 'e2e', name))) fail('packages-missing-dir', { name });
  }
  return FIXTURE_PACKAGES.filter((pkg) => names.has(pkg));
}

// Returns Map<pathname (no leading slash), kind>. Diagnostics over prose.
export function parseFaultSpec(values) {
  const faults = new Map();
  for (const value of values ?? []) {
    for (const entry of String(value).split(',')) {
      if (entry === '') fail('fault-empty-entry', {});
      const sep = entry.indexOf(':');
      if (sep < 0) fail('fault-missing-kind', { entry });
      const kind = entry.slice(0, sep);
      const target = entry.slice(sep + 1);
      if (!FAULT_KINDS.has(kind)) fail('fault-unknown-kind', { entry, kind });
      // Same segment rule as the publish-catalog safe-path idiom: no empty,
      // dot or dot-dot segment can smuggle traversal into the spec.
      if (target === '' || target.split('/').some((s) => s === '' || s === '.' || s === '..')
        || !FAULT_PATH.test(target)) fail('fault-unsafe-path', { entry });
      if (faults.has(target) && faults.get(target) !== kind) fail('fault-conflict', { entry });
      faults.set(target, kind);
    }
  }
  return faults;
}

// The publish target is the served root: catalog.json at the origin, bundle
// and discovery files beneath it, exactly as the app and web readers expect.
export async function buildE2EOrigin({ outDir = 'tools/e2e-origin/build', now = PINNED_NOW, repoRoot = REPO_ROOT, packages } = {}) {
  if (Number.isNaN(Date.parse(now))) fail('invalid-now', { now });
  const outAbs = path.resolve(repoRoot, outDir);
  await fsp.mkdir(outAbs, { recursive: true });
  let last;
  for (const pkg of parsePackageSet(packages, repoRoot)) {
    const staging = path.join(outAbs, 'staging', pkg);
    fs.rmSync(staging, { recursive: true, force: true });
    await buildBundle({ inDir: path.join(repoRoot, 'fixtures', 'e2e', pkg), outDir: staging });
    last = await publishCatalog({
      staging,
      target: path.join(outAbs, 'origin'),
      now,
    });
  }
  const catalogBytes = await fsp.readFile(path.join(outAbs, 'origin', 'catalog.json'));
  const read = readCatalogDoc(JSON.parse(catalogBytes.toString('utf8')));
  if (read.status !== 'v1' || !read.ok) {
    fail('catalog-invalid', { errors: (read.errors ?? []).map((e) => e.rule).join(',') });
  }
  return {
    target: path.join(outAbs, 'origin'),
    routes: read.routes.length,
    discovery_index: read.discovery_index?.path ?? null,
    catalog_sha256: sha256Hex(catalogBytes),
  };
}

export function createE2EOriginServer({ root, faults = new Map(), stallMs = 15000 }) {
  if (!Number.isInteger(stallMs) || stallMs < 0) fail('invalid-stall-ms', { stall_ms: stallMs });
  return createServer((request, response) => {
    // request.url is the origin-form request target; parse it directly — the
    // URL constructor would read a leading '//' as a protocol-relative
    // authority and lose the path.
    const rawPath = request.url.split('?')[0];
    // Fault targets are canonical path spellings: the fault lookup normalizes
    // (decode escapes, collapse duplicate slashes), so /catalog%2Ejson and
    // //catalog.json still match a catalog.json target. A malformed escape is
    // simply not a fault target. Serving keeps the raw target —
    // resolveStaticFile performs exactly one decode plus containment.
    let faultTarget = rawPath;
    try {
      faultTarget = decodeURIComponent(rawPath).replace(/\/{2,}/g, '/').replace(/^\/+/, '');
    } catch {
      faultTarget = rawPath;
    }
    const kind = faults.get(faultTarget);
    if (kind === '404') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(canonicalJson({ fault: '404', path: faultTarget }).trimEnd());
      return;
    }
    if (kind === '500') {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(canonicalJson({ fault: '500', path: faultTarget }).trimEnd());
      return;
    }
    const serve = () => {
      // resolveStaticFile carries the platform-safe containment idiom
      // (AR-2): anything outside root answers 404, never a disk read.
      const file = resolveStaticFile(root, rawPath);
      fsp.readFile(file).then(
        (bytes) => {
          response.writeHead(200, {
            'content-length': bytes.length,
            'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
            'cache-control': 'no-store',
          });
          response.end(bytes);
        },
        () => {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(canonicalJson({ fault: 'not-found', path: faultTarget }).trimEnd());
        },
      );
    };
    if (kind === 'stall') {
      setTimeout(serve, stallMs);
      return;
    }
    serve();
  });
}

// Deterministic summary for scripts, demos and result captures: no timing
// lines, no wall-clock timestamps (implementation-rules 11).
export function formatOriginSummary({ port, build, faults, stallMs }) {
  const lines = [
    `E2E origin ready: ${build.target}`,
    `catalog sha256: ${build.catalog_sha256}`,
    `routes: ${build.routes}  discovery: ${build.discovery_index}`,
  ];
  if (Number.isInteger(port)) {
    lines.push(
      `EXPO_PUBLIC_CATALOG_ORIGIN=http://localhost:${port}`,
      `Android emulator: EXPO_PUBLIC_CATALOG_ORIGIN=http://10.0.2.2:${port} (10.0.2.2 = host loopback)`,
    );
  }
  if (faults.size > 0) {
    lines.push(`faults: ${[...faults.entries()].map(([p, k]) => `${k}:${p}`).join(', ')} (stall ${stallMs} ms)`);
  }
  return lines.join('\n');
}

// --------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const values = { fault: [], packages: [], port: 8791, 'stall-ms': 15000, now: PINNED_NOW };
  const valued = ['--port', '--out', '--now', '--fault', '--stall-ms', '--packages'];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--no-serve') values['no-serve'] = true;
    else if (valued.includes(argv[i])) {
      if (argv[i + 1] === undefined) fail('missing-arg-value', { arg: argv[i] });
      if (argv[i] === '--fault') values.fault.push(argv[i + 1]);
      else if (argv[i] === '--packages') values.packages.push(argv[i + 1]);
      else values[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    } else fail('unknown-arg', { arg: argv[i] });
  }
  return values;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof E2EOriginError) {
      console.error(`usage: node tools/e2e-origin/serve-e2e-origin.mjs [--port <n>] [--out <dir>] [--now <iso>] [--packages "paid-guide[,free-guide]"] [--fault "KIND:PATH[,…]"] [--stall-ms <n>] [--no-serve]`);
      console.error(canonicalJson({ error: { code: error.code, ...error.ids } }).trimEnd());
      process.exit(2);
    }
    throw error;
  }
  const faults = parseFaultSpec(args.fault);
  const build = await buildE2EOrigin({ outDir: args.out ?? 'tools/e2e-origin/build', now: args.now, packages: args.packages });
  if (args['no-serve']) {
    console.log(formatOriginSummary({ port: null, build, faults, stallMs: args['stall-ms'] }));
    return;
  }
  const server = createE2EOriginServer({ root: build.target, faults, stallMs: args['stall-ms'] });
  // Loopback only: the Android emulator reaches the host through 10.0.2.2,
  // which is an alias for the host loopback — no LAN exposure is needed.
  await new Promise((resolve) => server.listen(args.port, '127.0.0.1', resolve));
  console.log(formatOriginSummary({ port: args.port, build, faults, stallMs: args['stall-ms'] }));
  const shutdown = () => {
    server.close(() => process.exit(0));
    // A keep-alive socket must not hold the process hostage on Ctrl-C.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
