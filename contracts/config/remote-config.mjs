// G09.05 — the remote config document (GET /v1/config) and its checker. The
// field list is copied verbatim from `09` §5 (trigger_radius_default,
// dwell_ms, accuracy_gate_m, moment_cooldown_min, moments_per_session_max,
// min_app_version — no second spelling); the schema carries the closed
// dictionary and the bounds. Named rules follow the guide-hints checker
// idiom: each schema keyword maps to the diagnostic the negative fixtures
// assert on; anything else (corrupt input: null, wrong types, a missing
// version) passes through as diagnostics, never a throw. Node stdlib only.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSchemaFile } from '../reader.mjs';

const SCHEMA_FILE = 'schemas/remote-config.schema.json';

// Schema keywords carry no domain names; each maps to the named diagnostic
// the negative fixtures assert on.
const NAMED_BY_KEYWORD = {
  additionalProperties: 'config-unknown-field',
  const: 'config-version-unsupported',
  required: 'config-field-required',
  type: 'config-field-type',
  minimum: 'config-value-below-minimum',
  maximum: 'config-value-above-maximum',
};

// The six §5 numbers (envelope excluded): the finite gate is the only guard
// against NaN/±Infinity — every schema comparison is false for them, so the
// schema alone passes them through (#391 idiom: one entry per field).
const NUMBER_FIELDS = [
  'trigger_radius_default',
  'dwell_ms',
  'accuracy_gate_m',
  'moment_cooldown_min',
  'moments_per_session_max',
  'min_app_version',
];

export function checkRemoteConfig(doc) {
  const errors = [];
  for (const e of validateSchemaFile(SCHEMA_FILE, doc).errors) {
    errors.push({ rule: NAMED_BY_KEYWORD[e.keyword] ?? e.keyword, path: e.path });
  }
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    for (const field of NUMBER_FIELDS) {
      const value = doc[field];
      if (typeof value === 'number' && !Number.isFinite(value)) {
        errors.push({ rule: 'config-value-non-finite', path: `$.${field}` });
      }
    }
    const radius = doc.trigger_radius_default;
    const accuracy = doc.accuracy_gate_m;
    if (
      typeof radius === 'number' &&
      typeof accuracy === 'number' &&
      Number.isFinite(radius) &&
      Number.isFinite(accuracy) &&
      accuracy > radius
    ) {
      // `11` §13: the accepted-fix rule compares accuracy ≤ trigger_radius —
      // a config document that inverts it cannot be applied as-is.
      errors.push({ rule: 'config-accuracy-exceeds-radius', path: '$.accuracy_gate_m' });
    }
  }
  return { ok: errors.length === 0, errors };
}

// The canonical default document next to this module; the argument is the
// tests' seam (a fixture path), production reads the shipped contract file.
// A default document that fails its own contract is a build-time defect, not
// a runtime fallback: a named error, never a silent pass-through.
export function loadDefaultRemoteConfig(path) {
  const file =
    path ??
    join(dirname(fileURLToPath(import.meta.url)), 'remote-config.defaults.v1.json');
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new RemoteConfigContractError(`the canonical remote config defaults file is unreadable: ${file}`, error);
  }
  const verdict = checkRemoteConfig(doc);
  if (!verdict.ok) {
    const reasons = verdict.errors.map((entry) => `${entry.rule} at ${entry.path}`).join('; ');
    throw new RemoteConfigContractError(`the canonical remote config defaults file failed its contract: ${reasons}`);
  }
  return doc;
}

export class RemoteConfigContractError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'RemoteConfigContractError';
  }
}
