// G01.05.a — acceptance suite for the event and error table
// (contracts/events/event-table.v1.json, ADR docs/architecture/decisions/G01.05-event-table.md).
// Issue #186 criteria:
// 1. Every event named in 09 §10, 09 §20 (guide_nearby_*) and 21 §7 (discovery_offer_*)
//    has exactly one row with a source anchor; the table introduces no event names.
// 2. Common fields are exactly event_id, type, at, schema_version; context fields
//    (session_id/route_id/version/locale/tier) appear only where the row allows.
// 3. stop_reached is defined only for pipeline-confirmed presence; story_play_started
//    carries trigger gps|manual; the fixture pair shows a manual play produces no stop_reached.
// 4. Join rules through attempt_id/offer_id/download_id to a later session_started;
//    the chain fixture preview → purchase → download → Start has no session before Start.
// 5. Closed reason lists; a fixture with an unknown reason is rejected.
// 6. Forbidden content, one isolated negative fixture per class.
// 7. Every row states the recording policy (local recording not consent-gated, sending
//    consent-gated, progress never depends on events).
// 8. The discovery payload is exactly the five named fields plus an optional time bucket.
// 9. This suite is enumerated by npm test; each negative fixture names its single violation
//    and must fail on exactly that violation (implementation-rules §14). Corrupt input
//    yields diagnostics, never a thrown error.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const TABLE = JSON.parse(fs.readFileSync(path.join(HERE, 'event-table.v1.json'), 'utf8'));
const FIXTURES = path.join(REPO, 'fixtures/event-contract');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const RECORDING = { local_recording: 'always', sending: 'consent_gated', progress_dependence: 'none' };
const rule = (id) => TABLE.rules.find((r) => r.id === id) ?? null;

// --- table-driven validator: returns violation codes; specific codes shadow the
// --- generic vocabulary one so each negative fixture isolates exactly one defect.

function fieldSpec(spec) {
  const { ref, ...rest } = spec;
  return ref ? { ...TABLE.defs[ref], ...rest } : rest;
}

function checkValue(spec, value) {
  if (spec.type === 'integer') {
    if (!Number.isInteger(value)) return false;
    if (spec.minimum !== undefined && value < spec.minimum) return false;
    if (spec.const !== undefined && value !== spec.const) return false;
    return true;
  }
  if (spec.type === 'array') {
    if (!Array.isArray(value)) return false;
    if (spec.minItems !== undefined && value.length < spec.minItems) return false;
    return value.every((el) => checkValue(fieldSpec(spec.items), el));
  }
  if (spec.type === 'string' || spec.enum || spec.pattern || spec.const !== undefined) {
    if (typeof value !== 'string') return false;
    if (spec.pattern && !new RegExp(spec.pattern).test(value)) return false;
    if (spec.enum && !spec.enum.includes(value)) return false;
    if (spec.const !== undefined && value !== spec.const) return false;
    return true;
  }
  return true;
}

function forbiddenScan(enf, payload) {
  const hits = new Map();
  const valueCode = (k, v) => {
    if (enf.coordinate_fields.includes(k)) return 'forbidden-coordinates';
    if (enf.free_text_fields.includes(k)) return 'forbidden-free-text';
    if (enf.url_token_fields.includes(k)) return 'forbidden-url-token';
    if (enf.feedback_rating_fields.includes(k)) return 'forbidden-feedback-rating';
    if (typeof v === 'string') {
      if (new RegExp(enf.url_value_pattern).test(v)) return 'forbidden-url-token';
      if (new RegExp(enf.coordinate_value_pattern).test(v)) return 'forbidden-coordinates';
    }
    return null;
  };
  for (const [k, v] of Object.entries(payload)) {
    const code = valueCode(k, v);
    if (code) { hits.set(k, code); continue; }
    if (Array.isArray(v)) {
      for (const el of v) {
        const elCode = typeof el === 'string' ? valueCode(k, el) : null;
        if (elCode) { hits.set(k, elCode); break; }
      }
    } else if (typeof v === 'string' && /\s/.test(v)) {
      hits.set(k, 'forbidden-free-text');
    }
  }
  return hits;
}

function validateEvent(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return ['shape:not-an-object'];
  if (!('type' in payload)) return ['shape:missing-type'];
  if (typeof payload.type !== 'string') return ['shape:bad-type'];
  const row = TABLE.events.find((e) => e.type === payload.type);
  if (!row) return ['unknown-type'];

  const violations = [];
  const rowFieldNames = Object.keys(row.fields);
  const contextAllowed = [...(row.context_required ?? []), ...(row.context_optional ?? [])];

  for (const [name, spec] of Object.entries(TABLE.common_fields)) {
    if (name === 'type') continue;
    if (name in payload && !checkValue(fieldSpec(spec), payload[name])) violations.push(`invalid:${name}`);
  }

  const forb = rule('forbidden-content');
  const forbidden = forb ? forbiddenScan(forb.enforcement, payload) : new Map();
  violations.push(...new Set(forbidden.values()));

  const sessionRule = rule('no-session-before-start');
  const sessionScoped = Boolean(sessionRule) && 'session_id' in payload &&
    !sessionRule.enforcement.allowed_contexts.includes(row.context);
  if (sessionScoped) violations.push('session-before-start');

  const exact = rule('exact-discovery-payload');
  const exactApplies = Boolean(exact) && exact.enforcement.applies_to.includes(payload.type);
  if (exactApplies) {
    const allowed = new Set([...Object.keys(TABLE.common_fields), ...rowFieldNames]);
    const extra = Object.keys(payload).some((k) => !allowed.has(k));
    if (extra) violations.push('discovery-payload-not-exact');
  }

  if (!exactApplies) {
    for (const k of Object.keys(payload)) {
      if (k in TABLE.common_fields) continue;
      if (k === 'session_id' && sessionRule) continue; // the rule owns session_id scope
      if (forbidden.has(k)) continue;
      if (!rowFieldNames.includes(k) && !contextAllowed.includes(k)) violations.push(`unknown-field:${k}`);
    }
  }

  const required = [...(row.context_required ?? [])];
  for (const [k, spec] of Object.entries(row.fields)) if (spec.required) required.push(k);
  for (const name of Object.keys(TABLE.common_fields)) if (!(name in payload)) violations.push(`missing:${name}`);
  for (const k of required) if (!(k in payload)) violations.push(`missing:${k}`);

  for (const k of contextAllowed) {
    if (k in payload && !checkValue(fieldSpec(TABLE.context_fields[k]), payload[k])) violations.push(`invalid:${k}`);
  }
  for (const [k, spec] of Object.entries(row.fields)) {
    if (k in payload && !forbidden.has(k) && !checkValue(fieldSpec(spec), payload[k])) violations.push(`invalid:${k}`);
  }
  return violations;
}

function validateSequence(events) {
  const violations = new Set();
  const sessionRule = rule('no-session-before-start');
  if (sessionRule) {
    const startIdx = events.findIndex((e) => e && typeof e === 'object' && e.type === 'session_started');
    events.forEach((e, i) => {
      if (e && typeof e === 'object' && 'session_id' in e && (startIdx === -1 || i < startIdx)) {
        violations.add('session-before-start');
      }
    });
  }
  for (const e of events) for (const v of validateEvent(e)) violations.add(v);
  return [...violations];
}

// --- source coverage: names are extracted from the canon, not restated here.

function extractCanonEventNames() {
  const names = new Set();
  const doc09 = fs.readFileSync(path.join(REPO, 'docs/architecture/09_technical_architecture.md'), 'utf8').split('\n');
  const enumLine = doc09.find((l) => l.startsWith('`app_open`'));
  assert.ok(enumLine, '09 §10 enumeration line not found');
  // The canon writes groups as shorthand: `purchase_started/succeeded/failed(...)` —
  // every segment after the first inherits the first segment's shared prefix.
  for (const group of enumLine.match(/`[^`]+`/g) ?? []) {
    const inner = group.slice(1, -1).replace(/\(.*\)$/, '');
    const parts = inner.split('/').map((s) => s.trim());
    const prefix = parts[0].includes('_') ? parts[0].slice(0, parts[0].lastIndexOf('_') + 1) : '';
    for (const [i, part] of parts.entries()) names.add(i === 0 || part.includes('_') ? part : prefix + part);
  }
  const nearbyLine = doc09.find((l) => l.startsWith('Аналітыка: guide_nearby_'));
  assert.ok(nearbyLine, '09 §20 analytics line not found');
  // Same shorthand convention in prose: guide_nearby_shown/opened/dismissed.
  const nearbyGroup = nearbyLine.match(/guide_nearby_[a-z]+(?:\/[a-z]+)*/);
  assert.ok(nearbyGroup, 'guide_nearby_* group not found in 09 §20');
  for (const part of nearbyGroup[0].split('/')) names.add(`guide_nearby_${part.replace(/^guide_nearby_/, '')}`);
  const doc21 = fs.readFileSync(path.join(REPO, 'docs/architecture/21_discovery_feedback_architecture.md'), 'utf8').split('\n');
  const discoLine = doc21.find((l) => l.includes('`discovery_offer_shown`'));
  assert.ok(discoLine, '21 §7 discovery line not found');
  for (const m of discoLine.matchAll(/`discovery_offer_[a-z_]+`/g)) names.add(m[0].slice(1, -1));
  return names;
}

// --- 1. table shape and coverage

test('table shape: version, unique types, anchors, context tags', () => {
  assert.equal(TABLE.table_schema_version, 1);
  const types = TABLE.events.map((e) => e.type);
  assert.equal(new Set(types).size, types.length, 'every event has exactly one row');
  for (const row of TABLE.events) {
    assert.ok(row.anchor, `${row.type} carries a source anchor`);
    assert.ok(['app', 'guide', 'session', 'story'].includes(row.context), `${row.type} context tag`);
  }
});

test('coverage: every event named in 09 §10/§20 and 21 §7 has exactly one row', () => {
  const canon = extractCanonEventNames();
  const table = new Set(TABLE.events.map((e) => e.type));
  assert.deepEqual([...table].sort(), [...canon].sort());
});

test('common fields are exactly event_id, type, at and the schema version', () => {
  assert.deepEqual(Object.keys(TABLE.common_fields), ['event_id', 'type', 'at', 'schema_version']);
  for (const name of ['session_id', 'route_id', 'version', 'locale', 'tier']) {
    assert.ok(TABLE.context_fields[name], `${name} declared as a context field`);
  }
});

// --- 7. recording policy on every row

test('every row states the consent and progress invariants', () => {
  for (const row of TABLE.events) assert.deepEqual(row.recording, RECORDING, `${row.type} recording policy`);
  assert.equal(TABLE.recording_policy.local_recording.startsWith('always'), true);
  assert.equal(TABLE.recording_policy.sending.startsWith('consent_gated'), true);
  assert.equal(TABLE.recording_policy.progress_dependence.startsWith('none'), true);
});

// --- 3. closed vocabulary and pipeline-confirmed presence

test('closed reason lists exist; stop_reached is pipeline-confirmed only', () => {
  for (const type of ['story_play_failed', 'download_failed', 'purchase_failed', 'autotriggers_unavailable', 'session_ended']) {
    const reason = TABLE.events.find((e) => e.type === type).fields.reason;
    assert.ok(reason && reason.enum.length > 0, `${type}.reason is a closed list`);
  }
  const trigger = TABLE.events.find((e) => e.type === 'story_play_started').fields.trigger;
  assert.deepEqual(trigger.enum, ['gps', 'manual']);
  assert.equal(TABLE.events.find((e) => e.type === 'stop_reached').presence, 'pipeline_confirmed_only');
});

// --- positive fixtures

test('positive: one valid example per row validates and covers every row', () => {
  const doc = readJson(path.join(FIXTURES, 'valid-events.json'));
  const seen = new Set();
  for (const event of doc.events) {
    assert.deepEqual(validateEvent(event), [], `${event.type} must validate: ${JSON.stringify(validateEvent(event))}`);
    seen.add(event.type);
  }
  const all = new Set(TABLE.events.map((e) => e.type));
  assert.deepEqual([...seen].sort(), [...all].sort(), 'the valid fixture covers every row of the table');
});

test('positive: sequences — chain without session before Start; the manual/gps play pair', () => {
  for (const file of ['valid-sequence-chain-to-start.json', 'valid-sequence-manual-play.json', 'valid-sequence-gps-play.json']) {
    const doc = readJson(path.join(FIXTURES, file));
    assert.deepEqual(validateSequence(doc.events), [], `${file} must validate`);
  }
  const manual = readJson(path.join(FIXTURES, 'valid-sequence-manual-play.json'));
  assert.equal(manual.events.some((e) => e.type === 'stop_reached'), false, 'manual play produces no stop_reached');
  const gps = readJson(path.join(FIXTURES, 'valid-sequence-gps-play.json'));
  assert.equal(gps.events.some((e) => e.type === 'stop_reached'), true, 'gps pipeline presence is recorded');
});

// --- negative fixtures: each isolates exactly one violation and names it

test('negative: each invalid fixture fails on exactly its named violation', () => {
  const files = fs.readdirSync(FIXTURES).filter((f) => f.startsWith('invalid-') && f.endsWith('.json'));
  assert.ok(files.length >= 11, 'the invalid fixture set is present');
  for (const file of files) {
    const doc = readJson(path.join(FIXTURES, file));
    const violations = validateEvent(doc.event);
    assert.ok(violations.length > 0, `${file} must be rejected`);
    assert.deepEqual(violations, [doc.violates], `${file} must fail on exactly ${doc.violates}`);
  }
});

test('negative: the forbidden-content classes are covered one fixture per class', () => {
  const classes = ['forbidden-coordinates', 'forbidden-free-text', 'forbidden-url-token', 'forbidden-feedback-rating'];
  const files = fs.readdirSync(FIXTURES).filter((f) => f.startsWith('invalid-') && f.endsWith('.json'));
  const covered = new Set(files.map((f) => readJson(path.join(FIXTURES, f)).violates));
  for (const c of classes) assert.ok(covered.has(c), `class ${c} has an isolated negative fixture`);
});

// --- corrupt input: diagnostics, never a throw (implementation-rules §14)

test('corrupt input yields diagnostics for every case and never throws', () => {
  const doc = readJson(path.join(FIXTURES, 'corrupt-inputs.json'));
  assert.ok(doc.cases.length >= 10);
  for (const [i, case_] of doc.cases.entries()) {
    let violations;
    assert.doesNotThrow(() => { violations = validateEvent(case_.payload); }, `case ${i} must not throw`);
    assert.ok(violations.length > 0, `case ${i} must produce diagnostics`);
    assert.ok(violations.every((v) => v.startsWith(case_.expect_prefix)),
      `case ${i}: expected prefix ${case_.expect_prefix}, got ${JSON.stringify(violations)}`);
  }
});
