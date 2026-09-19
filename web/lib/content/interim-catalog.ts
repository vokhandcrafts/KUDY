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

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += fs.statSync(path.join(entry.parentPath, entry.name)).size;
  }
  return total;
}

export function deriveInterimCatalog(publicDir: string): InterimCatalog {
  const routes: InterimRoute[] = [];
  const bundleRoot = path.resolve(publicDir, 'bundle');
  const insideRoot = (target: string): boolean =>
    target === bundleRoot || target.startsWith(bundleRoot + path.sep);
  for (const routeId of fs.readdirSync(bundleRoot).sort()) {
    // Entry names are interpolated into read paths; only the packager's
    // identifier shape is accepted, and every read root is pinned inside the
    // bundle tree, so a tampered tree fails loudly instead of reading
    // arbitrary files (implementation-rules 14).
    if (!isIdentifier(routeId)) throw new Error(`unsafe bundle entry name: bundle/${routeId}`);
    const routeDir = path.resolve(bundleRoot, routeId);
    if (!insideRoot(routeDir)) continue;
    for (const version of fs.readdirSync(routeDir).sort()) {
      if (!isIdentifier(version)) throw new Error(`unsafe bundle entry name: bundle/${routeId}/${version}`);
      const bundleDir = path.resolve(routeDir, version);
      if (!insideRoot(bundleDir)) continue;
      const route = JSON.parse(fs.readFileSync(path.join(bundleDir, 'route.json'), 'utf8'));
      const locales = fs
        .readdirSync(bundleDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(bundleDir, e.name, 'base', 'stops.json')))
        .map((e) => e.name)
        .sort();
      const layers = route.stops.some((s: { access_tier: string }) => s.access_tier === 'extended')
        ? ['base', 'extended']
        : ['base'];
      routes.push({ route_id: route.route_id, version, locales, layers, sizes: { base: dirSize(bundleDir) } });
    }
  }

  const indexFiles: string[] = [];
  for (const entry of fs.readdirSync(path.join(publicDir, 'discovery'), { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === 'index.json') indexFiles.push(path.join(entry.parentPath, entry.name));
  }
  if (indexFiles.length !== 1) {
    throw new Error(`expected exactly one discovery index, found ${indexFiles.length}`);
  }
  const indexBytes = fs.readFileSync(indexFiles[0]!);
  const indexPath = path.relative(publicDir, indexFiles[0]!).replaceAll('\\', '/');
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
