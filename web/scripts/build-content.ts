// Interim build-time content drop for the web (G10.01.b): builds the
// demo-route fixture with the merged packager into web/content/ and writes
// the interim catalog.json derived from the built public tree (shared logic
// in lib/content/interim-catalog.ts). Real publication and the catalog
// pointer belong to G02.04 — this script is the fixture stand-in and never
// commits a content copy (web/.gitignore /content/, implementation-rules 5).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../../tools/build-bundle/build-bundle.mjs';
import { deriveInterimCatalog } from '../lib/content/interim-catalog.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const contentDir = path.join(REPO_ROOT, 'web', 'content');
const publicDir = path.join(contentDir, 'public');

fs.rmSync(contentDir, { recursive: true, force: true });
await buildBundle({ inDir: path.join(REPO_ROOT, 'fixtures', 'content', 'demo-route'), outDir: contentDir });

const catalog = deriveInterimCatalog(publicDir);
fs.writeFileSync(path.join(publicDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);

// Serve mirror for the bundle assets pages reference (story audio, covers):
// the same public tree copied into web/public/content/ so the static export
// serves the identical bytes at /content/… (single URL mapping point:
// lib/content/site.ts CONTENT_ASSET_BASE). Generated, never committed — the
// gitignore pattern lands in the same change (implementation-rules 5).
const publicMirror = path.join(REPO_ROOT, 'web', 'public', 'content');
fs.rmSync(publicMirror, { recursive: true, force: true });
fs.cpSync(publicDir, publicMirror, { recursive: true });

console.log(`content root ready: ${catalog.routes.length} route(s), discovery ${catalog.discovery_index.path}`);
