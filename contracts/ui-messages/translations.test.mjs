// G21.25 — the per-locale translation-set contract tests. Every named rule
// ships with an isolating negative fixture that asserts the rule and nothing
// else (implementation-rules 14); the corrupt-input cases answer with
// diagnostics, never a throw. The staleness rule is the re-review trigger of
// the owner's specification: a changed source record makes every translation
// pinning the old hash stale.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadUiMessagesSource, sourceHash } from './ui-messages.mjs';
import { checkUiMessageTranslations, loadUiMessageTranslations, TranslationsContractError } from './translations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sourceDoc = loadUiMessagesSource();
const shippedPath = (locale) => join(here, 'translations', `${locale}.json`);
const hashById = new Map(sourceDoc.records.map((record) => [record.id, record.sourceHash]));
const sourceRecord = sourceDoc.records.find((record) => record.id === 'native.chrome.back');
const templateRecord = sourceDoc.records.find((record) => record.id === 'native.chrome.heardCount');

function validRecord(overrides = {}) {
  const record = {
    id: 'native.chrome.back',
    value: 'Назад',
    reviewedSourceHash: undefined,
    review: { outcome: 'approved' },
    ...overrides,
  };
  // The hash pins exactly the record the id names — a fixture that swaps the
  // id without swapping the hash tests staleness, not its own rule.
  if (record.reviewedSourceHash === undefined) record.reviewedSourceHash = hashById.get(record.id);
  delete record.sourceHash;
  return record;
}

function setWith(records, overrides = {}) {
  return {
    translation_schema_version: 1,
    locale: 'en',
    provenance: { kind: 'test', reviewer: 'owner', evidence: 'тэставы набор' },
    records,
    ...overrides,
  };
}

function rulesOf(doc) {
  return checkUiMessageTranslations(doc, sourceDoc, ['en', 'uk', 'de', 'es', 'fr', 'cs', 'sv']).errors.map((error) => error.rule);
}

test('shipped translation sets pass their own contract', () => {
  for (const locale of ['en', 'uk']) {
    const set = loadUiMessageTranslations(shippedPath(locale), sourceDoc, ['en', 'uk', 'de', 'es', 'fr', 'cs', 'sv']);
    assert.equal(set.translation_schema_version, 1);
    assert.equal(set.locale, locale);
    assert.ok(set.records.length > 200);
    assert.equal(set.provenance.kind, 'migration');
  }
});

test('the uk set covers every source record except the documented guideHint fallback', () => {
  const set = loadUiMessageTranslations(shippedPath('uk'), sourceDoc, ['en', 'uk']);
  const covered = new Set(set.records.map((record) => record.id));
  const missing = sourceDoc.records.filter((record) => !covered.has(record.id)).map((record) => record.id);
  assert.deepEqual(missing, sourceDoc.records
    .filter((record) => record.id.startsWith('native.guideHint.'))
    .map((record) => record.id));
});

test('translation_schema_version_denied: a foreign envelope version is rejected', () => {
  const doc = setWith([validRecord()], { translation_schema_version: 2 });
  assert.deepEqual(rulesOf(doc), ['translation_schema_version_denied']);
});

test('locale_denied: an unregistered locale code is rejected', () => {
  const doc = setWith([validRecord()], { locale: 'xx' });
  assert.deepEqual(rulesOf(doc), ['locale_denied']);
});

test('source_locale_denied: the be source locale owns no translation set', () => {
  const doc = setWith([validRecord()], { locale: 'be' });
  const verdict = checkUiMessageTranslations(doc, sourceDoc, ['be', 'en', 'uk', 'de', 'es', 'fr', 'cs', 'sv']);
  assert.deepEqual(verdict.errors.map((error) => error.rule), ['source_locale_denied']);
});

test('unknown_id_denied: a record without a canonical source id is rejected', () => {
  const record = validRecord({ id: 'native.chrome.notAWord', reviewedSourceHash: '1'.repeat(64) });
  assert.deepEqual(rulesOf(setWith([record])), ['unknown_id_denied']);
});

test('duplicate_key_denied: two records with one id are rejected', () => {
  const doc = setWith([validRecord(), validRecord()]);
  assert.deepEqual(rulesOf(doc), ['duplicate_key_denied']);
});

test('stale_translation_denied: a translation pinning an old source hash is stale', () => {
  const record = validRecord({ reviewedSourceHash: '0'.repeat(64) });
  assert.deepEqual(rulesOf(setWith([record])), ['stale_translation_denied']);
});

test('stale_translation_denied fires on a real source change, not just a fake hash', () => {
  // A real source edit re-hashes the record (the source checker enforces the
  // stored hash), so the fixture edits and re-hashes — the translation still
  // pinning the old fingerprint turns stale.
  const editedSource = 'Назад!';
  const edited = { ...sourceRecord, source: editedSource, sourceHash: sourceHash({ ...sourceRecord, source: editedSource }) };
  const stale = validRecord(); // pins the OLD record's hash
  const verdict = checkUiMessageTranslations(setWith([stale]), { ...sourceDoc, records: [edited] }, ['en']);
  assert.deepEqual(verdict.errors.map((error) => error.rule), ['stale_translation_denied']);
});

test('form_set_mismatch_denied: forms must mirror the source discreteForms keys exactly', () => {
  const missing = validRecord({ id: 'native.chrome.timeCap', value: 'Up to ${minutes} min', forms: {} });
  assert.deepEqual(rulesOf(setWith([missing])), ['form_set_mismatch_denied']);
  const extra = validRecord({
    id: 'native.chrome.timeCap',
    value: 'Up to ${minutes} min',
    forms: { 60: 'Up to an hour', 120: 'Up to two hours', 240: 'Half a day', 480: 'All day' },
  });
  assert.deepEqual(rulesOf(setWith([extra])), ['form_set_mismatch_denied']);
  const aligned = validRecord({
    id: 'native.chrome.timeCap',
    value: 'Up to ${minutes} min',
    forms: { 60: 'Up to an hour', 120: 'Up to two hours', 240: 'Half a day' },
  });
  assert.deepEqual(rulesOf(setWith([aligned])), []);
});

test('param_mismatch_denied: dropped and invented placeholders are both rejected', () => {
  const dropped = validRecord({ id: 'native.chrome.heardCount', value: 'праслышана' });
  assert.deepEqual(rulesOf(setWith([dropped])), ['param_mismatch_denied']);
  const invented = validRecord({ id: 'native.chrome.heardCount', value: 'праслышана: ${count} з ${total}' });
  assert.deepEqual(rulesOf(setWith([invented])), ['param_mismatch_denied']);
});

test('executable_payload_denied: markup and calls cannot be translation words', () => {
  for (const value of ['<script>alert(1)</script>', 'javascript:void(0)', 'eval("1")', '<b onmouseover="x()">слово</b>']) {
    const record = validRecord({ value });
    assert.deepEqual(rulesOf(setWith([record])), ['executable_payload_denied'], value);
  }
});

test('value_blank_denied: whitespace-only values are rejected', () => {
  const record = validRecord({ value: '   ' });
  assert.deepEqual(rulesOf(setWith([record])), ['value_blank_denied']);
});

test('unknown_field_denied: the record shape stays closed', () => {
  const record = validRecord({ provenance: 'не тут' });
  assert.deepEqual(rulesOf(setWith([record])), ['unknown_field_denied']);
});

test('corrupt input answers with diagnostics, never a throw', () => {
  for (const doc of [null, 5, 'text', [], setWith([null]), setWith([7]), setWith(['text'])]) {
    const verdict = checkUiMessageTranslations(doc, sourceDoc, ['en']);
    assert.equal(verdict.ok, false);
    assert.ok(Array.isArray(verdict.errors) && verdict.errors.length > 0);
  }
  const empty = checkUiMessageTranslations(setWith([]), sourceDoc, ['en']);
  assert.ok(empty.errors.some((error) => error.rule === 'field_length'), 'the schema minItems rule names the empty set');
});

test('a record whose source hash is recomputed matches the pinned one (loader seam)', () => {
  assert.equal(validRecord().reviewedSourceHash, sourceHash(sourceRecord));
  assert.ok(templateRecord.parameters.length > 0);
});

test('loadUiMessageTranslations fails closed with a named error on a broken file', () => {
  assert.throws(() => loadUiMessageTranslations('translations/nowhere.json', sourceDoc, ['en']), (error) => {
    assert.ok(error instanceof TranslationsContractError);
    assert.match(error.message, /unreadable/);
    return true;
  });
});
