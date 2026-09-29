// G07.04 — nearby-guide hint values (R07): the proposal in
// guide-hints.values.v1.json plus the named rules a single JSON document
// cannot express (ADR G07.04 §3: the accuracy rule compares two fields).
// The numbers are proposals awaiting the founder decision; field calibration
// is G11.02. Node stdlib only.
import { validateSchemaFile } from '../reader.mjs';

const SCHEMA_FILE = 'schemas/guide-hints.schema.json';

// Schema keywords carry no domain names; each maps to the named diagnostic the
// invalid fixtures assert on. Anything else (corrupt input: null, wrong
// types, a missing version) passes through as-is — diagnostics, never a throw.
const NAMED_BY_KEYWORD = {
  additionalProperties: 'hint-unknown-field',
  minimum: 'hint-value-non-positive',
};

export function checkGuideHintValues(doc) {
  const errors = [];
  for (const e of validateSchemaFile(SCHEMA_FILE, doc).errors) {
    if (e.keyword === 'required' && e.path.endsWith('.foreground_cooldown_s')) {
      errors.push({ rule: 'hint-cooldown-required', path: e.path });
    } else if (NAMED_BY_KEYWORD[e.keyword]) {
      errors.push({ rule: NAMED_BY_KEYWORD[e.keyword], path: e.path });
    } else {
      errors.push({ rule: e.keyword, path: e.path });
    }
  }
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    const radius = doc.proximity_radius_m;
    const accuracy = doc.accepted_accuracy_m;
    if (typeof radius === 'number' && typeof accuracy === 'number') {
      // The schema minimum cannot see NaN/±Infinity (every comparison is
      // false) — the finite gate is the only guard for the two number fields.
      if (!Number.isFinite(radius) || !Number.isFinite(accuracy)) {
        errors.push({
          rule: 'hint-value-non-finite',
          path: Number.isFinite(radius) ? '$.accepted_accuracy_m' : '$.proximity_radius_m',
        });
      } else if (accuracy >= radius) {
        errors.push({ rule: 'hint-accuracy-exceeds-radius', path: '$.accepted_accuracy_m' });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
