// G21.24 — the canonical UI-message source contract tests. Every named rule
// ships with an isolating negative fixture that asserts the rule and nothing
// else (implementation-rules 14); the corrupt-input cases answer with
// diagnostics, never a throw. The fingerprint tests are criterion 3: any
// source/context/parameter/constraint change changes sourceHash, provenance
// edits do not.
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkUiMessages, loadUiMessagesSource, sourceHash } from './ui-messages.mjs';

function validRecord(overrides = {}) {
  const record = {
    id: 'test.native.word',
    source: 'Слова',
    context: 'Кантэкст тэсту: кароткая назва',
    format: 'plain',
    parameters: [],
    migratedFrom: ['test/catalog.ts#word'],
    sourceHash: '',
    ...overrides,
  };
  record.sourceHash = sourceHash(record);
  return record;
}

function docWith(records, envelope = {}) {
  return { source_schema_version: 1, source_locale: 'be', records, ...envelope };
}

function rulesOf(doc) {
  return checkUiMessages(doc).errors.map((error) => error.rule);
}

test('source_record_valid: the shipped canonical file loads and passes its own contract', () => {
  const doc = loadUiMessagesSource();
  assert.equal(doc.source_schema_version, 1);
  assert.equal(doc.source_locale, 'be');
  assert.ok(Array.isArray(doc.records) && doc.records.length > 0);
  const verdict = checkUiMessages(doc);
  assert.deepEqual(verdict, { ok: true, errors: [] });
  // Every record carries a stored hash; the loader already verified each — a
  // spot check here keeps the export shape honest.
  for (const record of doc.records) {
    assert.match(record.sourceHash, /^[0-9a-f]{64}$/);
    assert.ok(record.context.trim().length > 0);
  }
});

test('duplicate_key_denied: two records with one id are rejected', () => {
  const rules = rulesOf(docWith([validRecord(), validRecord({ context: 'Іншы кантэкст' })]));
  assert.ok(rules.includes('duplicate_key_denied'));
});

test('context_required: a record without context is rejected', () => {
  const record = validRecord();
  delete record.context;
  const rules = rulesOf(docWith([record]));
  assert.ok(rules.includes('context_required'));
  // Whitespace-only context is the same violation.
  const blank = validRecord({ context: '   ' });
  assert.ok(rulesOf(docWith([blank])).includes('context_required'));
});

test('unknown_field_denied: an extra record field is rejected', () => {
  const rules = rulesOf(docWith([validRecord({ translatorNote: 'пазасхемнае поле' })]));
  assert.ok(rules.includes('unknown_field_denied'));
});

test('message_syntax_denied: a placeholder naming no declared parameter is rejected', () => {
  const record = validRecord({
    id: 'test.native.phrase',
    source: 'прагулка: ${count}',
    format: 'template',
    parameters: [{ name: 'heard', type: 'number' }],
  });
  assert.ok(rulesOf(docWith([record])).includes('message_syntax_denied'));
});

test('message_syntax_denied: a malformed placeholder is rejected', () => {
  const record = validRecord({
    id: 'test.native.phrase',
    source: 'прагулка: ${count.toUpperCase()}',
    format: 'template',
    parameters: [{ name: 'count', type: 'number' }],
  });
  assert.ok(rulesOf(docWith([record])).includes('message_syntax_denied'));
});

test('message_syntax_denied: a template record without parameters is rejected', () => {
  const record = validRecord({ id: 'test.native.phrase', source: 'проста', format: 'template' });
  assert.ok(rulesOf(docWith([record])).includes('message_syntax_denied'));
});

test('message_syntax_denied: a declared parameter unused in source or discrete forms is rejected', () => {
  const record = validRecord({
    id: 'test.native.phrase',
    source: 'прагулка: ${count}',
    format: 'template',
    parameters: [
      { name: 'count', type: 'number' },
      { name: 'position', type: 'number' },
    ],
  });
  assert.ok(rulesOf(docWith([record])).includes('message_syntax_denied'));
});

test('param_syntax_denied: a plain record carrying parameters or discrete forms is rejected', () => {
  const withParams = validRecord({
    id: 'test.native.phrase',
    parameters: [{ name: 'count', type: 'number' }],
  });
  assert.ok(rulesOf(docWith([withParams])).includes('param_syntax_denied'));
  const withForms = validRecord({ discreteForms: { one: 'адзінае' } });
  assert.ok(rulesOf(docWith([withForms])).includes('param_syntax_denied'));
});

test('param_syntax_denied: join on a non-list and fallback on a non-string are rejected', () => {
  const joined = validRecord({
    id: 'test.native.phrase',
    source: '${count}',
    format: 'template',
    parameters: [{ name: 'count', type: 'number', join: ', ' }],
  });
  assert.ok(rulesOf(docWith([joined])).includes('param_syntax_denied'));
  const fallen = validRecord({
    id: 'test.native.phrase2',
    source: '${heard}',
    format: 'template',
    parameters: [{ name: 'heard', type: 'number', fallback: '—' }],
  });
  assert.ok(rulesOf(docWith([fallen])).includes('param_syntax_denied'));
});

test('executable_payload_denied: script markup and js urls in user-visible strings are rejected', () => {
  const scripted = validRecord({ source: 'Слова <script>alert(1)</script>' });
  assert.ok(rulesOf(docWith([scripted])).includes('executable_payload_denied'));
  const linked = validRecord({ context: 'Кантэкст javascript:alert(1)' });
  assert.ok(rulesOf(docWith([linked])).includes('executable_payload_denied'));
});

test('source_hash_mismatch_denied: a record edited without re-hashing is rejected', () => {
  const record = validRecord();
  record.source = 'Іншае слова';
  assert.ok(rulesOf(docWith([record])).includes('source_hash_mismatch_denied'));
});

test('source_locale_denied: the source locale is locked to be', () => {
  const rules = rulesOf(docWith([validRecord()], { source_locale: 'en' }));
  assert.ok(rules.includes('source_locale_denied'));
});

test('source_schema_version_denied: a foreign envelope version is rejected', () => {
  const rules = rulesOf(docWith([validRecord()], { source_schema_version: 2 }));
  assert.ok(rules.includes('source_schema_version_denied'));
});

test('source_revision_changes: any input change changes the fingerprint', () => {
  const base = validRecord();
  const changed = [
    ['source', 'Іншае слова'],
    ['context', 'Іншы кантэкст тэсту'],
    ['format', 'template'],
  ];
  for (const [field, value] of changed) {
    const record = validRecord();
    record[field] = value;
    assert.notEqual(sourceHash(record), sourceHash(base), `changing ${field} must change the hash`);
  }
  const reparameterized = validRecord({
    id: 'test.native.phrase',
    source: '${count}',
    format: 'template',
    parameters: [{ name: 'count', type: 'number' }],
  });
  const retyped = validRecord({
    id: 'test.native.phrase',
    source: '${count}',
    format: 'template',
    parameters: [{ name: 'count', type: 'string' }],
  });
  assert.notEqual(sourceHash(retyped), sourceHash(reparameterized), 'a parameter type change must change the hash');
  const reordered = validRecord({
    id: 'test.native.phrase',
    source: '${a} ${b}',
    format: 'template',
    parameters: [
      { name: 'b', type: 'string' },
      { name: 'a', type: 'string' },
    ],
  });
  const swapped = validRecord({
    id: 'test.native.phrase',
    source: '${a} ${b}',
    format: 'template',
    parameters: [
      { name: 'a', type: 'string' },
      { name: 'b', type: 'string' },
    ],
  });
  assert.notEqual(sourceHash(reordered), sourceHash(swapped), 'the parameter order is the caller signature');
  const constrained = validRecord({ constraints: { accessibility: 'label' } });
  assert.notEqual(sourceHash(constrained), sourceHash(validRecord()), 'a constraint change must change the hash');
  const discrete = validRecord({ discreteForms: { one: 'адзінае' }, parameters: [{ name: 'n', type: 'number' }] });
  assert.notEqual(sourceHash(discrete), sourceHash(validRecord()), 'discrete forms are fingerprint inputs');
});

test('source_revision_changes: provenance and metadata edits never change the fingerprint', () => {
  const base = validRecord();
  const reanchored = validRecord();
  reanchored.migratedFrom = ['other/catalog.ts#word', 'test/catalog.ts#word'];
  assert.equal(sourceHash(reanchored), sourceHash(base));
});

test('corrupt input answers with diagnostics, never a throw', () => {
  for (const doc of [null, undefined, 7, 'строка', [], {}, { records: [1, null, 'x'] }, { records: [{}] }]) {
    const verdict = checkUiMessages(doc);
    assert.equal(verdict.ok, false);
    for (const error of verdict.errors) {
      assert.equal(typeof error.rule, 'string');
      assert.equal(typeof error.path, 'string');
    }
  }
  // A record with a non-string source/format pair must not crash the checker.
  const verdict = checkUiMessages(docWith([{ id: 'x.y', source: 5, format: 'plain' }]));
  assert.equal(verdict.ok, false);
  // The stored-hash check feeds the record into the fingerprint: a non-array
  // parameters value under a well-formed hash must stay diagnostic, not throw.
  const hashed = docWith([
    { id: 'x.y', source: 'Слова', format: 'plain', parameters: 'nope', sourceHash: '0'.repeat(64) },
  ]);
  const hashedVerdict = checkUiMessages(hashed);
  assert.equal(hashedVerdict.ok, false);
  for (const error of hashedVerdict.errors) {
    assert.equal(typeof error.rule, 'string');
    assert.equal(typeof error.path, 'string');
  }
});
