// Shared runner for the arch checks: executes the pinned dependency-cruiser
// CLI in a child process (19 §2.4 idiom — tooling is a separate process; this
// module only locates and spawns the binary) and returns the parsed cruise
// result. Used by arch-check.mjs (gate) and arch-baseline.mjs (regeneration).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

function cruiseBin() {
  let entryUrl;
  try {
    // dependency-cruiser is ESM-only (its exports map has no "require"
    // condition), so import.meta.resolve — not a require resolver — is what
    // can find it from here.
    entryUrl = import.meta.resolve('dependency-cruiser');
  } catch {
    return { error: 'dependency-cruiser is not installed — run `npm ci` (it is pinned in devDependencies)' };
  }
  let dir = path.dirname(fileURLToPath(entryUrl));
  for (let i = 0; i < 8 && dir !== path.dirname(dir); i++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (parsed.name !== 'dependency-cruiser') continue;
        const bin = typeof parsed.bin === 'string' ? parsed.bin : parsed.bin?.depcruise;
        if (!bin) {
          return { error: `dependency-cruiser package.json exposes no depcruise bin (bin: ${JSON.stringify(parsed.bin)})` };
        }
        return { bin: path.join(dir, bin) };
      } catch {
        return { error: `dependency-cruiser package.json at ${candidate} is not valid JSON` };
      }
    }
    dir = path.dirname(dir);
  }
  return { error: 'resolved dependency-cruiser but could not locate its package root' };
}

// Shared CLI shape of the arch scripts: --config <file> --baseline <file> <dirs...>.
// Returns { configFile, baselineFile, dirs } or { error } with a usage line.
export function parseCruiseArgs(argv) {
  const usage = 'usage: node <script> --config <dependency-cruiser-config> --baseline <baseline.json> <zone-dirs...>';
  const args = { configFile: null, baselineFile: null, dirs: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') args.configFile = argv[++i] ?? null;
    else if (argv[i] === '--baseline') args.baselineFile = argv[++i] ?? null;
    else args.dirs.push(argv[i]);
  }
  const missing = [
    args.configFile ? null : '--config <file>',
    args.baselineFile ? null : '--baseline <file>',
    args.dirs.length > 0 ? null : '<zone-dirs...>',
  ].filter(Boolean);
  if (missing.length > 0) return { error: `${usage}\nmissing: ${missing.join(', ')}` };
  return args;
}

// Runs `depcruise --config <configFile> --output-type json <dirs...>` with cwd
// as the working directory. Returns { result } on a parseable cruise (even one
// with violations — the caller decides), or { error } with a diagnostic.
export function runCruise({ configFile, dirs, cwd }) {
  const found = cruiseBin();
  if (found.error) return { error: found.error };

  const run = spawnSync(
    process.execPath,
    [found.bin, '--config', configFile, '--output-type', 'json', ...dirs],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.error) {
    return { error: `depcruise could not be spawned: ${run.error.message}` };
  }
  let result;
  try {
    result = JSON.parse(run.stdout);
  } catch {
    return {
      error: [
        'depcruise did not produce JSON on stdout (exit '
          + String(run.status) + ') — config or CLI failure:',
        run.stderr.trim() || '(no stderr)',
      ].join('\n'),
    };
  }
  return { result };
}

// Normalizes a violation to the baseline key triplet. Paths arrive relative to
// the cruise cwd with forward slashes already; normalize defensively anyway so
// Windows backslashes from a future reporter change cannot fork the key space.
export function violationKey(violation) {
  const slash = (p) => String(p ?? '').replaceAll('\\', '/');
  return [violation.rule?.name, slash(violation.from), slash(violation.to)].join('|');
}

// Flattens the cruise result to baseline-shaped error-severity entries.
export function errorViolations(result) {
  return (result.summary?.violations ?? [])
    .filter((v) => v.rule?.severity === 'error')
    .map((v) => ({ rule: v.rule.name, from: v.from.replaceAll('\\', '/'), to: v.to.replaceAll('\\', '/') }));
}
