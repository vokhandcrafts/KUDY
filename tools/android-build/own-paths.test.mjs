// G21.36 (#592) [key: build-output-link-escape]: own-paths-cli.mjs, the
// own-paths.mjs checks for writers that are not Node (emulator-scenarios.ps1).
// Real junctions on Windows, directory symlinks elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(here, '..', '..');
const cli = path.join(here, 'own-paths-cli.mjs');
const isWindows = process.platform === 'win32';
const dirLink = (target, link) => fs.symlinkSync(target, link, isWindows ? 'junction' : 'dir');
const SCENARIO_ARGS = ['--dir', 'tmp', '--entries', 'evidence/android', '--file', 'logs/emulator.out.log'];

function fixture(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'g2136-own-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const foreign = path.join(base, 'foreign');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'results.json'), 'KEEP\n');
  return { base, root: path.join(base, 'build-root'), foreign };
}

const run = (root, args) => spawnSync(process.execPath, [cli, '--build-root', root, '--checkout', checkout, ...args], { encoding: 'utf8' });

function snapshot(dir) {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    out[path.relative(dir, full)] = entry.isFile() ? fs.readFileSync(full, 'utf8') : 'dir';
  }
  return out;
}

test('own-paths-cli: creates the scenario directories below a fresh build root', (t) => {
  const f = fixture(t);
  const result = run(f.root, SCENARIO_ARGS);
  assert.equal(result.status, 0, result.stderr);
  for (const dir of ['tmp', 'logs', path.join('evidence', 'android')]) assert.ok(fs.statSync(path.join(f.root, dir)).isDirectory(), dir);
  assert.equal(run(f.root, SCENARIO_ARGS).status, 0, 'a second run accepts its own directories');
});

for (const rel of ['tmp', 'logs', 'evidence', path.join('evidence', 'android')]) {
  test(`own-paths-cli: ${rel.replaceAll('\\', '/')} as a junction out of the build root is refused and the target stays unchanged`, (t) => {
    const f = fixture(t);
    fs.mkdirSync(path.dirname(path.join(f.root, rel)), { recursive: true });
    dirLink(f.foreign, path.join(f.root, rel));
    const before = snapshot(f.foreign);
    const result = run(f.root, SCENARIO_ARGS);
    assert.equal(result.status, 73, result.stderr);
    assert.match(result.stderr, /own-paths: refused: .* is a link to /);
    assert.deepEqual(snapshot(f.foreign), before, 'nothing was created or changed in the foreign directory');
  });
}

for (const kind of ['hard link', 'symlink']) {
  for (const rel of [path.join('evidence', 'android', 'results.json'), path.join('logs', 'emulator.out.log')]) {
    test(`own-paths-cli: ${rel.replaceAll('\\', '/')} as a ${kind} to a foreign file is refused`, (t) => {
      const f = fixture(t);
      const own = path.join(f.root, rel);
      fs.mkdirSync(path.dirname(own), { recursive: true });
      const foreignFile = path.join(f.foreign, 'results.json');
      try {
        if (kind === 'symlink') fs.symlinkSync(foreignFile, own, 'file');
        else fs.linkSync(foreignFile, own);
      } catch (error) {
        if (error.code === 'EPERM') return t.skip('creating a file symlink needs the symlink privilege on this host');
        throw error;
      }
      const result = run(f.root, SCENARIO_ARGS);
      assert.equal(result.status, 73, result.stderr);
      assert.match(result.stderr, kind === 'symlink' ? /is a link to/ : /has 2 hard links/);
      assert.equal(fs.readFileSync(foreignFile, 'utf8'), 'KEEP\n');
    });
  }
}

test('own-paths-cli: a path leaving the build root by .. and a missing build root are refused', (t) => {
  const f = fixture(t);
  const dotdot = run(f.root, ['--dir', '../foreign']);
  assert.equal(dotdot.status, 73, dotdot.stderr);
  assert.match(dotdot.stderr, /not a plain path below the build root/);
  const usage = spawnSync(process.execPath, [cli, '--dir', 'tmp'], { encoding: 'utf8' });
  assert.equal(usage.status, 64);
});
