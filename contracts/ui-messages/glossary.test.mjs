// G21.19 (issue #543) — the reviewed terminology glossary contract tests.
// The shipped glossary passes schema + cross-file rules; every named rule
// ships with an isolating negative fixture; corrupt input answers with
// diagnostics, never a throw. Anchors are checked against the canonical
// source, locators against the shipped translation sets (implementation-rules
// 14). Node stdlib only (contracts-zone-closed).
import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPLETE_UI_LOCALES } from '../ui-locales.ts';
import { loadUiMessagesSource } from './ui-messages.mjs';
import { loadUiMessageTranslations } from './translations.mjs';
import { checkUiMessagesGlossary, GlossaryContractError, loadUiMessagesGlossary } from './glossary.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const allowedLocales = [...COMPLETE_UI_LOCALES];

const sourceDoc = loadUiMessagesSource();
const translationRecords = {};
for (const locale of allowedLocales) {
  if (locale === sourceDoc.source_locale) continue;
  const set = loadUiMessageTranslations(join(here, 'translations', `${locale}.json`), sourceDoc, allowedLocales);
  translationRecords[locale] = new Set(set.records.map((record) => record.id));
}
const context = { sourceDoc, allowedLocales, translationRecords };

function shippedGlossary() {
  return JSON.parse(JSON.stringify(loadUiMessagesGlossary(join(here, 'glossary.json'), context)));
}

function rulesOf(doc) {
  return checkUiMessagesGlossary(doc, context).errors.map((error) => error.rule);
}

test('the shipped glossary passes schema and cross-file rules', () => {
  const doc = loadUiMessagesGlossary(join(here, 'glossary.json'), context);
  assert.equal(doc.glossary_schema_version, 1);
  assert.equal(checkUiMessagesGlossary(doc, context).ok, true);
});

test('the seven translator-facing terms of issue criterion 1 are present and covered', () => {
  const doc = loadUiMessagesGlossary(join(here, 'glossary.json'), context);
  const terms = new Set(doc.entries.map((entry) => entry.term));
  for (const term of ['guide', 'stop', 'walk', 'download', 'unavailable', 'purchase', 'restore']) {
    assert.ok(terms.has(term), `${term}: entry missing`);
    const entry = doc.entries.find((candidate) => candidate.term === term);
    for (const locale of allowedLocales.filter((code) => code !== doc.source_locale)) {
      assert.ok(entry.locales[locale]?.term, `${term}[${locale}]: reviewed term missing`);
      assert.equal(entry.locales[locale].provenance.status, 'resolved', `${term}[${locale}]: unresolved in the shipped glossary`);
    }
  }
});

test('glossary_anchor_unknown: an entry anchored outside the canonical source is rejected', () => {
  const doc = shippedGlossary();
  doc.entries[0].recordIds.push('native.chrome.notARecord');
  assert.deepEqual(rulesOf(doc), ['glossary_anchor_unknown']);
});

test('glossary_locale_missing: a shipped locale without a reviewed term is rejected', () => {
  const doc = shippedGlossary();
  delete doc.entries[0].locales.uk;
  assert.deepEqual(rulesOf(doc), ['glossary_locale_missing']);
});

test('glossary_locator_mismatch: the locator path must name the entry locale', () => {
  const doc = shippedGlossary();
  doc.entries[0].locales.uk.provenance.locator = 'translations/en.json#native.nearby.guideLabel';
  assert.deepEqual(rulesOf(doc), ['glossary_locator_mismatch']);
});

test('glossary_locator_unresolved: a locator record missing from the shipped set is rejected', () => {
  const doc = shippedGlossary();
  // guideHint records exist for en but are absent from the shipped uk set
  // (the documented be-fallback) — citing one for uk must fail.
  doc.entries[0].locales.uk.provenance.locator = 'translations/uk.json#native.guideHint.openHint';
  assert.deepEqual(rulesOf(doc), ['glossary_locator_unresolved']);
});

test('duplicate_term_denied: two entries for one term are rejected', () => {
  const doc = shippedGlossary();
  doc.entries.push(JSON.parse(JSON.stringify(doc.entries[0])));
  assert.deepEqual(rulesOf(doc), ['duplicate_term_denied']);
});

test('glossary_schema_version_denied: a foreign envelope version is rejected', () => {
  const doc = shippedGlossary();
  doc.glossary_schema_version = 2;
  assert.deepEqual(rulesOf(doc), ['glossary_schema_version_denied']);
});

test('terminology trace violations surface through the shared $defs shape', () => {
  const doc = shippedGlossary();
  delete doc.entries[0].locales.uk.provenance.term;
  assert.deepEqual(rulesOf(doc), ['terminology_trace_required']);
  const doc2 = shippedGlossary();
  doc2.entries[0].locales.en.provenance.date = '10/05/2026';
  assert.deepEqual(rulesOf(doc2), ['field_pattern']);
});

test('unknown fields and corrupt input answer with diagnostics, never a throw', () => {
  const doc = shippedGlossary();
  doc.entries[0].confidence = 0.9;
  assert.deepEqual(rulesOf(doc), ['unknown_field_denied']);
  for (const bad of [null, 5, 'text', [], { entries: [null] }, { entries: ['text'] }]) {
    const verdict = checkUiMessagesGlossary(bad, context);
    assert.equal(verdict.ok, false);
    assert.ok(Array.isArray(verdict.errors) && verdict.errors.length > 0, JSON.stringify(bad));
  }
});

test('loadUiMessagesGlossary fails closed with a named error on a broken file', () => {
  assert.throws(() => loadUiMessagesGlossary(join(here, 'glossary-nowhere.json'), context), (error) => {
    assert.ok(error instanceof GlossaryContractError);
    assert.match(error.message, /unreadable/);
    return true;
  });
});
