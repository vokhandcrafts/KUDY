// G21.36 (#592): the bounded build settings are the fix for the retest's
// orphaned compile daemon and unbounded workers; reverting any of them turns a
// test here red. Option validation answers with reasons, never coercion.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildEnv, classifyProcesses, gradleArgs, gradleUserProperties, resolveOptions } from './build-config.mjs';

const checkoutRoot = path.resolve('/w/KUDY');
const buildRoot = path.resolve('/w/KUDY-build');
const sdk = path.resolve('/sdk');
const jdk = path.resolve('/jdk17');
const valid = { 'build-root': buildRoot, sdk, jdk };

const optionsFor = (raw) => resolveOptions(raw, { checkoutRoot, env: {} });

test('resolveOptions: defaults are bounded', () => {
  const { options } = optionsFor(valid);
  assert.equal(options.maxWorkers, 2);
  assert.equal(options.gradleHeap, '3g');
  assert.equal(options.abi, 'x86_64');
  assert.equal(options.timeoutMinutes, 90);
});

test('resolveOptions: each invalid input is reported with a reason', () => {
  const cases = [
    [{ ...valid, 'build-root': 'relative' }, /absolute path/],
    [{ ...valid, 'build-root': path.resolve('/w') }, /must not contain the checkout/],
    [{ ...valid, sdk: undefined }, /--sdk/],
    [{ ...valid, jdk: undefined }, /JDK 17/],
    [{ ...valid, 'max-workers': '0' }, /--max-workers/],
    [{ ...valid, 'max-workers': '2.5' }, /--max-workers/],
    [{ ...valid, 'gradle-heap': '3' }, /--gradle-heap/],
    [{ ...valid, abi: 'x86_64,mips' }, /--abi/],
    [{ ...valid, 'timeout-minutes': 'soon' }, /--timeout-minutes/],
    [{ ...valid, 'ro-dep-cache': 'caches' }, /--ro-dep-cache/],
    [{ ...valid, 'build-root': path.resolve('/w/a&b') }, /cmd metacharacters/],
  ];
  for (const [raw, pattern] of cases) {
    const result = optionsFor(raw);
    assert.ok(result.errors, `expected errors for ${JSON.stringify(raw)}`);
    assert.match(result.errors.join('\n'), pattern);
  }
});

test('resolveOptions: the system JAVA_HOME is never used implicitly', () => {
  const result = resolveOptions({ 'build-root': buildRoot, sdk }, { checkoutRoot, env: { JAVA_HOME: path.resolve('/jdk25') } });
  assert.match(result.errors.join('\n'), /JDK 17/);
});

test('gradleUserProperties: no daemon, bounded workers and heap, in-process Kotlin, task-owned tmp, ABI', () => {
  const { options } = optionsFor({ ...valid, 'max-workers': '3', 'gradle-heap': '2g', abi: 'x86_64,arm64-v8a' });
  const props = gradleUserProperties(options);
  assert.match(props, /^org\.gradle\.daemon=false$/m);
  assert.match(props, /^org\.gradle\.workers\.max=3$/m);
  assert.match(props, /^org\.gradle\.jvmargs=-Xmx2g .*"-Djava\.io\.tmpdir=\S*KUDY-build\/tmp"$/m);
  assert.match(props, /^kotlin\.compiler\.execution\.strategy=in-process$/m);
  assert.match(props, /^reactNativeArchitectures=x86_64,arm64-v8a$/m);
});

// What Gradle does with org.gradle.jvmargs: java.util.Properties decodes
// \uXXXX escapes, then the value is split at whitespace outside quotes and
// the quotes are dropped (Gradle's ArgumentsSplitter).
function jvmArgsAsGradleReadsThem(props) {
  const raw = props.match(/^org\.gradle\.jvmargs=(.*)$/m)[1]
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return [...raw.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

// [key: unquoted-gradle-tmp-path]: a build root with a space (or non-ASCII
// letters) is accepted, so it must reach the build JVM as one argument.
test('gradleUserProperties: a build root with a space or non-ASCII letters stays one quoted tmpdir argument', () => {
  for (const name of ['KUDY build root', 'KUDY зборка']) {
    const root = path.resolve('/w', name);
    const { options, errors } = optionsFor({ ...valid, 'build-root': root });
    assert.equal(errors, undefined, `build root ${name} is accepted`);
    const props = gradleUserProperties(options);
    const tmp = `${root.replaceAll('\\', '/')}/tmp`;
    assert.deepEqual(jvmArgsAsGradleReadsThem(props),
      ['-Xmx3g', '-XX:MaxMetaspaceSize=1g', '-Dfile.encoding=UTF-8', `-Djava.io.tmpdir=${tmp}`]);
    assert.match(props, /^org\.gradle\.jvmargs=[\x20-\x7e]*$/m, 'the jvmargs line is plain ASCII');
    // Every path-bearing -D argument is quoted as a whole.
    for (const unquoted of props.match(/^org\.gradle\.jvmargs=(.*)$/m)[1].replace(/"[^"]*"/g, '').split(/\s+/)) {
      assert.doesNotMatch(unquoted, /^-D[^=]+=.*[\\/]/, `unquoted path argument ${unquoted}`);
    }
  }
});

test('gradleArgs: no daemon and the task-owned Gradle home on the command line', () => {
  const { options } = optionsFor(valid);
  const args = gradleArgs(options);
  assert.deepEqual(args.slice(0, 3), ['assembleDebug', '--no-daemon', '--console=plain']);
  assert.equal(args[args.indexOf('--gradle-user-home') + 1], path.join(buildRoot, 'gradle-home'));
  assert.equal(args.includes('--rerun-tasks'), false);
  assert.equal(gradleArgs(optionsFor({ ...valid, 'rerun-tasks': true }).options).includes('--rerun-tasks'), true);
});

test('buildEnv: JDK/SDK/Gradle home/temp are per-process and point at the given paths', () => {
  const { options } = optionsFor(valid);
  const env = buildEnv(options, { PATH: 'base', JAVA_HOME: path.resolve('/jdk25'), GRADLE_RO_DEP_CACHE: '/stale' });
  assert.equal(env.JAVA_HOME, jdk);
  assert.equal(env.ANDROID_HOME, sdk);
  assert.equal(env.GRADLE_USER_HOME, path.join(buildRoot, 'gradle-home'));
  assert.equal(env.TMP, path.join(buildRoot, 'tmp'));
  assert.equal(env.GRADLE_RO_DEP_CACHE, undefined, 'an inherited read-only cache is not used unless passed explicitly');
  assert.ok(env.PATH.startsWith(path.join(jdk, 'bin')));
});

test('classifyProcesses: only processes naming the build root are owned; other builds in the checkout are foreign', () => {
  const procs = [
    { pid: 1, name: 'java.exe', commandLine: `java -cp ${buildRoot}/gradle-home/wrapper/dists/x.jar GradleDaemon` },
    { pid: 2, name: 'java.exe', commandLine: `java -cp ${checkoutRoot}/android/gradle/wrapper/gradle-wrapper.jar GradleWrapperMain` },
    { pid: 3, name: 'java.exe', commandLine: `java -cp ${buildRoot}2/gradle-home/x.jar GradleDaemon` },
    { pid: 4, name: 'node.exe', commandLine: `node ${checkoutRoot}/node_modules/expo/bin/cli start` },
    { pid: 5, name: 'java.exe', commandLine: `java -cp ${buildRoot}/gradle-home/x.jar` },
    { pid: 6, name: 'java.exe', commandLine: null },
    { pid: 7, name: 'powershell.exe', commandLine: `powershell -File ${buildRoot}/experiments/run.ps1` },
    { pid: 8, name: 'cmd.exe', commandLine: `cmd /c gradlew.bat --gradle-user-home ${buildRoot}/gradle-home` },
  ];
  const { owned, foreign } = classifyProcesses(procs, { buildRoot, checkoutRoot, selfPid: 5, caseInsensitive: false });
  assert.deepEqual(owned.map((p) => p.pid), [1], 'a shell or script naming the build root (the caller) is never owned');
  assert.deepEqual(foreign.map((p) => p.pid), [2]);
});

test('classifyProcesses: Windows paths match case-insensitively and with either separator', () => {
  const root = 'D:\\KUDY-592-build';
  const procs = [
    { pid: 1, name: 'java.exe', commandLine: 'java -Djava.io.tmpdir=d:/kudy-592-build/tmp GradleDaemon' },
    { pid: 2, name: 'java.exe', commandLine: 'java -cp "D:\\KUDY-592-build\\gradle-home\\x.jar"' },
  ];
  const { owned } = classifyProcesses(procs, { buildRoot: root, checkoutRoot: 'D:\\KUDY-592', selfPid: 0, caseInsensitive: true });
  assert.deepEqual(owned.map((p) => p.pid), [1, 2]);
});
