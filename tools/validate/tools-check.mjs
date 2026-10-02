// G20.16 (issue #487): enforced async/error check over production tools/*.mjs.
//
// The check is a pinned type-aware ESLint run (eslint.config.mjs) over every
// committed non-test tools/*.mjs outside fixtures/. `npm run tools:check` is
// the named command; tools/validate/tools-check.test.mjs keeps it wired and
// proves the rules still catch the named defects via negative fixtures.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
// eslint does not export its bin subpath, so resolve the package root (the
// package.json subpath is exported) and join the physical bin location.
export const eslintBin = path.join(path.dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js');

export function collectProductionToolFiles(root = path.join(repoRoot, 'tools')) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // fixtures/ holds deliberate violations or broken-import data for the
        // negative guards; it is never part of the enforced pass.
        if (entry.name === 'fixtures') continue;
        walk(full);
      } else if (entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) {
        files.push(path.relative(repoRoot, full).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return files;
}

export function runEslint(relativeFiles, { unignored = false } = {}) {
  const run = spawnSync(
    process.execPath,
    unignored ? [eslintBin, '--no-ignore', ...relativeFiles] : [eslintBin, ...relativeFiles],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  // eslint prints absolute file paths; make the report location-independent so
  // CI logs, guard failures and captured demos stay host-independent.
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.split(`${repoRoot}/`).join('');
  return { status: run.status ?? -1, output };
}

export function runEslintUnignored(relativeFiles) {
  return runEslint(relativeFiles, { unignored: true });
}

// Fail-closed production pass: an empty selection or a lint failure must not
// look like success. Returns the exit status and report without exiting, so
// the guard suite can test the behavior directly.
export function productionPassOutcome(files) {
  if (files.length === 0) {
    return { status: 2, output: 'tools-check: empty production selection — refusing to pass silently\n' };
  }
  const { status, output } = runEslint(files);
  if (status === 0) {
    return { status: 0, output: `tools-check: ${files.length} production tool files clean\n` };
  }
  return { status: status > 0 ? status : 1, output };
}

function main() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  if (fileIndex !== -1) {
    const target = args[fileIndex + 1];
    if (!target) {
      console.error('tools-check: --file requires a path');
      process.exit(2);
    }
    const rel = path.relative(repoRoot, path.resolve(repoRoot, target)).split(path.sep).join('/');
    const { status, output } = runEslintUnignored([rel]);
    if (output.trim()) process.stdout.write(output);
    process.exit(status === 0 ? 0 : status > 0 ? status : 1);
  }

  const { status, output } = productionPassOutcome(collectProductionToolFiles());
  if (output.trim()) {
    // A clean run reports on stdout; diagnostics for a refused or failing
    // run go to stderr so pipelines do not read them as normal output.
    (status === 0 ? process.stdout : process.stderr).write(output);
  }
  process.exit(status);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
