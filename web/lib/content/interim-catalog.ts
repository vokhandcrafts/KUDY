// Derivation of the interim catalog.json from a built public tree (G10.01.b).
// Real publication and the catalog pointer belong to G02.04; this stands in
// for the fixture stage so the pointer-driven pages have a catalog to read.
// One implementation serves both the prebuild script and the test fixture —
// routes: one entry per built bundle; locales by fact (a locale exists when
// its base stops.json was published — 09 §8); sizes from the base tree on
// disk (09 §4: sizes per layer, base required by catalog.schema.json);
// discovery pointer: the built index.json with bytes/sha256 (verified at load
// by the reader).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isIdentifier } from '../../../tools/build-bundle/build-bundle.mjs';

interface InterimRoute {
  route_id: string;
  version: string;
  locales: string[];
  layers: string[];
  sizes: { base: number };
}

export interface InterimCatalog {
  catalog_schema_version: 1;
  generated_at: string;
  routes: InterimRoute[];
  discovery_index: {
    schema_version: 1;
    revision: string;
    path: string;
    bytes: number;
    sha256: string;
  };
}

// Walk trust boundary (implementation-rules 14): names that reach a read or
// stat path are type-checked against links and re-pinned to the real tree
// root — recursive readdir may descend through directory symlinks (node ≥26
// yields their files as plain entries), so containment is verified on
// realpath, never on the lexical path.
function containedFilePath(rootReal: string, dirReal: string, name: string): string {
  const real = fs.realpathSync(path.resolve(dirReal, name));
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new Error(`unsafe bundle entry: ${path.relative(rootReal, real)}`);
  }
  return real;
}

function containedDirNames(dirReal: string): string[] {
  return fs
    .readdirSync(dirReal, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => name !== '.' && name !== '..')
    .filter((name) => {
      const real = fs.realpathSync(path.resolve(dirReal, name));
      return real === dirReal || real.startsWith(dirReal + path.sep);
    })
    .sort();
}

function dirSize(dir: string): number {
  const dirReal = fs.realpathSync(dir);
  let total = 0;
  for (const entry of fs.readdirSync(dirReal, { withFileTypes: true, recursive: true })) {
    if (entry.isSymbolicLink() || !entry.isFile()) continue;
    const real = fs.realpathSync(path.resolve(entry.parentPath, entry.name));
    if (real === dirReal || real.startsWith(dirReal + path.sep)) total += fs.statSync(real).size;
  }
  return total;
}

export function deriveInterimCatalog(publicDir: string): InterimCatalog {
  const publicReal = fs.realpathSync(publicDir);
  const bundleRootReal = fs.realpathSync(path.resolve(publicReal, 'bundle'));
  const routes: InterimRoute[] = [];
  for (const routeId of containedDirNames(bundleRootReal)) {
    // Entry names are interpolated into read paths; only the packager's
    // identifier shape is accepted, so a tampered tree fails with a named
    // diagnostic instead of reading arbitrary files.
    if (routeId === '.' || routeId === '..' || !isIdentifier(routeId)) {
      throw new Error(`unsafe bundle entry name: bundle/${routeId}`);
    }
    const routeDir = path.resolve(bundleRootReal, routeId);
    const routeDirReal = fs.realpathSync(routeDir);
    if (routeDirReal !== bundleRootReal && !routeDirReal.startsWith(bundleRootReal + path.sep)) continue;
    for (const version of containedDirNames(routeDirReal)) {
      if (version === '.' || version === '..' || !isIdentifier(version)) {
        throw new Error(`unsafe bundle entry name: bundle/${routeId}/${version}`);
      }
      const bundleDir = path.resolve(routeDirReal, version);
      const bundleDirReal = fs.realpathSync(bundleDir);
      if (bundleDirReal !== bundleRootReal && !bundleDirReal.startsWith(bundleRootReal + path.sep)) continue;
      const route = JSON.parse(fs.readFileSync(containedFilePath(bundleRootReal, bundleDirReal, 'route.json'), 'utf8'));
      const locales = containedDirNames(bundleDirReal).filter((name) =>
        fs.existsSync(path.join(bundleDirReal, name, 'base', 'stops.json')),
      );
      const layers = route.stops.some((s: { access_tier: string }) => s.access_tier === 'extended')
        ? ['base', 'extended']
        : ['base'];
      routes.push({ route_id: route.route_id, version, locales, layers, sizes: { base: dirSize(bundleDir) } });
    }
  }

  const discoveryRoot = path.resolve(publicReal, 'discovery');
  const discoveryReal = fs.realpathSync(discoveryRoot);
  const indexFiles: string[] = [];
  for (const entry of fs.readdirSync(discoveryReal, { withFileTypes: true, recursive: true })) {
    if (entry.isSymbolicLink() || !entry.isFile() || entry.name !== 'index.json') continue;
    const real = fs.realpathSync(path.resolve(entry.parentPath, entry.name));
    if (real === discoveryReal || real.startsWith(discoveryReal + path.sep)) indexFiles.push(real);
  }
  if (indexFiles.length !== 1) {
    throw new Error(`expected exactly one discovery index, found ${indexFiles.length}`);
  }
  const indexBytes = fs.readFileSync(indexFiles[0]!);
  const indexPath = path.relative(publicReal, indexFiles[0]!).replaceAll('\\', '/');
  const segments = indexPath.split('/');
  return {
    catalog_schema_version: 1,
    generated_at: new Date().toISOString(),
    routes,
    discovery_index: {
      schema_version: 1,
      revision: segments[2]!,
      path: indexPath,
      bytes: indexBytes.length,
      sha256: createHash('sha256').update(indexBytes).digest('hex'),
    },
  };
}
