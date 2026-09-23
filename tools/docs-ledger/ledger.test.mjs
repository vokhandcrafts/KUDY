// Behavioral test for the docs fact ledger (G18.05, issue #200). It runs the
// real production entrypoints (tools/docs-ledger/ledger-baseline.mjs,
// ledger-check.mjs) against sandboxes with planted docs, plus the repo-level
// check (which is what makes npm test — and required-checks.yml through it —
// enforce the ledger) and wiring cases that fail when the scripts, the
// npm-test glob or the guard are reverted (implementation-rules §1).
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { KINDS, extractItems, itemKey, validateDropped } from './ledger.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_SCRIPT = path.join(REPO_ROOT, 'tools', 'docs-ledger', 'ledger-baseline.mjs');
const CHECK_SCRIPT = path.join(REPO_ROOT, 'tools', 'docs-ledger', 'ledger-check.mjs');

const FIXTURE_01 = [
  '# Fixture canon',
  '',
  '## Section one',
  '',
  'Owner of `story_id` and G01.03. Cites 09 §6.2 and §2.',
  'Links [peer](peer.md), the [site](https://example.com) and an [anchor](#section-one).',
  '',
].join('\n');

const FIXTURE_PEER = [
  '# Peer',
  '',
  'Backs up `run_seq` and G02.02.',
  '',
].join('\n');

const FIXTURE_HUMAN_ACTIONS = [
  '# Human actions',
  '',
  'Merge PR — unique marker G99.99 and `human-only-term`.',
  '',
].join('\n');

function makeSandbox({ files }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-ledger-'));
  fs.mkdirSync(path.join(dir, 'tools', 'docs-ledger'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'tools', 'docs-ledger', 'dropped.json'),
    JSON.stringify({ entries: [] }, null, 2) + '\n',
  );
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return dir;
}

const SANDBOX_FILES = {
  'docs/01_fixture.md': FIXTURE_01,
  'docs/peer.md': FIXTURE_PEER,
  'docs/human-actions.md': FIXTURE_HUMAN_ACTIONS,
};

function runScript(script, { cwd, args = [] }) {
  const run = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

function runBaseline(cwd, args = []) {
  return runScript(BASELINE_SCRIPT, { cwd, args });
}

function runCheck(cwd) {
  return runScript(CHECK_SCRIPT, { cwd });
}

function readBaselineItems(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'tools', 'docs-ledger', 'baseline.json'), 'utf8')).items;
}

test('ledger wiring is guarded (package.json scripts, npm-test glob, ci guard, baseline shape)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['ledger:baseline'], /tools\/docs-ledger\/ledger-baseline\.mjs/, 'ledger:baseline must invoke the baseline script');
  assert.match(pkg.scripts['ledger:check'], /tools\/docs-ledger\/ledger-check\.mjs/, 'ledger:check must invoke the check script');
  assert.match(pkg.scripts.test, /"?tools\/docs-ledger\/\*\.test\.mjs"?/, 'npm test glob must include tools/docs-ledger tests');

  const guard = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'ci', 'check-required-checks.mjs'), 'utf8');
  assert.match(guard, /ledger:check/, 'the required-checks guard must pin the ledger:check script');
  assert.match(guard, /tools\/docs-ledger/, 'the required-checks guard must pin the tools/docs-ledger npm-test glob');

  const baseline = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'docs-ledger', 'baseline.json'), 'utf8'));
  assert.match(baseline.generated, /^\d{4}-\d{2}-\d{2}$/, 'baseline must carry a date');
  assert.ok(Array.isArray(baseline.items) && baseline.items.length > 0, 'baseline must have a non-empty items array');
  for (const item of baseline.items) {
    assert.ok(KINDS.includes(item.kind), `baseline item has unknown kind: ${JSON.stringify(item)}`);
    assert.ok(typeof item.value === 'string' && item.value.length > 0, `baseline item lacks a value: ${JSON.stringify(item)}`);
    if (item.kind === 'heading') assert.ok(typeof item.file === 'string', `heading item lacks a file: ${JSON.stringify(item)}`);
  }

  const dropped = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'docs-ledger', 'dropped.json'), 'utf8'));
  validateDropped(dropped);
});

test('repo-level ledger check passes at the current HEAD (npm test enforces the ledger)', () => {
  const { status, output } = runCheck(REPO_ROOT);
  assert.equal(status, 0, `expected exit 0, got ${status}:\n${output}`);
  assert.match(output, /ledger-check: OK/);
});

test('extraction is deterministic — two runs produce the same item set', () => {
  const first = [...extractItems().values()].sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
  const second = [...extractItems().values()].sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
  assert.deepEqual(second, first);
  assert.ok(first.length > 0, 'the real docs tree must yield items');
});

test('sandbox roundtrip: baseline extracts every fact class; check passes; human-actions is excluded', () => {
  const dir = makeSandbox({ files: SANDBOX_FILES });
  const base = runBaseline(dir);
  assert.equal(base.status, 0, `baseline failed:\n${base.output}`);

  const items = readBaselineItems(dir);
  const has = (kind, value) => items.some((i) => i.kind === kind && i.value === value);
  assert.ok(has('id', 'G01.03'), `id item missing:\n${JSON.stringify(items)}`);
  assert.ok(has('id', 'G02.02'), 'id from the non-normative file must be tracked too');
  assert.ok(has('code', 'story_id'), 'backticked identifier missing');
  assert.ok(has('section', '09 §6.2'), '§ citation with doc prefix missing');
  assert.ok(has('section', '§2'), 'bare § citation missing');
  assert.ok(has('link', 'docs/peer.md'), 'relative link target missing');
  assert.ok(has('heading', 'Section one'), 'normative heading missing');
  assert.ok(!has('link', 'https://example.com'), 'external URLs are not link items');
  assert.ok(!items.some((i) => i.value.includes('example.com')), 'external URLs must not leak into the ledger');
  assert.ok(!has('id', 'G99.99') && !has('code', 'human-only-term'), 'docs/human-actions.md must stay outside the scan');

  const check = runCheck(dir);
  assert.equal(check.status, 0, `check failed on an untouched sandbox:\n${check.output}`);
  assert.match(check.output, /ledger-check: OK/);
});

test('removing a baseline item fails the check and names it', () => {
  const dir = makeSandbox({ files: SANDBOX_FILES });
  assert.equal(runBaseline(dir).status, 0);
  fs.writeFileSync(
    path.join(dir, 'docs', '01_fixture.md'),
    FIXTURE_01.replace('Owner of `story_id` and G01.03.', 'Owner of `story_id`.'),
  );
  const { status, output } = runCheck(dir);
  assert.notEqual(status, 0, `expected nonzero exit:\n${output}`);
  assert.match(output, /id: G01\.03/, 'the lost item must be named');
});

test('moving a baseline item to another file passes the check', () => {
  const dir = makeSandbox({ files: SANDBOX_FILES });
  assert.equal(runBaseline(dir).status, 0);
  fs.writeFileSync(
    path.join(dir, 'docs', '01_fixture.md'),
    FIXTURE_01.replace('Owner of `story_id` and G01.03.', 'Owner of `story_id`.'),
  );
  fs.writeFileSync(
    path.join(dir, 'docs', 'peer.md'),
    `${FIXTURE_PEER}G01.03 lives here now.\n`,
  );
  const { status, output } = runCheck(dir);
  assert.equal(status, 0, `moved item must pass:\n${output}`);
});

test('a lost item covered by a dropped entry passes; the entry needs reason and sha/replacement', () => {
  const dir = makeSandbox({ files: SANDBOX_FILES });
  assert.equal(runBaseline(dir).status, 0);
  fs.writeFileSync(
    path.join(dir, 'docs', '01_fixture.md'),
    FIXTURE_01.replace('Owner of `story_id` and G01.03.', 'Owner of `story_id`.'),
  );
  const droppedFile = path.join(dir, 'tools', 'docs-ledger', 'dropped.json');
  fs.writeFileSync(droppedFile, JSON.stringify({ entries: [
    { kind: 'id', value: 'G01.03', reason: 'task history moved to git', sha: 'abc1234' },
  ] }, null, 2) + '\n');
  const covered = runCheck(dir);
  assert.equal(covered.status, 0, `dropped-covered loss must pass:\n${covered.output}`);

  for (const broken of [
    { kind: 'id', value: 'G01.03', reason: 'no pointer at all' },
    { kind: 'id', value: 'G01.03', sha: 'abc1234' },
  ]) {
    fs.writeFileSync(droppedFile, JSON.stringify({ entries: [broken] }, null, 2) + '\n');
    const { status, output } = runCheck(dir);
    assert.notEqual(status, 0, `invalid dropped entry must fail:\n${output}`);
    assert.match(output, /G01\.03/, 'the diagnostic must name the dropped value');
    assert.doesNotMatch(output, /at\s+\S+\s+\(.*:\d+:\d+\)/, 'no raw stack trace — a diagnostic is expected');
  }
});

test('corrupt baseline yields a diagnostic, not a crash', () => {
  const dir = makeSandbox({ files: SANDBOX_FILES });
  assert.equal(runBaseline(dir).status, 0);
  fs.writeFileSync(path.join(dir, 'tools', 'docs-ledger', 'baseline.json'), '{ not json');
  const { status, output } = runCheck(dir);
  assert.notEqual(status, 0, `expected nonzero exit:\n${output}`);
  assert.match(output, /baseline\.json/, 'the diagnostic must name the baseline file');
  assert.doesNotMatch(output, /at\s+\S+\s+\(.*:\d+:\d+\)/, 'no raw stack trace — a diagnostic is expected');
});

test('CRLF checkouts extract the same items as LF ones', () => {
  const lf = makeSandbox({ files: SANDBOX_FILES });
  assert.equal(runBaseline(lf).status, 0);
  const crlfFiles = Object.fromEntries(
    Object.entries(SANDBOX_FILES).map(([name, body]) => [name, body.replace(/\n/g, '\r\n')]),
  );
  const crlf = makeSandbox({ files: crlfFiles });
  assert.equal(runBaseline(crlf).status, 0);
  assert.deepEqual(readBaselineItems(crlf), readBaselineItems(lf));
});

test('a lost normative heading is named with its file and stays lost when it moves files', () => {
  const dir = makeSandbox({ files: SANDBOX_FILES });
  assert.equal(runBaseline(dir).status, 0);
  fs.writeFileSync(
    path.join(dir, 'docs', '01_fixture.md'),
    FIXTURE_01.replace('## Section one\n\n', ''),
  );
  const lost = runCheck(dir);
  assert.notEqual(lost.status, 0, `expected nonzero exit:\n${lost.output}`);
  assert.match(lost.output, /heading: Section one \(file: docs\/01_fixture\.md\)/, 'the lost heading must be named with its file');

  // Heading identity is per-file: the owner text is not rewritten, so a
  // heading that migrates to another file is a change to review, not a move.
  fs.writeFileSync(
    path.join(dir, 'docs', 'peer.md'),
    `${FIXTURE_PEER}## Section one\n`,
  );
  const stillLost = runCheck(dir);
  assert.notEqual(stillLost.status, 0, `heading must stay lost after moving files:\n${stillLost.output}`);
});

test('ledger:baseline refuses to overwrite an existing baseline without --force', () => {
  const dir = makeSandbox({ files: SANDBOX_FILES });
  assert.equal(runBaseline(dir).status, 0);
  const refused = runBaseline(dir);
  assert.notEqual(refused.status, 0, `overwrite must be refused:\n${refused.output}`);
  assert.match(refused.output, /--force/, 'the refusal must name the --force escape hatch');
  const forced = runBaseline(dir, ['--force']);
  assert.equal(forced.status, 0, `--force re-baseline must pass:\n${forced.output}`);
});

// G18.05 criterion b: the ownership map is the single home of the "fact class
// → owner file" table. Removing the section or letting an owner target rot
// must fail here (implementation-rules §1), the way size-guideline-guard pins
// its own single home.
test('the ownership map in docs/readme.md exists and every owner target resolves', () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'readme.md'), 'utf8');
  const marker = '## Уласнікі норматыўных фактаў';
  const at = readme.indexOf(marker);
  assert.notEqual(at, -1, `the ownership map section is missing from docs/readme.md: "${marker}"`);
  const section = readme.slice(at);

  const targets = [...section.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  assert.ok(targets.length >= 20, `the ownership map has too few owner links: ${targets.length}`);
  for (const target of targets) {
    if (/^(https?:|mailto:|\/\/)/i.test(target)) continue;
    const resolved = path.resolve(REPO_ROOT, 'docs', decodeURIComponent(target.split('#')[0]));
    assert.ok(fs.existsSync(resolved), `ownership map owner target does not exist: ${target}`);
  }
});
