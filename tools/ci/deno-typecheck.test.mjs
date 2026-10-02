// G20.13 (#484) behavioral proof for tools/ci/deno-typecheck.mjs — the check
// is configuration-as-code (implementation-rules 1): each fail-closed gate
// here turns red if its guard is removed from the script, and the two
// runtime-backed cases run the real `deno check` (the fixture case must fail
// again if the A26-01-type async mismatch were tolerated by the graph).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findEntrypoints } from './deno-typecheck.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(repoRoot, 'tools', 'ci', 'deno-typecheck.mjs');
const functionsDir = path.join(repoRoot, 'supabase', 'functions');
const fixture = path.join('supabase', 'functions', '_fixtures', 'deno-async-mismatch.ts');

function runScript(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

const denoProbe = spawnSync(process.env.KUDY_DENO ?? 'deno', ['--version'], { encoding: 'utf8' });
const denoUnavailableReason = denoProbe.status === 0
  ? false
  : 'Deno runtime not available on this host — install the pinned version from supabase/functions/.deno-version (the fail-closed gates below still run)';

test('empty enumeration fails closed before any runtime probe', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'kudy-no-functions-'));
  try {
    const result = runScript([], { KUDY_FUNCTIONS_DIR: empty });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /no production entrypoint/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('missing Deno runtime fails closed with the install hint', () => {
  const result = runScript([], { KUDY_DENO: path.join(tmpdir(), 'kudy-deno-typecheck-absent', 'deno') });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /Deno runtime not found/);
  assert.match(result.stderr, /\.deno-version/);
});

test('runtime version drift from the committed pin fails closed', { skip: process.platform === 'win32' && 'the fake runtime is a POSIX shell script' }, (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kudy-deno-pin-'));
  const fake = path.join(dir, 'fake-deno');
  writeFileSync(fake, '#!/bin/sh\necho "deno 0.0.0 (stable, release, fake)"\n');
  chmodSync(fake, 0o755);
  try {
    const result = runScript([], { KUDY_DENO: fake });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /version drift/);
    assert.match(result.stderr, /0\.0\.0/);
    assert.match(result.stderr, /2\.9\.7/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  t.diagnostic('fake runtime answered deno 0.0.0; the pin named the required version');
});

test('clean production entrypoints pass under the pinned runtime', { skip: denoUnavailableReason }, () => {
  const result = runScript([]);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /4 production entrypoint\(s\)/);
  assert.match(result.stdout, /lock frozen/);
});

test('the planted A26-01 async mismatch is rejected with a named diagnostic', { skip: denoUnavailableReason }, () => {
  const result = runScript(['--file', fixture]);
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /TS\d+/, 'a named TS diagnostic, not a crash');
  assert.match(result.stderr, /async-mismatch\.ts/);
});

test('the fixture is not part of the production enumeration', () => {
  const entrypoints = findEntrypoints(functionsDir).map((entry) => path.relative(functionsDir, entry));
  assert.deepEqual(entrypoints, ['device/index.ts', 'events/index.ts', 'grant/index.ts', 'rc-webhook/index.ts']);
});

test('a directory without index.ts files yields no entrypoints', () => {
  const bare = mkdtempSync(path.join(tmpdir(), 'kudy-bare-functions-'));
  try {
    mkdirSync(path.join(bare, 'device'), { recursive: true });
    writeFileSync(path.join(bare, 'device', 'handler.ts'), 'export const x = 1;\n');
    assert.deepEqual(findEntrypoints(bare), []);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});
