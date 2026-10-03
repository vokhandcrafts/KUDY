// G16.01 — the closed lists and patterns of feedback-core vs their
// canonical sources (implementation-rules 2: a restatement is guarded, not
// trusted): the identifier and target schemas of contracts/schemas/, the
// fixture's pinned disclosure version and reason codes, and the request
// validation verdicts the wire suites rely on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import {
  DISCLOSURE_VERSIONS,
  FEEDBACK_DEVICE_RATE_LIMIT,
  FEEDBACK_IP_RATE_LIMIT,
  FEEDBACK_MAX_BODY_BYTES,
  FEEDBACK_RATE_WINDOW_MS,
  GUIDE_REASON_CODES,
  IDENTIFIER_PATTERN,
  PLACE_REASON_CODES,
  TARGET_VERSION_PATTERN,
  validateDeleteBody,
  validatePutBody,
  validateReadBody,
  validateReasonCodes,
  validateTarget,
  mutationPayloadHash,
} from '../../functions/feedback/feedback-core.ts';
import { REGISTRY_LOCALES } from '../../functions/feedback/registry-import.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const schemaDir = path.join(repoRoot, 'contracts', 'schemas');
const fixture = JSON.parse(
  readFileSync(path.join(repoRoot, 'fixtures', 'discovery-contract', 'feedback-cases.json'), 'utf8'),
) as {
  disclosure_version: string;
  targets: Array<Record<string, unknown>>;
  unknown_targets: Array<Record<string, unknown>>;
};

const GUIDE_TARGET = { kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' };
const PLACE_TARGET = { kind: 'place', place_id: 'place-a1', content_version: '1', locale: 'be' };

// --- drift guards against the committed contracts ---

test('guard: the identifier pattern is the schema file verbatim', () => {
  const identifier = JSON.parse(readFileSync(path.join(schemaDir, 'identifier.schema.json'), 'utf8'));
  assert.equal(IDENTIFIER_PATTERN, identifier.pattern);
});

test('guard: the target schema shape matches the validation contract', () => {
  const schema = JSON.parse(readFileSync(path.join(schemaDir, 'feedback-target.schema.json'), 'utf8'));
  const [guide, place] = schema.oneOf;
  assert.deepEqual(guide.required, ['kind', 'route_id', 'version', 'locale']);
  assert.deepEqual(place.required, ['kind', 'place_id', 'content_version', 'locale']);
  assert.equal(guide.additionalProperties, false);
  assert.equal(place.additionalProperties, false);
  // The registry-side locale enum is the schema's; request validation stays
  // structural on purpose (the fixture's reserved `pl` must reach the
  // registry check and answer unknown_target, not invalid_target).
  assert.deepEqual(REGISTRY_LOCALES, guide.properties.locale.enum);
  assert.equal(schema.title, 'FeedbackTarget (feedback_target_registry)');
  // version: "^[0-9]+$" + maxLength 64 — the combined request pattern must
  // accept exactly that intersection.
  assert.equal(guide.properties.version.pattern, '^[0-9]+$');
  assert.equal(guide.properties.version.maxLength, 64);
  assert.equal(new RegExp(TARGET_VERSION_PATTERN).test('9'.repeat(64)), true);
  assert.equal(new RegExp(TARGET_VERSION_PATTERN).test('9'.repeat(65)), false);
});

test('guard: the disclosure version and reason codes come from the fixture and the spec', () => {
  assert.ok(DISCLOSURE_VERSIONS.includes(fixture.disclosure_version), 'the fixture consent version is allowed');
  for (const code of ['interesting_stories', 'clear_delivery', 'too_long', 'hard_to_navigate', 'audio_problem', 'description_mismatch']) {
    assert.ok(GUIDE_REASON_CODES.includes(code), `guide reason ${code} is in the closed list (21 §5.1)`);
    assert.equal(validateReasonCodes('guide', [code]), null);
    if (!PLACE_REASON_CODES.includes(code)) {
      assert.notEqual(validateReasonCodes('place', [code]), null, `guide reason ${code} is not a place reason`);
    }
  }
  for (const code of ['worth_visiting', 'description_mismatch', 'hard_to_reach', 'access_problem']) {
    assert.ok(PLACE_REASON_CODES.includes(code), `place reason ${code} is in the closed list (21 §5.1)`);
    assert.equal(validateReasonCodes('place', [code]), null);
    if (!GUIDE_REASON_CODES.includes(code)) {
      assert.notEqual(validateReasonCodes('guide', [code]), null, `place reason ${code} is not a guide reason`);
    }
  }
  assert.equal(FEEDBACK_MAX_BODY_BYTES, 8192);
  assert.equal(FEEDBACK_DEVICE_RATE_LIMIT, 30);
  assert.equal(FEEDBACK_IP_RATE_LIMIT, 120);
  assert.equal(FEEDBACK_RATE_WINDOW_MS, 60_000);
});

test('guard: fixture targets validate structurally; unknown targets reach the registry check', () => {
  for (const target of fixture.targets) {
    assert.equal(validateTarget(target).ok, true, `fixture target ${JSON.stringify(target)} must be structurally valid`);
  }
  // The imported OSM id and the reserved locale are well-formed targets —
  // their 422 comes from the registry, not the shape check.
  for (const target of fixture.unknown_targets) {
    assert.equal(validateTarget(target).ok, true, `unknown target ${JSON.stringify(target)} must pass the shape check`);
  }
});

// --- target validation ---

test('validateTarget: shape, closed fields and patterns', () => {
  assert.deepEqual(validateTarget(GUIDE_TARGET), { ok: true, key: { kind: 'guide', id: 'guide-route-a1', version: '1', locale: 'be' } });
  assert.deepEqual(validateTarget(PLACE_TARGET), { ok: true, key: { kind: 'place', id: 'place-a1', version: '1', locale: 'be' } });

  const rejects = (candidate: unknown, reason: RegExp) => {
    const verdict = validateTarget(candidate);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.match(verdict.reason, reason);
  };
  rejects(null, /must be a JSON object/);
  rejects('guide', /must be a JSON object/);
  rejects([], /must be a JSON object/);
  rejects({ kind: 'collection', route_id: 'c', version: '1', locale: 'be' }, /kind: must be guide or place/);
  rejects({ kind: 'guide', route_id: 'guide-route-a1', locale: 'be' }, /required field missing/);
  rejects({ ...GUIDE_TARGET, extra: 1 }, /extra: unknown field/);
  rejects({ kind: 'guide', route_id: 'GUIDE-ROUTE', version: '1', locale: 'be' }, /invalid identifier/);
  rejects({ kind: 'guide', route_id: 'guide route', version: '1', locale: 'be' }, /invalid identifier/);
  rejects({ kind: 'guide', route_id: 'g'.repeat(65), version: '1', locale: 'be' }, /invalid identifier/);
  rejects({ kind: 'guide', route_id: 'guide-route-a1', version: '1a', locale: 'be' }, /invalid version/);
  rejects({ kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'BE' }, /invalid locale/);
  rejects({ kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be be' }, /invalid locale/);
  // A guide field on a place target is an unknown field, not a missing one —
  // the closed per-kind field sets are separate.
  rejects({ kind: 'place', place_id: 'place-a1', version: '1', locale: 'be' }, /unknown field/);
});

// --- payload validation ---

const PUT_BODY = {
  mutation_id: '00000000-0000-4000-8000-000000000001',
  target: GUIDE_TARGET,
  expected_revision: 0,
  score: 4,
  reason_codes: ['audio_problem', 'interesting_stories'],
  disclosure_version: 'feedback-disclosure-1',
};

test('validatePutBody: canonical reasons and a stable payload hash', () => {
  const verdict = validatePutBody(PUT_BODY);
  assert.equal(verdict.ok, true);
  if (verdict.ok) {
    assert.deepEqual(verdict.reasonCodes, ['audio_problem', 'interesting_stories'], 'reasons canonicalize sorted');
    assert.equal(verdict.payloadHash, mutationPayloadHash('put', verdict.key, {
      expectedRevision: 0,
      score: 4,
      reasonCodes: verdict.reasonCodes,
      disclosureVersion: 'feedback-disclosure-1',
    }));
  }
  // The same payload in a different JSON key order is the identical mutation.
  const reordered: Record<string, unknown> = {
    disclosure_version: PUT_BODY.disclosure_version,
    reason_codes: ['interesting_stories', 'audio_problem'],
    score: 4,
    expected_revision: 0,
    target: { locale: 'be', version: '1', route_id: 'guide-route-a1', kind: 'guide' },
    mutation_id: PUT_BODY.mutation_id,
  };
  const other = validatePutBody(reordered);
  assert.equal(other.ok, true);
  if (verdict.ok && other.ok) {
    assert.equal(other.payloadHash, verdict.payloadHash, 'key and reason order cannot fork the hash');
  }
  const changed = validatePutBody({ ...PUT_BODY, score: 5 });
  const original = validatePutBody(PUT_BODY);
  if (changed.ok && original.ok) {
    assert.notEqual(changed.payloadHash, original.payloadHash, 'a different score is a different mutation');
  }
});

test('validatePutBody: closed envelope and per-field failure codes', () => {
  const errorOf = (body: unknown) => {
    const verdict = validatePutBody(body);
    assert.equal(verdict.ok, false);
    return verdict.ok ? '' : verdict.error;
  };
  assert.equal(errorOf(null), 'invalid_request');
  assert.equal(errorOf('put'), 'invalid_request');
  assert.equal(errorOf({ ...PUT_BODY, unexpected: 1 }), 'invalid_request');
  for (const field of ['mutation_id', 'target', 'expected_revision', 'score', 'reason_codes', 'disclosure_version']) {
    const partial = { ...PUT_BODY } as Record<string, unknown>;
    delete partial[field];
    assert.equal(errorOf(partial), field === 'target' ? 'invalid_request' : 'invalid_request');
  }
  assert.equal(errorOf({ ...PUT_BODY, mutation_id: 'not-a-uuid' }), 'invalid_request');
  assert.equal(errorOf({ ...PUT_BODY, expected_revision: -1 }), 'invalid_request');
  assert.equal(errorOf({ ...PUT_BODY, expected_revision: 1.5 }), 'invalid_request');
  assert.equal(errorOf({ ...PUT_BODY, target: { kind: 'guide' } }), 'invalid_target');
  assert.equal(errorOf({ ...PUT_BODY, score: 0 }), 'invalid_scale');
  assert.equal(errorOf({ ...PUT_BODY, score: 6 }), 'invalid_scale');
  assert.equal(errorOf({ ...PUT_BODY, score: 3.5 }), 'invalid_scale');
  assert.equal(errorOf({ ...PUT_BODY, score: '4' }), 'invalid_scale');
  assert.equal(errorOf({ ...PUT_BODY, reason_codes: 'audio_problem' }), 'invalid_reason');
  assert.equal(errorOf({ ...PUT_BODY, reason_codes: ['made_up_reason'] }), 'invalid_reason');
  assert.equal(errorOf({ ...PUT_BODY, reason_codes: ['interesting_stories', 'interesting_stories'] }), 'invalid_reason');
  assert.equal(
    errorOf({ ...PUT_BODY, reason_codes: ['interesting_stories', 'clear_delivery', 'too_long', 'hard_to_navigate'] }),
    'invalid_reason',
    'four valid reasons still exceed the three-reason limit',
  );
  assert.equal(validateReasonCodes('guide', GUIDE_REASON_CODES.slice(0, 3)), null, 'three reasons pass');
  assert.notEqual(validateReasonCodes('guide', GUIDE_REASON_CODES.slice(0, 4)), null, 'four reasons fail');
  assert.equal(errorOf({ ...PUT_BODY, disclosure_version: 'feedback-disclosure-0' }), 'invalid_disclosure');
});

test('validateDeleteBody and validateReadBody: closed envelopes', () => {
  const deleteVerdict = validateDeleteBody({
    mutation_id: PUT_BODY.mutation_id,
    target: PLACE_TARGET,
    expected_revision: 2,
  });
  assert.equal(deleteVerdict.ok, true);
  if (deleteVerdict.ok) {
    assert.equal(deleteVerdict.payloadHash, mutationPayloadHash('delete', deleteVerdict.key, { expectedRevision: 2 }));
  }
  const putHash = validatePutBody(PUT_BODY);
  const deleteHash = validateDeleteBody({ mutation_id: PUT_BODY.mutation_id, target: GUIDE_TARGET, expected_revision: 0 });
  if (putHash.ok && deleteHash.ok) {
    assert.notEqual(putHash.payloadHash, deleteHash.payloadHash, 'put and delete mutations never share a hash');
  }

  const deleteErrorOf = (body: unknown) => {
    const verdict = validateDeleteBody(body);
    return verdict.ok ? null : verdict.error;
  };
  assert.equal(deleteErrorOf({ ...PUT_BODY, unexpected: 1 }), 'invalid_request');
  assert.equal(deleteErrorOf({ mutation_id: PUT_BODY.mutation_id, target: GUIDE_TARGET }), 'invalid_request');
  assert.equal(deleteErrorOf({ mutation_id: PUT_BODY.mutation_id, target: { kind: 'guide' }, expected_revision: 1 }), 'invalid_target');

  const readVerdict = validateReadBody({ target: GUIDE_TARGET });
  assert.equal(readVerdict.ok, true);
  const readErrorOf = (body: unknown) => {
    const verdict = validateReadBody(body);
    return verdict.ok ? null : verdict.error;
  };
  assert.equal(readErrorOf({ target: GUIDE_TARGET, extra: true }), 'invalid_request');
  assert.equal(readErrorOf({}), 'invalid_request');
  assert.equal(readErrorOf({ target: { kind: 'guide', route_id: 'BAD', version: '1', locale: 'be' } }), 'invalid_target');
});
