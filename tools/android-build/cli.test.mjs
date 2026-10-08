// G21.36 (#592), review finding [key: cleanup-with-active-build]: `clean
// --apply` never deletes while a build of the same checkout runs. The CLI is
// run for real from a copy inside a miniature checkout, because its checkout
// root comes from the script location.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';
const MODULES = ['android-build.mjs', 'build-config.mjs', 'scoped-clean.mjs', 'checkout-lock.mjs'];

function write(file, text = 'x', mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (mode) fs.chmodSync(file, mode);
}

// Checkout with the tool, an ignored android/ project whose Gradle wrapper
// only sleeps, generated output to clean, a fake SDK (adb) and JDK 17 release
// file, and a build root next to the checkout.
function fixture(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'g2136-cli-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const checkout = path.join(base, 'checkout');
  for (const name of MODULES) write(path.join(checkout, 'tools', 'android-build', name), fs.readFileSync(path.join(here, name)));
  write(path.join(checkout, '.gitignore'), 'node_modules/\n/android/\n');
  if (isWindows) write(path.join(checkout, 'android', 'gradlew.bat'), '@ping -n 9 127.0.0.1 >nul\r\n@exit /b 0\r\n');
  else write(path.join(checkout, 'android', 'gradlew'), '#!/bin/sh\nsleep 8\n', 0o755);
  write(path.join(checkout, 'android', 'app', 'build', 'out.apk'), 'generated');
  execFileSync('git', ['init', '-q'], { cwd: checkout });
  execFileSync('git', ['add', '.gitignore', 'tools'], { cwd: checkout });
  const sdk = path.join(base, 'sdk');
  write(path.join(sdk, 'platform-tools', isWindows ? 'adb.exe' : 'adb'));
  const jdk = path.join(base, 'jdk');
  write(path.join(jdk, 'release'), 'JAVA_VERSION="17.0.1"\n');
  const buildRoot = path.join(base, 'build-root');
  const cli = path.join(checkout, 'tools', 'android-build', 'android-build.mjs');
  const args = (...command) => [cli, ...command, '--build-root', buildRoot, '--sdk', sdk, '--jdk', jdk];
  return { base, checkout, args, output: path.join(checkout, 'android', 'app', 'build', 'out.apk'),
    lock: path.join(checkout, '.git', 'kudy-android-build.lock') };
}

const run = (args) => spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120_000 });

async function waitFor(predicate, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

test('cli: clean --apply is refused while a build of the same checkout holds the lock, and runs after it', async (t) => {
  const f = fixture(t);
  const build = spawn(process.execPath, f.args('build'), { stdio: 'ignore' });
  const buildExit = new Promise((resolve) => build.on('close', resolve));
  t.after(() => build.exitCode === null && build.kill());
  assert.ok(await waitFor(() => fs.existsSync(f.lock), 30_000), 'build takes the checkout lock');

  const concurrent = run(f.args('clean', '--apply'));
  assert.equal(concurrent.status, 75, concurrent.stderr);
  assert.match(concurrent.stderr, /locked by .*"command":"build"/);
  assert.equal(fs.existsSync(f.output), true, 'nothing is deleted under a running build');

  await buildExit;
  assert.equal(fs.existsSync(f.lock), false, 'the build releases the lock when it ends');
  const after = run(f.args('clean', '--apply'));
  assert.equal(after.status, 0, after.stderr);
  assert.equal(fs.existsSync(f.output), false);
  assert.equal(fs.existsSync(f.lock), false);
});

test('cli: clean --apply is refused while a build JVM of this checkout runs, even without a lock', async (t) => {
  const f = fixture(t);
  // A real process named java that mentions the checkout, standing for a
  // Gradle client of another session. Hard-linked node binary, so the process
  // table shows the JVM name the tool looks for.
  const java = path.join(f.base, isWindows ? 'java.exe' : 'java');
  try {
    fs.linkSync(process.execPath, java);
  } catch {
    fs.copyFileSync(process.execPath, java);
    fs.chmodSync(java, 0o755);
  }
  const jvm = spawn(java, ['-e', 'setTimeout(() => {}, 60000)', path.join(f.checkout, 'android')], { stdio: 'ignore' });
  const jvmExit = new Promise((resolve) => jvm.on('close', resolve));
  await new Promise((resolve) => setTimeout(resolve, 500));

  let result;
  try {
    result = run(f.args('clean', '--apply'));
  } finally {
    // Stop the process this test started before its executable is removed.
    jvm.kill();
    await jvmExit;
  }
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr, /build process of another session in this checkout/);
  assert.equal(fs.existsSync(f.output), true);
  assert.equal(fs.existsSync(f.lock), false, 'the refused clean released the lock');
});

test('cli: a build root that aliases the checkout through a junction is refused before any command runs', (t) => {
  const f = fixture(t);
  const alias = path.join(f.base, 'alias');
  fs.symlinkSync(f.checkout, alias, 'junction');
  const args = f.args('clean', '--apply');
  args[args.indexOf('--build-root') + 1] = path.join(alias, 'node_modules', 'build-root');
  const result = run(args);
  assert.equal(result.status, 64, result.stderr);
  assert.match(result.stderr, /outside the checkout/);
  assert.equal(fs.existsSync(f.output), true);
});

test('acquireLock: a live holder blocks, a dead holder of this host is taken over once', async (t) => {
  const { acquireLock } = await import('./checkout-lock.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2136-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'lock');
  const first = acquireLock(file, 'build');
  assert.ok(first.release);
  assert.equal(acquireLock(file, 'clean --apply').holder?.command, 'build');
  first.release();
  assert.equal(fs.existsSync(file), false);

  fs.writeFileSync(file, JSON.stringify({ pid: 4242, command: 'build', host: os.hostname() }));
  const taken = acquireLock(file, 'clean --apply', { alive: () => false });
  assert.ok(taken.release, 'stale lock of a dead process is taken over');
  taken.release();
  fs.writeFileSync(file, 'garbage');
  assert.ok(acquireLock(file, 'build').holder?.unreadable, 'an unreadable lock counts as held');
});
