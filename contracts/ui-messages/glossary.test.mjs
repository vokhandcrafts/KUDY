// G21.19 (issue #543) — the reviewed terminology glossary contract tests.
// The shipped glossary passes schema + cross-file rules; every named rule
// ships with an isolating negative fixture; corrupt input answers with
// diagnostics, never a throw. Anchors are checked against the canonical
// source, locators against the shipped translation sets (implementation-rules
// 14). Node stdlib only (contracts-zone-closed).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPLETE_UI_LOCALES } from '../ui-locales.ts';
import { validateSchemaFile } from '../reader.mjs';
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

test('glossary_locale_unshipped: a locale outside the registry never passes silently', () => {
  const doc = shippedGlossary();
  // A typo or a future locale: the key is not in the shipped registry, so no
  // per-locale rule would ever see it — the unshipped rule names it instead.
  // The locator is made key-consistent so the fixture isolates this rule.
  doc.entries[0].locales.xx = JSON.parse(JSON.stringify(doc.entries[0].locales.en));
  doc.entries[0].locales.xx.provenance.locator = 'translations/xx.json#native.nearby.guideLabel';
  assert.deepEqual(rulesOf(doc), ['glossary_locale_unshipped']);
});

test('ref-unresolved: a $ref fragment that walks to nothing is a named diagnostic, not a tacit pass', () => {
  // The reader seam takes absolute paths; a throwaway target file that EXISTS
  // but lacks the cited definition proves the kernel answers ref-unresolved
  // instead of silently accepting anything.
  const fake = mkdtempSync(join(tmpdir(), 'kudy-g2119-ref-'));
  try {
    writeFileSync(join(fake, 'nowhere.schema.json'), JSON.stringify({ type: 'string' }), 'utf8');
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { term: { $ref: 'nowhere.schema.json#/$defs/Missing' } },
    };
    writeFileSync(join(fake, 'broken.schema.json'), JSON.stringify(schema), 'utf8');
    const verdict = validateSchemaFile(join(fake, 'broken.schema.json'), { term: 'whatever' });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.errors.map((error) => error.keyword), ['ref-unresolved']);
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
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
