// G09.05 — acceptance suite for the remote config contract (issue #295,
// criteria 3–4). Every negative fixture isolates exactly one violation and
// names its rule (implementation-rules 14); corrupt input answers with
// diagnostics, never a throw. The hostile-document cases are the criterion 4
// guarantee: the closed dictionary carries numbers only, so a config
// response structurally cannot unlock paid content or carry a URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RemoteConfigContractError,
  checkRemoteConfig,
  loadDefaultRemoteConfig,
} from './remote-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const rules = (verdict) => verdict.errors.map((entry) => entry.rule);

test('positive: the canonical defaults document passes its own contract', () => {
  const doc = loadDefaultRemoteConfig();
  assert.equal(checkRemoteConfig(doc).ok, true);
  // The defaults verbatim: dwell 6000 ms and accuracy 40 m are the canon
  // numbers (10 §research, core/pipeline defaultPipelineConfig); the rest
  // are proposals awaiting field calibration (G11.02), marked in the schema
  // description.
  assert.deepEqual(doc, {
    config_schema_version: 1,
    trigger_radius_default: 40,
    dwell_ms: 6000,
    accuracy_gate_m: 40,
    moment_cooldown_min: 10,
    moments_per_session_max: 2,
    min_app_version: 1,
  });
});

test('positive: boundary values of every range pass', () => {
  const verdict = checkRemoteConfig({
    config_schema_version: 1,
    trigger_radius_default: 500,
    dwell_ms: 120000,
    accuracy_gate_m: 200,
    moment_cooldown_min: 10080,
    moments_per_session_max: 20,
    min_app_version: 1000000,
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.errors));
});

test('negative: an unknown field is named — a config cannot smuggle an unlock flag', () => {
  const doc = { ...minimalDoc(), unlock_extended: true };
  const verdict = checkRemoteConfig(doc);
  assert.deepEqual(rules(verdict), ['config-unknown-field']);
  assert.equal(verdict.errors[0].path, '$.unlock_extended');
});

test('negative: a URL-valued field is named — no egress target in the config', () => {
  const doc = { ...minimalDoc(), min_app_version: 'https://example.invalid/payload.json' };
  const verdict = checkRemoteConfig(doc);
  assert.deepEqual(rules(verdict), ['config-field-type']);
  assert.equal(verdict.errors[0].path, '$.min_app_version');
});

test('negative: a missing field is named', () => {
  const { dwell_ms: _omitted, ...doc } = minimalDoc();
  const verdict = checkRemoteConfig(doc);
  assert.ok(rules(verdict).includes('config-field-required'), JSON.stringify(verdict.errors));
});

test('negative: an out-of-range value is named, below and above', () => {
  const below = checkRemoteConfig({ ...minimalDoc(), dwell_ms: 999 });
  assert.deepEqual(rules(below), ['config-value-below-minimum']);
  const above = checkRemoteConfig({ ...minimalDoc(), moments_per_session_max: 21 });
  assert.deepEqual(rules(above), ['config-value-above-maximum']);
});

test('negative: a foreign schema version is named, never interpreted', () => {
  const verdict = checkRemoteConfig({ ...minimalDoc(), config_schema_version: 2 });
  assert.deepEqual(rules(verdict), ['config-version-unsupported']);
});

test('negative: a non-finite JS value is named per field (the schema cannot see NaN)', () => {
  const verdict = checkRemoteConfig({ ...minimalDoc(), accuracy_gate_m: Number.NaN });
  assert.deepEqual(rules(verdict), ['config-value-non-finite']);
});

test('negative: accuracy above the trigger radius is named (11 §13 direction)', () => {
  const doc = { ...minimalDoc(), trigger_radius_default: 40, accuracy_gate_m: 41 };
  const verdict = checkRemoteConfig(doc);
  assert.deepEqual(rules(verdict), ['config-accuracy-exceeds-radius']);
});

test('corrupt input: null, array, string and a wrong-typed envelope answer with diagnostics', () => {
  for (const doc of [null, [], 'config', 7]) {
    const verdict = checkRemoteConfig(doc);
    assert.equal(verdict.ok, false, JSON.stringify(doc));
    assert.ok(verdict.errors.length > 0);
    for (const entry of verdict.errors) {
      assert.equal(typeof entry.rule, 'string');
    }
  }
});

test('guard: the defaults loader refuses a defaults file that fails its own contract', () => {
  const broken = path.join(os.tmpdir(), `remote-config-broken-${String(process.pid)}.json`);
  fs.writeFileSync(broken, JSON.stringify({ ...minimalDoc(), moments_per_session_max: 99 }));
  try {
    assert.throws(
      () => loadDefaultRemoteConfig(broken),
      (error) => error instanceof RemoteConfigContractError && /failed its contract/.test(error.message),
    );
  } finally {
    fs.unlinkSync(broken);
  }
});

test('guard: the defaults loader names an unreadable file', () => {
  assert.throws(
    () => loadDefaultRemoteConfig(path.join(os.tmpdir(), `remote-config-missing-${String(process.pid)}.json`)),
    (error) => error instanceof RemoteConfigContractError && /unreadable/.test(error.message),
  );
});

test('guard: this suite is wired into npm test (implementation-rules 7)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'package.json'), 'utf8'));
  assert.ok(
    pkg.scripts.test.includes('contracts/config/remote-config.test.mjs'),
    'removing contracts/config/remote-config.test.mjs from the npm test script must fail this guard',
  );
});

function minimalDoc() {
  return {
    config_schema_version: 1,
    trigger_radius_default: 40,
    dwell_ms: 6000,
    accuracy_gate_m: 40,
    moment_cooldown_min: 10,
    moments_per_session_max: 2,
    min_app_version: 1,
  };
}
