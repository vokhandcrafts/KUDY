// G21.36 (#592), review finding [key: unquoted-gradle-tmp-path]: the
// generated org.gradle.jvmargs must start a real Gradle build JVM when the
// build root contains a space (and non-ASCII letters). Runs a real Gradle
// distribution on an empty project, offline; skipped unless both are given:
//   KUDY_TEST_GRADLE_DIST  an unpacked Gradle distribution (the dir with bin/)
//   KUDY_JDK17             the JDK 17 the build uses
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { gradleUserProperties, taskPaths } from './build-config.mjs';

const isWindows = process.platform === 'win32';
const dist = process.env.KUDY_TEST_GRADLE_DIST;
const jdk = process.env.KUDY_JDK17;
const gradleBin = dist && path.join(dist, 'bin', isWindows ? 'gradle.bat' : 'gradle');
const skip = gradleBin && jdk && fs.existsSync(gradleBin) && fs.existsSync(path.join(jdk, 'release'))
  ? false
  : 'set KUDY_TEST_GRADLE_DIST (Gradle distribution) and KUDY_JDK17 (JDK 17) to run a real Gradle build';

// `help --offline --no-daemon` in an empty project: Gradle forks a single-use
// build JVM with org.gradle.jvmargs, and the build script writes the tmpdir
// that JVM got to a UTF-8 file (console output may use another code page).
function runGradle(base, buildRoot, props) {
  const { gradleHome, tmp } = taskPaths(buildRoot);
  fs.mkdirSync(gradleHome, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(gradleHome, 'gradle.properties'), props);
  const project = path.join(base, 'project');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'settings.gradle'), "rootProject.name = 'g2136-probe'\n");
  const probe = path.join(project, 'tmpdir.txt');
  fs.rmSync(probe, { force: true });
  fs.writeFileSync(path.join(project, 'build.gradle'),
    "new File(rootDir, 'tmpdir.txt').setText(System.getProperty('java.io.tmpdir'), 'UTF-8')\n");
  const env = { ...process.env, JAVA_HOME: jdk, GRADLE_USER_HOME: gradleHome, GRADLE_OPTS: '', JAVA_OPTS: '' };
  const args = ['help', '--offline', '--no-daemon', '--console=plain'];
  // gradle.bat runs through cmd.exe; its directory has no space and the paths
  // with spaces reach Gradle through the environment and the working directory.
  const result = isWindows
    ? spawnSync('cmd.exe', ['/d', '/c', 'gradle.bat', ...args],
      { cwd: project, env: { ...env, PATH: `${path.dirname(gradleBin)};${process.env.PATH}` }, encoding: 'utf8', timeout: 300_000 })
    : spawnSync(gradleBin, args, { cwd: project, env, encoding: 'utf8', timeout: 300_000 });
  const seen = fs.existsSync(probe) ? fs.readFileSync(probe, 'utf8') : null;
  return { status: result.status, output: `${result.stdout}${result.stderr}`, seen, tmp: tmp.replaceAll('\\', '/') };
}

// On Windows a just-finished Gradle run intermittently leaves the temp dir
// locked for a while (EPERM on the directory itself); rmSync does not retry
// EPERM there, so retry here for up to a minute.
async function removeWithRetry(dir) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= 60 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
      await delay(1000);
    }
  }
}

test('real Gradle: the generated jvmargs start the build JVM for a build root with a space', { skip, timeout: 900_000 }, (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'g2136-gradle-')));
  t.after(() => removeWithRetry(base));
  const options = (buildRoot) => ({ buildRoot, maxWorkers: 1, gradleHeap: '512m', abi: 'x86_64' });

  // The reviewer's reproduction: unquoted, the forked JVM takes "root/tmp" for its main class.
  const spaced = path.join(base, 'build root');
  const unquoted = runGradle(base, spaced, gradleUserProperties(options(spaced)).replaceAll('"', ''));
  assert.notEqual(unquoted.status, 0, unquoted.output);
  assert.match(unquoted.output, /Could not find or load main class/);

  for (const buildRoot of [spaced, path.join(base, 'зборка root')]) {
    const run = runGradle(base, buildRoot, gradleUserProperties(options(buildRoot)));
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /BUILD SUCCESSFUL/);
    assert.equal(run.seen, run.tmp, 'the build JVM got the task-owned tmpdir unchanged');
  }
});
