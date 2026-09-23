// Behavioral test for the arch gate (G18.01, issue #164). It runs the real
// production entrypoint (tools/arch/arch-check.mjs) against sandboxes with a
// copy of the repo config and planted violations, plus a wiring case that
// fails when the package.json scripts, the npm-test glob, the config or the
// baseline are reverted (implementation-rules §1: configuration is code).
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_CONFIG = path.join(REPO_ROOT, '.dependency-cruiser.cjs');
const REPO_BASELINE = path.join(REPO_ROOT, 'tools', 'arch', 'baseline.json');
const CHECK_SCRIPT = path.join(REPO_ROOT, 'tools', 'arch', 'arch-check.mjs');

function runChecker({ cwd, baselineFile }) {
  const dirs = ['core', 'services', 'contracts', 'tools', 'web', 'app'].filter((d) =>
    fs.existsSync(path.join(cwd, d)),
  );
  const run = spawnSync(
    process.execPath,
    [
      CHECK_SCRIPT,
      '--config', path.join(cwd, '.dependency-cruiser.cjs'),
      '--baseline', baselineFile,
      ...dirs,
    ],
    { cwd, encoding: 'utf8' },
  );
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

// Builds a sandbox with a copy of the repo config, an (optionally custom)
// baseline, and the planted zone files. The config projects zones by path
// prefix, so the sandbox reproduces them by writing the same prefixes.
function makeSandbox({ files, baselineContent }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-arch-'));
  fs.copyFileSync(REPO_CONFIG, path.join(dir, '.dependency-cruiser.cjs'));
  fs.writeFileSync(
    path.join(dir, 'baseline.json'),
    baselineContent ?? JSON.stringify({ generated: '2026-09-22', entries: [] }),
  );
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return dir;
}

test('arch-check wiring is guarded (package.json scripts, npm-test glob, config, baseline)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['arch:check'], /tools\/arch\/arch-check\.mjs/, 'arch:check must invoke tools/arch/arch-check.mjs');
  assert.match(pkg.scripts['arch:check'], /\.dependency-cruiser\.cjs/, 'arch:check must pass the repo config');
  assert.match(pkg.scripts['arch:check'], /tools\/arch\/baseline\.json/, 'arch:check must pass the baseline');
  assert.match(pkg.scripts['arch:check'], /core services contracts tools web app/, 'arch:check must scan the zone list (app included since G06.09.a)');
  assert.match(pkg.scripts['arch:baseline'], /tools\/arch\/arch-baseline\.mjs/, 'arch:baseline must invoke tools/arch/arch-baseline.mjs');
  assert.match(pkg.scripts.test, /"?tools\/arch\/\*\.test\.mjs"?/, 'npm test glob must include tools/arch tests');

  assert.ok(fs.existsSync(REPO_CONFIG), '.dependency-cruiser.cjs must exist at the repo root');
  const baseline = JSON.parse(fs.readFileSync(REPO_BASELINE, 'utf8'));
  assert.match(baseline.generated, /^\d{4}-\d{2}-\d{2}$/, 'baseline must carry a date');
  assert.ok(Array.isArray(baseline.entries), 'baseline must have an entries array');
  for (const entry of baseline.entries) {
    assert.ok(entry.rule && entry.from && entry.to && entry.since, `baseline entry lacks fields: ${JSON.stringify(entry)}`);
  }
});

test('clean sandbox passes the checker', () => {
  const dir = makeSandbox({
    files: {
      'core/pure.mjs': "import { next } from './other.mjs';\nexport const step = next;\n",
      'core/other.mjs': "export const next = (x) => x;\n",
      'services/adapter.mjs': "import { step } from '../core/pure.mjs';\nimport fs from 'node:fs';\nexport const use = () => Boolean(fs) && Boolean(step);\n",
    },
  });
  const { status, output } = runChecker({ cwd: dir, baselineFile: path.join(dir, 'baseline.json') });
  assert.equal(status, 0, `expected exit 0, got ${status}:\n${output}`);
  assert.match(output, /arch:check: OK/);
});

test('planted two-file cycle fails and names the no-cycles rule', () => {
  const dir = makeSandbox({
    files: {
      'core/a.mjs': "import { b } from './b.mjs';\nexport const a = () => b();\n",
      'core/b.mjs': "import { a } from './a.mjs';\nexport const b = () => a();\n",
    },
  });
  const { status, output } = runChecker({ cwd: dir, baselineFile: path.join(dir, 'baseline.json') });
  assert.notEqual(status, 0, `expected nonzero exit:\n${output}`);
  assert.match(output, /no-cycles/, 'the violated rule must be named');
  assert.match(output, /core\/a\.mjs/, 'the violation path must be named');
});

test('core/ production file importing node:fs fails and names core-zone-closed', () => {
  const dir = makeSandbox({
    files: {
      'core/bad.mjs': "import fs from 'node:fs';\nexport const read = fs.readFileSync;\n",
    },
  });
  const { status, output } = runChecker({ cwd: dir, baselineFile: path.join(dir, 'baseline.json') });
  assert.notEqual(status, 0, `expected nonzero exit:\n${output}`);
  assert.match(output, /core-zone-closed/, 'the violated rule must be named');
  assert.match(output, /core\/bad\.mjs/, 'the violation path must be named');
});

test('layer-direction violation (services -> web) fails and names services-zone-closed', () => {
  const dir = makeSandbox({
    files: {
      'services/adapter.mjs': "import { ui } from '../web/ui.mjs';\nexport const render = ui;\n",
      'web/ui.mjs': "export const ui = () => 'ui';\n",
    },
  });
  const { status, output } = runChecker({ cwd: dir, baselineFile: path.join(dir, 'baseline.json') });
  assert.notEqual(status, 0, `expected nonzero exit:\n${output}`);
  assert.match(output, /services-zone-closed/, 'the violated rule must be named');
  assert.match(output, /services\/adapter\.mjs/, 'the violation path must be named');
});

test('app/ importing services/ directly fails and names app-no-services (19 §4.2 edge rule)', () => {
  const dir = makeSandbox({
    files: {
      'app/bad.mjs': "import { device } from '../services/device.mjs';\nexport const use = device;\n",
      'services/device.mjs': "export const device = 'device';\n",
    },
  });
  const { status, output } = runChecker({ cwd: dir, baselineFile: path.join(dir, 'baseline.json') });
  assert.notEqual(status, 0, `expected nonzero exit:\n${output}`);
  assert.match(output, /app-no-services/, 'the violated rule must be named');
  assert.match(output, /app\/bad\.mjs/, 'the violation path must be named');
});

test('corrupt baseline yields a diagnostic, not a crash', () => {
  const dir = makeSandbox({
    files: { 'core/pure.mjs': "export const step = (x) => x;\n" },
    baselineContent: '{ not json',
  });
  const { status, output } = runChecker({ cwd: dir, baselineFile: path.join(dir, 'baseline.json') });
  assert.notEqual(status, 0, `expected nonzero exit:\n${output}`);
  assert.match(output, /baseline/, 'the diagnostic must name the baseline file');
  assert.doesNotMatch(output, /at\s+\S+\s+\(.*:\d+:\d+\)/, 'no raw stack trace — a diagnostic is expected');
});

test('a baselined violation passes; the same violation without the baseline fails', () => {
  const files = {
    'core/a.mjs': "import { b } from './b.mjs';\nexport const a = () => b();\n",
    'core/b.mjs': "import { a } from './a.mjs';\nexport const b = () => a();\n",
  };
  const without = makeSandbox({ files });
  const first = runChecker({ cwd: without, baselineFile: path.join(without, 'baseline.json') });
  assert.notEqual(first.status, 0, 'without a baseline entry the violation must fail');

  // Feed the reported violations back as baseline entries (the same format the
  // checker prints) and confirm the gate goes green without code changes.
  const entries = [...first.output.matchAll(/^- ([a-z-]+): (.+) -> (.+)$/gm)]
    .map((m) => ({ rule: m[1], from: m[2], to: m[3], since: '2026-09-22' }));
  assert.ok(entries.length > 0, `checker output did not parse into entries:\n${first.output}`);

  const withBaseline = makeSandbox({
    files,
    baselineContent: JSON.stringify({ generated: '2026-09-22', entries }),
  });
  const second = runChecker({ cwd: withBaseline, baselineFile: path.join(withBaseline, 'baseline.json') });
  assert.equal(second.status, 0, `baselined violation must pass:\n${second.output}`);
  assert.match(second.output, /pass via the baseline/);
});
