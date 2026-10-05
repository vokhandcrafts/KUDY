// G21.19 (issue #543, criterion 1) — the reviewed terminology glossary
// contract (contracts/ui-messages/glossary.json) and its checker. One entry
// per translator-facing term: a short sense summary, anchors to the canonical
// source records (never a copy of their text/context) and the approved term
// for every shipped locale with its G21.27-shaped provenance. The
// terminology trace shape is defined once in the translations schema and
// $ref'd from the glossary schema — no restatement (implementation-rules 2).
//
// Cross-file rules a single-document schema cannot express are appended by
// hand, mirroring the translations checker idiom: schema keywords map to
// named diagnostics, corrupt input answers with diagnostics — never a throw.
// Node stdlib only (contracts-zone-closed).
import { validateSchemaFile } from '../reader.mjs';
import { loadContractJson } from './ui-messages.mjs';
import { terminologyTraceErrors } from './translations.mjs';

const SCHEMA_FILE = 'schemas/ui-messages-glossary.schema.json';

const KEYWORD_NAMES = {
  additionalProperties: 'unknown_field_denied',
  const: 'glossary_schema_version_denied',
  enum: 'enum_denied',
  required: 'field_required',
  type: 'field_type',
  pattern: 'field_pattern',
  minLength: 'field_length',
  minItems: 'field_length',
  minProperties: 'field_length',
};

// `locator` pins the reviewed record the term was taken from:
// translations/<locale>.json#<recordId> — the locale in the path must be the
// entry's locale key and the record must exist in that locale's shipped set.
function locatorTarget(locator) {
  if (typeof locator !== 'string') return null;
  const match = locator.match(/^translations\/([a-z]{2})\.json#(.+)$/);
  return match ? { locale: match[1], recordId: match[2] } : null;
}

export function checkUiMessagesGlossary(doc, { sourceDoc, allowedLocales, translationRecords }) {
  const errors = [];
  for (const e of validateSchemaFile(SCHEMA_FILE, doc).errors) {
    errors.push({ rule: KEYWORD_NAMES[e.keyword] ?? e.keyword, path: e.path });
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: errors.length === 0, errors };
  const sourceLocale = typeof doc.source_locale === 'string' ? doc.source_locale : undefined;
  const sourceIds = new Set(
    (sourceDoc && Array.isArray(sourceDoc.records) ? sourceDoc.records : [])
      .filter((record) => record && typeof record === 'object' && typeof record.id === 'string')
      .map((record) => record.id),
  );
  const shippedLocales = (Array.isArray(allowedLocales) ? allowedLocales : []).filter((code) => code !== sourceLocale);
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  const seenTerms = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const path = `$.entries[term=${typeof entry.term === 'string' ? entry.term : '?'}]`;
    if (typeof entry.term === 'string') {
      if (seenTerms.has(entry.term)) {
        errors.push({ rule: 'duplicate_term_denied', path: `${path}.term` });
      }
      seenTerms.add(entry.term);
    }
    for (const recordId of Array.isArray(entry.recordIds) ? entry.recordIds : []) {
      if (typeof recordId === 'string' && !sourceIds.has(recordId)) {
        errors.push({ rule: 'glossary_anchor_unknown', path: `${path}.recordIds[${recordId}]` });
      }
    }
    const locales = entry.locales && typeof entry.locales === 'object' && !Array.isArray(entry.locales) ? entry.locales : {};
    for (const locale of shippedLocales) {
      if (!(locale in locales)) {
        errors.push({ rule: 'glossary_locale_missing', path: `${path}.locales.${locale}` });
      }
    }
    for (const [locale, entryLocale] of Object.entries(locales)) {
      if (!entryLocale || typeof entryLocale !== 'object' || Array.isArray(entryLocale)) continue;
      // The provenance must satisfy the shared terminology trace rule (same
      // per-kind completeness as translation records) before its locator is
      // resolved against the shipped set.
      errors.push(...terminologyTraceErrors(entryLocale.provenance, `${path}.locales.${locale}.provenance`));
      const target = locatorTarget(entryLocale.provenance?.locator);
      if (!target || target.locale !== locale) {
        errors.push({ rule: 'glossary_locator_mismatch', path: `${path}.locales.${locale}.provenance.locator` });
        continue;
      }
      const shippedIds = translationRecords?.[locale];
      if (shippedIds instanceof Set && !shippedIds.has(target.recordId)) {
        errors.push({ rule: 'glossary_locator_unresolved', path: `${path}.locales.${locale}.provenance.locator` });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// The glossary next to this module; the argument is the tests' seam (fixture
// path), tooling reads the shipped contract file. The fail-closed shape is
// the shared loadContractJson loader (ui-messages.mjs).
export function loadUiMessagesGlossary(path, context) {
  return loadContractJson(path, (doc) => checkUiMessagesGlossary(doc, context), GlossaryContractError, 'ui-messages glossary');
}

export class GlossaryContractError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'GlossaryContractError';
  }
}
