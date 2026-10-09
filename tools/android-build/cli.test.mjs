// G21.36 (#592), review findings [key: cleanup-with-active-build],
// [key: build-output-link-escape] and [key: stale-lock-reclaim-race]: `clean
// --apply` never deletes while a build of the same checkout runs, a build
// never writes through a link below its build root, and a stale lock is
// reported, never taken over. The CLI is run for real from a copy inside a
// miniature checkout, because its checkout root comes from the script location.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';
const MODULES = ['android-build.mjs', 'build-config.mjs', 'scoped-clean.mjs', 'checkout-lock.mjs', 'own-paths.mjs'];

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
  // One commit, so the build record can name its HEAD (throwaway repository:
  // no hooks, no signing).
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--no-verify', '-m', 'fixture'], { cwd: checkout });
  const sdk = path.join(base, 'sdk');
  write(path.join(sdk, 'platform-tools', isWindows ? 'adb.exe' : 'adb'));
  const jdk = path.join(base, 'jdk');
  write(path.join(jdk, 'release'), 'JAVA_VERSION="17.0.1"\n');
  const buildRoot = path.join(base, 'build-root');
  const cli = path.join(checkout, 'tools', 'android-build', 'android-build.mjs');
  const args = (...command) => [cli, ...command, '--build-root', buildRoot, '--sdk', sdk, '--jdk', jdk];
  return { base, checkout, buildRoot, args, output: path.join(checkout, 'android', 'app', 'build', 'out.apk'),
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
  assert.match(fs.readFileSync(path.join(f.buildRoot, 'gradle-home', 'gradle.properties'), 'utf8'), /^org\.gradle\.daemon=false$/m);
  const records = fs.readdirSync(path.join(f.buildRoot, 'records'));
  assert.equal(records.length, 1, 'the build wrote its record');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.buildRoot, 'records', records[0]), 'utf8')).exitCode, 0);
  assert.equal(fs.readdirSync(path.join(f.buildRoot, 'logs')).length, 1);
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

// Snapshot of every file under dir (relative path -> content).
function snapshot(dir) {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    if (entry.isFile()) out[path.relative(dir, full)] = fs.readFileSync(full, 'utf8');
  }
  return out;
}

const dirLink = (target, link) => fs.symlinkSync(target, link, isWindows ? 'junction' : 'dir');

// [key: build-output-link-escape]: the reviewer's case and its siblings. Each
// task-owned directory in turn is a junction (a directory symlink on Linux) to
// a foreign directory; preflight reports it, build exits 73 before the first
// write, and the foreign directory is byte-for-byte unchanged.
for (const name of ['gradle-home', 'tmp', 'logs', 'records']) {
  test(`cli: build refuses a ${name} that is a junction out of the build root and writes nothing there`, (t) => {
    const f = fixture(t);
    const shared = path.join(f.base, `shared-${name}`);
    write(path.join(shared, 'gradle.properties'), 'shared-setting=KEEP\n');
    fs.mkdirSync(f.buildRoot);
    dirLink(shared, path.join(f.buildRoot, name));
    const before = snapshot(shared);

    const preflight = run(f.args('preflight'));
    assert.equal(preflight.status, 1, preflight.stderr);
    assert.match(preflight.stderr, new RegExp(`preflight: .*${name} is a link`));
    const build = run(f.args('build'));
    assert.equal(build.status, 73, build.stderr);
    assert.match(build.stderr, new RegExp(`${name} is a link`));
    assert.deepEqual(snapshot(shared), before, 'the foreign directory is unchanged');
    assert.equal(fs.existsSync(f.lock), false, 'the refused build released the lock');
  });
}

// A link on gradle.properties itself: a file symlink (needs the symlink
// privilege or Developer Mode on Windows) and a hard link (no privilege).
for (const kind of ['symlink', 'hard link']) {
  test(`cli: build refuses a gradle.properties that is a ${kind} to a foreign file`, (t) => {
    const f = fixture(t);
    const foreign = path.join(f.base, 'shared-gradle', 'gradle.properties');
    write(foreign, 'shared-setting=KEEP\n');
    const own = path.join(f.buildRoot, 'gradle-home', 'gradle.properties');
    fs.mkdirSync(path.dirname(own), { recursive: true });
    try {
      if (kind === 'symlink') fs.symlinkSync(foreign, own, 'file');
      else fs.linkSync(foreign, own);
    } catch (error) {
      if (error.code === 'EPERM') return t.skip('creating a file symlink needs the symlink privilege on this host');
      throw error;
    }
    const build = run(f.args('build'));
    assert.equal(build.status, 73, build.stderr);
    assert.match(build.stderr, kind === 'symlink' ? /gradle\.properties is a link/ : /gradle\.properties has 2 hard links/);
    assert.equal(fs.readFileSync(foreign, 'utf8'), 'shared-setting=KEEP\n');
  });
}

// A pid that certainly ran on this host and has exited.
async function deadPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((resolve) => child.on('close', resolve));
  return child.pid;
}

// [key: stale-lock-reclaim-race]: two claimants start together after the
// owner died. Neither takes the lock over; both stop with the stale-lock
// message, and the stale file is left as it was for a person to remove.
test('cli: two concurrent claimants after a dead owner both refuse the stale lock and leave it untouched', async (t) => {
  const f = fixture(t);
  const pid = await deadPid();
  const stale = JSON.stringify({ pid, command: 'build', host: os.hostname(), startedAt: '2026-10-08T00:00:00.000Z' });
  fs.writeFileSync(f.lock, stale);
  const claim = (command) => new Promise((resolve) => {
    const child = spawn(process.execPath, f.args(...command), { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stderr }));
  });
  const results = await Promise.all([claim(['build']), claim(['clean', '--apply'])]);
  for (const result of results) {
    assert.equal(result.status, 75, result.stderr);
    assert.match(result.stderr, new RegExp(`stale checkout lock .* left by process ${pid} .*no longer runs.*delete that file`));
  }
  assert.equal(fs.readFileSync(f.lock, 'utf8'), stale, 'the stale lock is neither removed nor replaced');
  assert.equal(fs.existsSync(f.buildRoot), false, 'no build started');
  assert.equal(fs.existsSync(f.output), true, 'no cleanup ran');

  fs.rmSync(f.lock);
  const after = run(f.args('clean', '--apply'));
  assert.equal(after.status, 0, after.stderr);
});

test('acquireLock: a live holder blocks; a dead holder of this host is reported as stale and kept', async (t) => {
  const { acquireLock } = await import('./checkout-lock.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2136-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'lock');
  const first = acquireLock(file, 'build');
  assert.ok(first.release);
  const blocked = acquireLock(file, 'clean --apply');
  assert.equal(blocked.holder?.command, 'build');
  assert.equal(blocked.stale, false);
  first.release();
  assert.equal(fs.existsSync(file), false);

  const dead = JSON.stringify({ pid: 4242, command: 'build', host: os.hostname() });
  fs.writeFileSync(file, dead);
  const stale = acquireLock(file, 'clean --apply', { alive: () => false });
  assert.equal(stale.release, undefined, 'a stale lock is not taken over');
  assert.deepEqual([stale.stale, stale.holder.pid], [true, 4242]);
  assert.equal(fs.readFileSync(file, 'utf8'), dead);
  fs.writeFileSync(file, JSON.stringify({ pid: 4242, command: 'build', host: os.hostname().toUpperCase() }));
  assert.equal(acquireLock(file, 'build', { alive: () => false }).stale, true, 'host names compare case-insensitively');
  fs.writeFileSync(file, JSON.stringify({ pid: 4242, command: 'build', host: 'other-host' }));
  assert.equal(acquireLock(file, 'build', { alive: () => false }).stale, false, 'a lock of another host is never judged stale');
  fs.writeFileSync(file, 'garbage');
  assert.ok(acquireLock(file, 'build').holder?.unreadable, 'an unreadable lock counts as held');
});
