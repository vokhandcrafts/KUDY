// G20.13 (#484) — the Deno type-check over the production supabase/functions
// entrypoints and their full import graph (verification-integration spec V1:
// no entrypoint excluded, no cast around an async mismatch, no live secret).
//
// Fail-closed policy — every missing check input is a nonzero exit, never a
// pass:
//   - the functions directory must yield at least one `*/index.ts`
//     entrypoint (KUDY_FUNCTIONS_DIR overrides the location for tests);
//   - the Deno binary must exist (PATH, or KUDY_DENO) and its version must
//     equal the committed pin `supabase/functions/.deno-version`;
//   - `deno check --frozen-lockfile` errors out when `deno.lock` is missing
//     or out of date, so the dependency graph stays pinned.
//
// `--file <path>` checks one file instead of the enumerated entrypoints —
// the committed A26-01 fixture proof uses it (deno-typecheck.test.mjs).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function findEntrypoints(functionsDir) {
  if (!existsSync(functionsDir)) return [];
  return readdirSync(functionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .filter((name) => existsSync(path.join(functionsDir, name, 'index.ts')))
    .map((name) => path.join(functionsDir, name, 'index.ts'));
}

function fail(message) {
  console.error(`deno-typecheck: FAIL — ${message}`);
  process.exit(1);
}

function main() {
  const functionsDir = process.env.KUDY_FUNCTIONS_DIR ?? path.join(repoRoot, 'supabase', 'functions');
  const fileArgs = [];
  const argv = process.argv.slice(2);
  if (argv[0] === '--file') {
    if (typeof argv[1] !== 'string' || argv[1] === '') fail('--file requires a path');
    fileArgs.push(path.resolve(repoRoot, argv[1]));
  } else if (argv.length > 0) {
    fail(`unknown argument: ${argv[0]}`);
  }

  const entrypoints = fileArgs.length > 0 ? fileArgs : findEntrypoints(functionsDir);
  if (entrypoints.length === 0) {
    fail(`no production entrypoint found under ${functionsDir} — the enumeration must never pass an empty set`);
  }

  const deno = process.env.KUDY_DENO ?? 'deno';
  const probe = spawnSync(deno, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    fail(
      `Deno runtime not found (${deno}: ${probe.error?.code ?? `exit ${probe.status}`}) — `
        + 'install the pinned version from supabase/functions/.deno-version or set KUDY_DENO',
    );
  }
  const actualVersion = (probe.stdout ?? '').match(/^deno (\d+\.\d+\.\d+)/m)?.[1] ?? null;
  const pinPath = path.join(functionsDir, '.deno-version');
  let pinnedVersion = null;
  try {
    pinnedVersion = readFileSync(pinPath, 'utf8').trim() || null;
  } catch {
    // missing pin file is a missing check input, handled below
  }
  if (pinnedVersion === null) {
    fail(`missing runtime pin: ${pinPath} does not name the required Deno version`);
  }
  if (actualVersion !== pinnedVersion) {
    fail(`Deno version drift: runtime ${actualVersion ?? 'unknown'}, pin ${pinnedVersion} (${pinPath})`);
  }

  const check = spawnSync(
    deno,
    ['check', '--frozen-lockfile', '--quiet', ...entrypoints],
    { cwd: functionsDir, encoding: 'utf8' },
  );
  if (check.error || check.status !== 0) {
    if (check.stdout) process.stdout.write(check.stdout);
    if (check.stderr) process.stderr.write(check.stderr);
    fail(
      `deno check rejected the entrypoint graph (${check.error?.code ?? `exit ${check.status}`}) `
        + `— ${entrypoints.length} entrypoint(s) under ${path.relative(repoRoot, functionsDir)}`,
    );
  }
  console.log(`deno-typecheck: OK — ${entrypoints.length} production entrypoint(s), Deno ${pinnedVersion}, lock frozen`);
}

// CLI entry only — importing findEntrypoints from the test suite must not
// execute the check (a fail-closed exit during import would crash the suite
// on hosts without Deno instead of skipping the runtime-backed cases).
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
