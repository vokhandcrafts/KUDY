// G20.14 — the standing reverted-fix checks for the Expo adapter suites
// (spec §V1, issue #485): the G20.02/G20.07/G20.08 behavioral suites import
// the production adapters and replace only the expo modules, so reverting a
// physical launch or the pending-start cleanup must turn the standard check
// red. The G20.02/G20.07/G20.08 sessions proved that by hand; this guard
// proves it on every npm test run:
//
//   1. a pristine copy of the adapter tree runs its suite green (the control
//      — the red below comes from the revert, not from the copying);
//   2. a copy with the physical play call removed fails physical_play_called;
//   3. a copy with the pending-start cleanup removed fails
//      delayed_foreground_after_stop;
//   4. the suites themselves stay committed and owned by the node runner
//      (removing the file or its glob turns this guard red), and the runner
//      command still carries the module-mock flags the suites document.
//
// The suite under test imports the copied adapter source — a fake service
// port could not react to a reverted source line, so the red run is also the
// standing proof that the production logic is exercised (criterion 1).
// Physical sound/location on a device stays a separate acceptance proof; no
// check here claims it (criterion 4).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { discoverRepoTests } from './test-discovery.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ADAPTER_SUITES = [
  {
    label: 'audio',
    serviceDir: 'services/audio',
    suite: 'services/audio/expo/expo-audio-port.test.ts',
    revertedTestName: 'physical_play_called',
    revertLine: '        created.play();\n',
  },
  {
    label: 'location',
    serviceDir: 'services/location',
    suite: 'services/location/expo/expo-location-port.test.ts',
    revertedTestName: 'delayed_foreground_after_stop',
    // The G20.08 pending-start cleanup: a watch that resolves after its stop
    // removes itself. The plain `watch.remove()` substring also appears in
    // the removeWatch arrow, so the target carries its comment anchor.
    revertLine: '        watch.remove(); // stopped before the watch resolved — no orphan stream\n',
  },
];

// The single source of the child invocation is the npm test script itself
// (implementation-rules 2): the same node, the same flags the suites
// document. A missing flag fails here by name — the suites cannot run
// without --experimental-test-module-mocks.
function runnerFlags() {
  const script = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts?.test ?? '';
  const nodePart = script.split('&&')[0].trim();
  assert.match(nodePart, /^node\s+--test\b/, 'npm test must run node --test first');
  // Values ride their flag (`--test-reporter=spec`) — a split pair turns the
  // suite path into the reporter value and the child silently runs nothing.
  const flags = nodePart.match(/--[\w-]+(?:=[\w./-]+)?/g) ?? [];
  for (const required of ['--test', '--experimental-strip-types', '--experimental-test-module-mocks']) {
    assert.ok(
      flags.includes(required),
      `the npm test node invocation must carry ${required} — the adapter suites run on it`,
    );
  }
  return flags;
}

// The copied suite imports its service tree, whose modules reach core/ and
// contracts/ — the copy carries every in-repo zone the closure can touch
// (bare expo specifiers resolve against the real node_modules above the
// scratch root; the type-only imports never load them).
const COPY_ZONES = ['services', 'core', 'contracts'];

function prepareCopy(entry, { revert = false } = {}) {
  const scratchRoot = path.join(repoRoot, '.scratch');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, `g20-guard-${entry.label}-`));
  for (const zone of COPY_ZONES) {
    fs.cpSync(path.join(repoRoot, zone), path.join(scratch, zone), { recursive: true });
  }
  if (revert) {
    const adapterFile = revertAdapterPath(entry, scratch);
    const source = fs.readFileSync(adapterFile, 'utf8');
    const occurrences = source.split(entry.revertLine).length - 1;
    assert.equal(
      occurrences,
      1,
      `revert target in ${path.relative(repoRoot, adapterFile)} must appear exactly once, found ${occurrences} — update the guard target`,
    );
    fs.writeFileSync(adapterFile, source.replace(entry.revertLine, ''), 'utf8');
  }
  return path.join(scratch, entry.suite);
}

function revertAdapterPath(entry, scratch) {
  const suiteRelative = entry.suite;
  const adapterRelative = suiteRelative.replace('.test.ts', '.ts');
  return path.join(scratch, adapterRelative);
}

function runStandardCheck(suitePath, flags) {
  // The guard itself runs under node --test, whose env carries
  // NODE_TEST_CONTEXT: a child inheriting it believes it is already inside a
  // test run and silently skips the file with exit 0 — a false green. The
  // child must look like a top-level `node --test` invocation.
  const { NODE_TEST_CONTEXT, ...childEnv } = process.env;
  const result = spawnSync(process.execPath, [...flags, suitePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
    env: childEnv,
  });
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

test('guard: the adapter suites are committed and owned by the npm test node runner', () => {
  const { nodeFiles, jestFiles, trackedTestFiles, diagnostics } = discoverRepoTests();
  assert.deepEqual(diagnostics, [], 'discovery must run clean');
  for (const entry of ADAPTER_SUITES) {
    assert.ok(trackedTestFiles.includes(path.normalize(entry.suite)), `${entry.suite} must be committed`);
    assert.ok(nodeFiles.has(path.normalize(entry.suite)), `${entry.suite} must be claimed by the node runner glob`);
    assert.ok(!jestFiles.has(path.normalize(entry.suite)), `${entry.suite} must not be double-claimed by jest`);
  }
});

for (const entry of ADAPTER_SUITES) {
  test(`reverted-fix check [${entry.label}]: the pristine copy passes the standard check`, () => {
    const flags = runnerFlags();
    const suitePath = prepareCopy(entry);
    const run = runStandardCheck(suitePath, flags);
    assert.equal(
      run.status,
      0,
      `the control copy must pass — a red control means the copy mechanics broke, not the adapter:\n${run.output}`,
    );
    assert.match(run.output, /ℹ pass \d+/, 'the control must actually run the suite (a skipped run is not a green one)');
    assert.doesNotMatch(run.output, /skipping running files/, 'the child must not inherit a test-run context');
  });

  test(`reverted-fix check [${entry.label}]: removing the protected line turns the standard check red`, () => {
    const flags = runnerFlags();
    const suitePath = prepareCopy(entry, { revert: true });
    const run = runStandardCheck(suitePath, flags);
    assert.notEqual(run.status, 0, `the reverted copy must fail the standard check (implementation-rules 1):\n${run.output}`);
    assert.ok(run.output.includes(entry.revertedTestName), `the red run must name ${entry.revertedTestName}:\n${run.output}`);
  });
}
