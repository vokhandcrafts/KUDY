// G23.02 web E2E runner (issue #660) — the one command behind `npm run
// e2e:web`: builds the deterministic synthetic origin (G23.01), builds the
// real static export of the site against it, swaps the exported content
// mirror for the synthetic publication target, and runs the web/e2e journey
// suite. Nothing here restates an npm script's internals: every build step
// invokes the existing tool or script verbatim (implementation-rules 2/3 —
// the wiring is composed, not copied).
//
//   npm run e2e:web                 # full: origin + web build + journeys
//   node web/e2e/run-e2e.mjs --skip-build   # reuse an existing web/out
//
// The suite also runs under plain `npm test` through the web/**/*.test.ts
// glob and skips visibly when web/out is absent — this runner is the path
// that produces the build the journeys assert.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// The publication target sits one level below the --out dir (the served
// root itself): catalog.json at the origin, bundle/places/collections/
// discovery beside it (serve-e2e-origin.mjs, G23.01).
const ORIGIN_BUILD = path.join(REPO_ROOT, 'tools', 'e2e-origin', 'build', 'origin');
const WEB_OUT = path.join(REPO_ROOT, 'web', 'out');

const skipBuild = process.argv.includes('--skip-build');

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!skipBuild) {
  // 0. The origin output is an uncommitted fixture build output: a stale
  //    target would serve old releases (published versions are immutable —
  //    a changed package could not republish), so every run starts clean.
  fs.rmSync(path.join(REPO_ROOT, 'tools', 'e2e-origin', 'build'), { recursive: true, force: true });

  // 1. The synthetic catalog: the production publishing path only (G23.01).
  //    The web publishes the paid-guide package alone (G23.02): the web
  //    reader resolves every catalog route against the ACTIVE discovery
  //    revision, and a one-package city keeps catalog.json and the pointer
  //    coherent — the paid package carries both journey halves of criterion 1
  //    (its base stop is the free audio stop, its extended stop the locked
  //    one). The two-package default stays untouched for the app suites.
  run(process.execPath, ['tools/e2e-origin/serve-e2e-origin.mjs', '--no-serve', '--packages', 'paid-guide']);

  // 2. The real static export with the pages reading the synthetic origin.
  //    The npm prebuild still drops the demo mirror — the swap below is what
  //    the exported site serves, so pages and assets come from one tree.
  run('npm', ['--prefix', 'web', 'run', 'build'], { KUDY_CONTENT_ROOT: ORIGIN_BUILD });

  // 3. The exported content mirror becomes the synthetic publication target
  //    — the same tree the pages read at build time (web/.gitignore keeps
  //    both out/ and public/content/ uncommitted; implementation-rules 5).
  //    The whitelist entries are the documented public layout the readers
  //    consume (web/lib/content/bundle.ts); publish artifacts like releases/
  //    and catalog.previous.json are not site content and are not exported.
  //    A package subset lays only its own entries (the paid-guide build has
  //    no collections/ — that dir belongs to the free package), so absent
  //    whitelist entries are skipped, never fabricated.
  fs.rmSync(path.join(WEB_OUT, 'content'), { recursive: true, force: true });
  fs.mkdirSync(path.join(WEB_OUT, 'content'));
  for (const entry of ['catalog.json', 'bundle', 'places', 'collections', 'discovery']) {
    const source = path.join(ORIGIN_BUILD, entry);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(WEB_OUT, 'content', entry), { recursive: true });
  }
}

// 4. The journey suite. Node ≥ 22 expands the glob itself (no shell globbing).
run(process.execPath, [
  '--test',
  '--experimental-strip-types',
  '--test-reporter=spec',
  'web/e2e/*.browser.test.ts',
]);
