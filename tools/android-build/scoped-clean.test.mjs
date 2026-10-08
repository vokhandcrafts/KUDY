// G21.36 (#592): the cleanup must never delete through a link that leaves the
// task-owned roots, never touch tracked or non-ignored files, and must delete
// the generated outputs it does own. Each test isolates one rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyCleanup, findCandidates, gitOwnership, isInside, planCleanup, validateBuildRoot } from './scoped-clean.mjs';

function write(file, text = 'x') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// A miniature checkout: git repo, ignored android/ and node_modules/, one
// native module with a Gradle build dir, plus a separate build root and an
// "outside" directory standing for another session's shared build root.
function fixture(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'g2136-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const checkout = path.join(base, 'checkout');
  const buildRoot = path.join(base, 'build-root');
  const outside = path.join(base, 'shared-build');
  write(path.join(checkout, '.gitignore'), 'node_modules/\n/android/\n');
  write(path.join(checkout, 'src', 'build', 'keep.ts'), 'tracked source in a dir named build');
  write(path.join(checkout, 'android', 'build.gradle'));
  write(path.join(checkout, 'android', 'app', 'build', 'out.apk'));
  write(path.join(checkout, 'node_modules', 'mod', 'android', 'build.gradle'));
  write(path.join(checkout, 'node_modules', 'mod', 'android', 'build', 'classes', 'A.class'));
  write(path.join(checkout, 'node_modules', 'mod', 'android', 'src', 'build', 'Real.kt'), 'source under src/ is never a candidate');
  write(path.join(checkout, 'node_modules', 'mod', 'android', '.gradle', 'shipped.bin'), 'package content: no settings.gradle here');
  write(path.join(checkout, 'node_modules', 'plugin', 'settings.gradle.kts'));
  write(path.join(checkout, 'node_modules', 'plugin', '.gradle', '8.14.3', 'fileHashes.bin'));
  write(path.join(buildRoot, 'gradle-home', 'marker'));
  write(path.join(outside, 'other-session', 'A.class'), 'not ours');
  execFileSync('git', ['init', '-q'], { cwd: checkout });
  execFileSync('git', ['add', '.gitignore', 'src'], { cwd: checkout });
  return { checkout, buildRoot, outside };
}

const link = (target, at) => fs.symlinkSync(target, at, 'junction');

test('isInside: whole path segments only, case-folded on Windows', () => {
  const root = path.resolve('/r/build-root');
  assert.equal(isInside(path.join(root, 'x'), root), true);
  assert.equal(isInside(root, root), false, 'the root itself is not inside');
  assert.equal(isInside(path.resolve('/r/build-root2/x'), root), false, 'a sibling with a shared prefix is outside');
  assert.equal(isInside(path.join(root, '..', 'other'), root), false, '.. escapes are resolved first');
});

test('validateBuildRoot: rejects relative, filesystem root, checkout ancestor and checkout child', () => {
  const checkout = path.resolve('/w/checkout');
  assert.match(validateBuildRoot('relative/dir', checkout), /absolute/);
  assert.match(validateBuildRoot(path.parse(checkout).root, checkout), /filesystem root/);
  assert.match(validateBuildRoot(path.resolve('/w'), checkout), /must not contain the checkout/);
  assert.match(validateBuildRoot(path.join(checkout, 'cache'), checkout), /outside the checkout/);
  assert.equal(validateBuildRoot(path.resolve('/w/checkout-build'), checkout), null);
});

test('findCandidates: generated dirs of Gradle projects only, never src/ or non-Gradle dirs', (t) => {
  const { checkout } = fixture(t);
  const found = findCandidates(checkout).map((p) => path.relative(checkout, p).replaceAll('\\', '/')).sort();
  assert.deepEqual(found, ['android/app/build', 'node_modules/mod/android/build', 'node_modules/plugin/.gradle']);
});

test('planCleanup + applyCleanup: removes owned generated outputs', (t) => {
  const { checkout, buildRoot } = fixture(t);
  const plan = planCleanup({ checkoutRoot: checkout, buildRoot, candidates: findCandidates(checkout), ownership: gitOwnership(checkout) });
  assert.deepEqual(plan.refused, []);
  const result = applyCleanup(plan);
  assert.deepEqual(result.failed, []);
  assert.equal(fs.existsSync(path.join(checkout, 'android', 'app', 'build')), false);
  assert.equal(fs.existsSync(path.join(checkout, 'node_modules', 'mod', 'android', 'build')), false);
  assert.equal(fs.existsSync(path.join(checkout, 'node_modules', 'plugin', '.gradle')), false);
  assert.equal(fs.existsSync(path.join(checkout, 'node_modules', 'mod', 'android', 'src', 'build', 'Real.kt')), true);
  assert.equal(fs.existsSync(path.join(checkout, 'node_modules', 'mod', 'android', '.gradle', 'shipped.bin')), true);
  assert.equal(fs.existsSync(path.join(checkout, 'src', 'build', 'keep.ts')), true);
});

test('planCleanup: a build dir that is a junction into a foreign build root is refused and its target survives', (t) => {
  const { checkout, buildRoot, outside } = fixture(t);
  const modBuild = path.join(checkout, 'node_modules', 'mod', 'android', 'build');
  fs.rmSync(modBuild, { recursive: true });
  link(path.join(outside, 'other-session'), modBuild);
  const plan = planCleanup({ checkoutRoot: checkout, buildRoot, candidates: findCandidates(checkout), ownership: gitOwnership(checkout) });
  const refused = plan.refused.find((item) => item.path === modBuild);
  assert.ok(refused, 'the foreign junction must be refused');
  assert.match(refused.reason, /resolves outside the task-owned roots/);
  assert.equal(plan.remove.some((item) => item.path === modBuild), false);
  applyCleanup(plan);
  assert.equal(fs.readFileSync(path.join(outside, 'other-session', 'A.class'), 'utf8'), 'not ours');
});

test('planCleanup: a nested junction leaving the roots refuses the whole directory', (t) => {
  const { checkout, buildRoot, outside } = fixture(t);
  const appBuild = path.join(checkout, 'android', 'app', 'build');
  link(path.join(outside, 'other-session'), path.join(appBuild, 'intermediates'));
  const plan = planCleanup({ checkoutRoot: checkout, buildRoot, candidates: findCandidates(checkout), ownership: gitOwnership(checkout) });
  assert.match(plan.refused.find((item) => item.path === appBuild)?.reason ?? '', /nested link resolves outside/);
  applyCleanup(plan);
  assert.equal(fs.existsSync(path.join(appBuild, 'out.apk')), true);
  assert.equal(fs.readFileSync(path.join(outside, 'other-session', 'A.class'), 'utf8'), 'not ours');
});

test('applyCleanup: a junction into the build root is removed as a link, its target is kept', (t) => {
  const { checkout, buildRoot } = fixture(t);
  const modBuild = path.join(checkout, 'node_modules', 'mod', 'android', 'build');
  fs.rmSync(modBuild, { recursive: true });
  const target = path.join(buildRoot, 'mod-build');
  write(path.join(target, 'A.class'), 'redirected output');
  link(target, modBuild);
  const plan = planCleanup({ checkoutRoot: checkout, buildRoot, candidates: findCandidates(checkout), ownership: gitOwnership(checkout) });
  assert.equal(plan.remove.find((item) => item.path === modBuild)?.kind, 'link');
  assert.deepEqual(applyCleanup(plan).failed, []);
  assert.equal(fs.existsSync(modBuild), false);
  assert.equal(fs.readFileSync(path.join(target, 'A.class'), 'utf8'), 'redirected output');
});

test('planCleanup: a dangling link is refused, not guessed', (t) => {
  const { checkout, buildRoot, outside } = fixture(t);
  const modBuild = path.join(checkout, 'node_modules', 'mod', 'android', 'build');
  fs.rmSync(modBuild, { recursive: true });
  const gone = path.join(outside, 'gone');
  fs.mkdirSync(gone);
  link(gone, modBuild);
  fs.rmdirSync(gone);
  const plan = planCleanup({ checkoutRoot: checkout, buildRoot, candidates: [modBuild], ownership: gitOwnership(checkout) });
  assert.match(plan.refused[0]?.reason ?? '', /cannot be resolved/);
});

test('planCleanup: a candidate that is not git-ignored or holds tracked files is refused', (t) => {
  const { checkout, buildRoot } = fixture(t);
  const trackedBuild = path.join(checkout, 'src', 'build');
  const notIgnored = planCleanup({ checkoutRoot: checkout, buildRoot, candidates: [trackedBuild], ownership: gitOwnership(checkout) });
  assert.match(notIgnored.refused[0]?.reason ?? '', /not git-ignored/);

  const forced = path.join(checkout, 'node_modules', 'mod', 'android', 'build');
  execFileSync('git', ['add', '-f', path.join(forced, 'classes', 'A.class')], { cwd: checkout });
  const tracked = planCleanup({ checkoutRoot: checkout, buildRoot, candidates: [forced], ownership: gitOwnership(checkout) });
  assert.match(tracked.refused[0]?.reason ?? '', /tracked files/);
});

test('planCleanup: an invalid build root fails before anything is planned', (t) => {
  const { checkout } = fixture(t);
  assert.throws(
    () => planCleanup({ checkoutRoot: checkout, buildRoot: path.dirname(checkout), candidates: [], ownership: gitOwnership(checkout) }),
    /must not contain the checkout/,
  );
});
