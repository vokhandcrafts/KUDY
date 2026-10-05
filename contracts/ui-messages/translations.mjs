// G21.25 (issue #558, criterion 1) — the per-locale translation-set contract
// (contracts/ui-messages/translations/<locale>.json) and its checker. One
// record per translated canonical message: the locale's message value/forms,
// the reviewedSourceHash pinning exactly the reviewed source-record version,
// and the review outcome. The base text and its context stay in
// source.json alone; a translation record never restates them.
//
// The cross-record rules a single-document schema cannot express are appended
// by hand, mirroring the source checker idiom (ui-messages.mjs): schema
// keywords map to named diagnostics (NAMED_BY_KEYWORD), corrupt input answers
// with diagnostics — never a throw — and a shipped file failing its own
// contract is a named error, not a silent pass-through. Node stdlib only
// (contracts-zone-closed).
import { validateSchemaFile } from '../reader.mjs';
import { EXECUTABLE_PATTERNS, loadContractJson, NAMED_BY_KEYWORD, PLACEHOLDER, sourceHash } from './ui-messages.mjs';

const SCHEMA_FILE = 'schemas/ui-messages-translations.schema.json';

// The keyword mapping is the source checker's; only the envelope's version
// constant carries a translations-specific diagnostic name.
const KEYWORD_NAMES = { ...NAMED_BY_KEYWORD, const: 'translation_schema_version_denied' };

// The record-level hand rules. `sourceDoc` is the loaded canonical source: a
// translation record exists only for a known source id, pins that record's
// CURRENT hash (a changed source makes the translation stale — a re-review
// with a new reviewedSourceHash is the only way back), and its placeholders
// and form keys must agree with the source record's parameters and
// discreteForms. `allowedLocales` is the UI-locale registry's codes, injected
// by the caller so this module stays decoupled from the TS registry.
export function checkUiMessageTranslations(doc, sourceDoc, allowedLocales) {
  const errors = [];
  for (const e of validateSchemaFile(SCHEMA_FILE, doc).errors) {
    errors.push({ rule: KEYWORD_NAMES[e.keyword] ?? e.keyword, path: e.path });
  }
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    if (typeof doc.locale === 'string') {
      if (Array.isArray(allowedLocales) && !allowedLocales.includes(doc.locale)) {
        errors.push({ rule: 'locale_denied', path: '$.locale' });
      }
      const sourceLocale = sourceDoc && typeof sourceDoc === 'object' ? sourceDoc.source_locale : undefined;
      if (doc.locale === sourceLocale) {
        errors.push({ rule: 'source_locale_denied', path: '$.locale' });
      }
    }
    const sourceRecords = new Map(
      (sourceDoc && Array.isArray(sourceDoc.records) ? sourceDoc.records : [])
        .filter((record) => record && typeof record === 'object' && typeof record.id === 'string')
        .map((record) => [record.id, record]),
    );
    const records = Array.isArray(doc.records) ? doc.records : [];
    const seen = new Set();
    for (const record of records) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
      const path = `$.records[id=${record.id}]`;
      if (typeof record.id === 'string') {
        if (seen.has(record.id)) {
          errors.push({ rule: 'duplicate_key_denied', path: `${path}.id` });
        }
        seen.add(record.id);
        const source = sourceRecords.get(record.id);
        if (!source) {
          errors.push({ rule: 'unknown_id_denied', path: `${path}.id` });
        } else {
          if (
            typeof record.reviewedSourceHash === 'string' &&
            record.reviewedSourceHash.match(/^[0-9a-f]{64}$/) &&
            record.reviewedSourceHash !== source.sourceHash
          ) {
            errors.push({ rule: 'stale_translation_denied', path: `${path}.reviewedSourceHash` });
          }
          const sourceFormKeys = source.discreteForms && typeof source.discreteForms === 'object'
            ? Object.keys(source.discreteForms).sort()
            : null;
          const gotFormKeys = record.forms && typeof record.forms === 'object' && !Array.isArray(record.forms)
            ? Object.keys(record.forms).sort()
            : null;
          if (JSON.stringify(sourceFormKeys) !== JSON.stringify(gotFormKeys)) {
            errors.push({ rule: 'form_set_mismatch_denied', path: `${path}.forms` });
          }
          const sourceParams = (Array.isArray(source.parameters) ? source.parameters : [])
            .map((parameter) => parameter?.name)
            .filter((name) => typeof name === 'string')
            .sort();
          const texts = [record.value, ...Object.values(record.forms ?? {})].filter((value) => typeof value === 'string');
          const used = [...new Set(texts.flatMap((text) => [...text.matchAll(PLACEHOLDER)].map((match) => match[1])))].sort();
          if (JSON.stringify(sourceParams) !== JSON.stringify(used)) {
            errors.push({ rule: 'param_mismatch_denied', path });
          }
        }
      }
      for (const [index, value] of [record.value, ...Object.values(record.forms ?? {})].entries()) {
        if (typeof value !== 'string') continue;
        if (value.trim() === '') {
          errors.push({ rule: 'value_blank_denied', path: `${path}.strings[${index}]` });
        }
        for (const pattern of EXECUTABLE_PATTERNS) {
          if (pattern.test(value)) {
            errors.push({ rule: 'executable_payload_denied', path: `${path}.strings[${index}]` });
            break;
          }
        }
      }
      // G21.27 (issue #566) — terminology provenance: the trace a translator
      // records when uncertain; the per-kind completeness rule is shared with
      // the glossary checker (terminologyTraceErrors below).
      errors.push(...terminologyTraceErrors(record.terminology, `${path}.terminology`));
    }
  }
  return { ok: errors.length === 0, errors };
}

// The per-kind completeness of a RESOLVED terminology trace — a cross-field
// rule a single-document schema cannot express: a looked-up resolution names
// its source, entry locator, chosen term and lookup date; citing existing
// reviewed terminology names locator and term; a reviewer judgment still
// names the term. An unresolved record stays contract-legal (honest
// uncertainty is never rejected here) — publication stops at the gate's
// terminology_unresolved. The schema holds the shape (enums, date pattern,
// non-empty strings). Shared by the translation-set and glossary checkers.
export function terminologyTraceErrors(terminology, path) {
  const errors = [];
  if (terminology && typeof terminology === 'object' && !Array.isArray(terminology) && terminology.status === 'resolved') {
    const required =
      terminology.kind === 'looked-up'
        ? ['source', 'locator', 'term', 'date']
        : terminology.kind === 'reviewed-terminology'
          ? ['locator', 'term']
          : terminology.kind === 'reviewer-judgment'
            ? ['term']
            : null;
    for (const field of required ?? []) {
      if (!(typeof terminology[field] === 'string' && terminology[field].trim() !== '')) {
        errors.push({ rule: 'terminology_trace_required', path: `${path}.${field}` });
      }
    }
  }
  return errors;
}

// The translation set for one locale next to this module; the argument is the
// tests' seam (a fixture path), tooling reads the shipped contract file. The
// fail-closed shape is the shared loadContractJson loader (ui-messages.mjs).
export function loadUiMessageTranslations(path, sourceDoc, allowedLocales) {
  return loadContractJson(
    path,
    (doc) => checkUiMessageTranslations(doc, sourceDoc, allowedLocales),
    TranslationsContractError,
    'ui-messages translation',
  );
}

export class TranslationsContractError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'TranslationsContractError';
  }
}

// Re-exported for the generator and tests: a translation record's staleness is
// measured against exactly this fingerprint.
export { sourceHash };
