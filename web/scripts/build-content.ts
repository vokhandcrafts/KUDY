// Interim build-time content drop for the web (G10.01.b): builds the
// demo-route fixture with the merged packager into web/content/ and writes
// the interim catalog.json derived from the built public tree (shared logic
// in the contracts zone: contracts/interim-catalog.mjs). Real publication and
// the catalog pointer belong to G02.04 — this script is the fixture stand-in
// and never commits a content copy (web/.gitignore /content/,
// implementation-rules 5).
// G20.18 (issue #489): the packager runs through its supported process entry
// (node tools/build-bundle/build-bundle.mjs --in/--out, exit codes 0/1/2) —
// the web prebuild no longer imports the authoring tool into its own process
// (specification verification-integration §V2; audit A26-09).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deriveInterimCatalog } from '../../contracts/interim-catalog.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const contentDir = path.join(REPO_ROOT, 'web', 'content');
const publicDir = path.join(contentDir, 'public');

fs.rmSync(contentDir, { recursive: true, force: true });

// The tool answers with its own exit codes (0 ok, 1 BuildError, 2 usage) and
// prints its diagnostics as JSON on stderr — forwarded verbatim, the build
// fails with the tool's exit code (implementation-rules 4: errors surfaced).
const build = spawnSync(
  process.execPath,
  [path.join(REPO_ROOT, 'tools', 'build-bundle', 'build-bundle.mjs'), '--in', path.join(REPO_ROOT, 'fixtures', 'content', 'demo-route'), '--out', contentDir],
  { encoding: 'utf8' },
);
if (build.error) {
  console.error(build.error.message);
  process.exit(1);
}
if (build.status !== 0) {
  process.stderr.write(build.stderr ?? '');
  process.exit(build.status ?? 1);
}

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
