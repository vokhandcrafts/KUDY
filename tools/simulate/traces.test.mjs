// G05.06.b — the committed trace set suites. The acceptance numbering follows
// the issue's six criteria. Every check replays through the production stack
// (the same simulate() the CLI runs) and compares against the committed
// expectation of ITS trace — the CI behavior of 09 §11 pinned by tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIO_TRACES, TRACE_FILES, buildTrace, serializeTrace } from './generate.mjs';
import { parseTrace } from './trace-schema.mjs';
import { stableTraceName, verifyTrace, verifyTraceSet } from './verify.mjs';

const SIM_DIR = path.dirname(fileURLToPath(new URL('./traces.test.mjs', import.meta.url)));
const TRACES_DIR = path.join(SIM_DIR, 'traces');
const EXPECTATIONS_DIR = path.join(SIM_DIR, 'expectations');

const traceNames = () => Object.keys(TRACE_FILES).sort();

test('AC5: the committed trace set verifies against its own expectations', () => {
  const { failures } = verifyTraceSet({ tracesDir: TRACES_DIR, expectationsDir: EXPECTATIONS_DIR });
  assert.deepEqual(
    failures.map((failure) => failure.message),
    [],
    'every trace must match its expectation',
  );
});

test('AC1: every committed trace is byte-reproducible from its seeded generator', () => {
  for (const name of traceNames()) {
    const committed = fs.readFileSync(path.join(TRACES_DIR, name), 'utf8');
    assert.equal(serializeTrace(buildTrace(name)), committed, `${name} must regenerate byte for byte`);
  }
});

test('AC2: the six scenario fixtures of the G05.06 row are present and paired', () => {
  for (const name of SCENARIO_TRACES) {
    assert.ok(TRACE_FILES[name] !== undefined, `${name} is a named scenario and must be built`);
    assert.ok(fs.existsSync(path.join(TRACES_DIR, name)), `${name} must be committed under traces/`);
    assert.ok(
      fs.existsSync(path.join(EXPECTATIONS_DIR, name)),
      `${name} must carry its own expectation under expectations/`,
    );
  }
});

test('AC2: every expectation names what must fire and what must not', () => {
  for (const name of traceNames()) {
    const expectation = JSON.parse(fs.readFileSync(path.join(EXPECTATIONS_DIR, name), 'utf8'));
    assert.ok(Array.isArray(expectation.mustFire), `${name}: mustFire must be a list`);
    assert.ok(Array.isArray(expectation.mustNotFire), `${name}: mustNotFire must be a list`);
    assert.equal(expectation.trace, name, `${name}: the expectation names its own trace`);
  }
});

test('AC3: no auto-finish — Ended appears only in traces with an explicit End', () => {
  for (const name of traceNames()) {
    const doc = JSON.parse(fs.readFileSync(path.join(TRACES_DIR, name), 'utf8'));
    const expectation = JSON.parse(fs.readFileSync(path.join(EXPECTATIONS_DIR, name), 'utf8'));
    const hasEnd = doc.events.some(
      (event) => event.type === 'UserCommand' && event.command.action === 'End',
    );
    const finalPhase = expectation.report.session.finalPhase;
    if (hasEnd) {
      assert.equal(finalPhase, 'Ended', `${name}: the explicit End must reach Ended`);
    } else {
      assert.ok(
        finalPhase === 'Active' || finalPhase === 'Paused',
        `${name}: without an explicit End the session stays Active or Paused, got ${finalPhase}`,
      );
    }
  }
});

test('AC4: expectations are per trace — a foreign expectation fails, its own passes', () => {
  const midRoute = path.join(TRACES_DIR, 'mid-route-start.json');
  const own = path.join(EXPECTATIONS_DIR, 'mid-route-start.json');
  const foreign = path.join(EXPECTATIONS_DIR, 'clean-walk.json');
  assert.equal(verifyTrace(midRoute, own), null, 'the partial walk passes with its own expectation');
  const foreignFailure = verifyTrace(midRoute, foreign);
  assert.ok(foreignFailure !== null, 'clean-walk’s expectation must not cover the partial walk');
  assert.match(foreignFailure, /traces\/mid-route-start\.json/, 'the failure names the trace');
});

test('AC5: an edited expectation fails with the trace name and the first differing report line', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-exp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const expectation = JSON.parse(fs.readFileSync(path.join(EXPECTATIONS_DIR, 'clean-walk.json'), 'utf8'));
  const heard = expectation.report.session.heard;
  expectation.report.session.heard = heard.map((storyId) => (storyId === 'story-3' ? 'story-9' : storyId));
  const edited = path.join(dir, 'clean-walk.json');
  fs.writeFileSync(edited, JSON.stringify(expectation, null, 2) + '\n', 'utf8');
  const failure = verifyTrace(path.join(TRACES_DIR, 'clean-walk.json'), edited);
  assert.ok(failure !== null, 'the edited expectation must fail the verification');
  assert.match(failure, /traces\/clean-walk\.json/, 'the failure names the trace');
  assert.match(failure, /line \d+/, 'the failure names the first differing report line');
  assert.match(failure, /story-9/, 'the failure quotes the differing line');
});

test('AC5: the runner answers a corrupt trace with a named diagnostic, not a crash', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-corrupt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const corrupt = path.join(dir, 'clean-walk.json');
  const doc = JSON.parse(fs.readFileSync(path.join(TRACES_DIR, 'clean-walk.json'), 'utf8'));
  doc.events.push({ type: 'quake', at: 999999999 });
  fs.writeFileSync(corrupt, JSON.stringify(doc), 'utf8');
  const failure = verifyTrace(corrupt, path.join(EXPECTATIONS_DIR, 'clean-walk.json'));
  assert.ok(failure !== null, 'a corrupt trace is a failure');
  assert.match(failure, /traces\/clean-walk\.json/, 'the failure names the trace');
  assert.match(failure, /unknown-event/, 'the failure carries the parser diagnostic');
});

test('the AccessReady schema rules carry isolating negative tests', () => {
  const base = JSON.parse(fs.readFileSync(path.join(TRACES_DIR, 'locked-unlock.json'), 'utf8'));
  const cases = [
    {
      name: 'a foreign tier is a bad value',
      event: { type: 'AccessReady', at: 999000, tier: 'premium', stopIds: ['stop-3'] },
      code: 'bad-value',
      message: /tier accepts only/,
    },
    {
      name: 'an empty stopIds list opens nothing',
      event: { type: 'AccessReady', at: 999000, tier: 'extended', stopIds: [] },
      code: 'bad-value',
      message: /stopIds must be a non-empty array/,
    },
    {
      name: 'a stop outside the pinned package is rejected',
      event: { type: 'AccessReady', at: 999000, tier: 'extended', stopIds: ['stop-9'] },
      code: 'bad-value',
      message: /stop-9.*does not define/,
    },
  ];
  for (const { name, event, code, message } of cases) {
    const doc = structuredClone(base);
    doc.events.push(event);
    const parsed = parseTrace(doc);
    assert.equal(parsed.ok, false, `${name}: the document must be rejected`);
    const hit = parsed.diagnostics.find((d) => d.code === code && message.test(d.message));
    assert.ok(hit !== undefined, `${name}: expected a ${code} diagnostic matching ${message}`);
  }
});

test('orphan pairings fail in both directions — expectations are per trace', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-orphan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tracesDir = path.join(dir, 'traces');
  const expectationsDir = path.join(dir, 'expectations');
  fs.mkdirSync(tracesDir);
  fs.mkdirSync(expectationsDir);
  fs.copyFileSync(path.join(TRACES_DIR, 'clean-walk.json'), path.join(tracesDir, 'clean-walk.json'));
  fs.copyFileSync(
    path.join(EXPECTATIONS_DIR, 'mid-route-start.json'),
    path.join(expectationsDir, 'mid-route-start.json'),
  );
  const { failures } = verifyTraceSet({ tracesDir, expectationsDir });
  const messages = failures.map((failure) => failure.message).join('\n');
  assert.match(messages, /no expectation file for this trace/, 'a trace without an expectation fails');
  assert.match(
    messages,
    /has no trace file/,
    'an expectation without its trace fails — it cannot silently cover other traces',
  );
});

test('AC6: the field-trace slot exists and stays empty until a real walk is recorded', () => {
  const slot = path.join(TRACES_DIR, 'field');
  assert.ok(fs.statSync(slot).isDirectory(), 'traces/field/ is the recorded-walk slot');
  const contents = fs.readdirSync(slot);
  assert.deepEqual(
    contents.filter((name) => name.endsWith('.json')),
    [],
    'the slot is empty — recording a walk is a G11.02 not-run step',
  );
});

test('the stable report name is relative — expectations never pin an absolute path', () => {
  assert.equal(stableTraceName('/any/machine/path/traces/clean-walk.json'), 'traces/clean-walk.json');
});
