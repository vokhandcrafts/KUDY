// G21.24 — the canonical UI-message source record (contracts/ui-messages/source.json)
// and its checker. One authoritative record per UI message: stable id, the Belarusian
// base text (the authoring locale — 09 §8), screen/action context, typed parameters,
// applicable constraints and the message format. Locale translations and review
// metadata live elsewhere (the per-locale sets and their review records — G21.25,
// G21.26); this file owns only the source records and their fingerprint.
//
// The fingerprint (sourceHash) covers exactly the record inputs that change when the
// message changes: id, source, context, parameters (names, types, join, fallback,
// order), constraints, format, composed and discreteForms. It excludes the stored
// hash itself and migratedFrom (provenance, not meaning) — a provenance edit never
// invalidates a reviewed translation. Canonical serialization: UTF-8 JSON, object
// keys lexicographic (explicit insertion order below), array order preserved (the
// parameter order is the caller's signature), no insignificant whitespace.
//
// Rules follow the guide-hints / remote-config checker idiom: schema keywords map to
// named diagnostics (NAMED_BY_KEYWORD), the cross-record and string-contract rules
// that a single-document schema cannot express are appended by hand, corrupt input
// passes through as diagnostics — never a throw — and the shipped canonical file
// failing its own contract is a named error, not a silent pass-through. Node stdlib
// only (contracts-zone-closed).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSchemaFile } from '../reader.mjs';

const SCHEMA_FILE = 'schemas/ui-messages-source.schema.json';
const SOURCE_FILE = 'source.json';

// Schema keywords carry no domain names; each maps to the named diagnostic the
// negative fixtures assert on. Exported for the sibling contract checkers (the
// translations checker reuses the keyword mapping and overrides only `const`).
export const NAMED_BY_KEYWORD = {
  additionalProperties: 'unknown_field_denied',
  const: 'source_schema_version_denied',
  enum: 'enum_denied',
  required: 'field_required',
  type: 'field_type',
  pattern: 'field_pattern',
  minLength: 'field_length',
  maxLength: 'field_length',
  minItems: 'field_length',
  maxItems: 'field_length',
  minProperties: 'field_length',
  propertyNames: 'field_pattern',
  maximum: 'field_length',
  minimum: 'field_length',
};

// The placeholder contract: ${name} with a declared parameter name inside. Anything
// else inside the braces (empty, dotted, callable) is invalid message syntax.
// Exported for the sibling contract checkers; scan with matchAll (a /g regex's
// lastIndex must not leak between uses).
export const PLACEHOLDER = /\$\{([^{}]*)\}/g;
export const PLACEHOLDER_NAME = /^[a-zA-Z0-9_]+$/;

// Executable-payload denylist for the user-visible strings (source, context,
// discrete forms, parameter fallbacks/joins). These records are data, never code;
// a string carrying markup or a call cannot be a UI word. Exported for the
// sibling contract checkers.
export const EXECUTABLE_PATTERNS = [
  /<script\b/i,
  /javascript:/i,
  /\beval\s*\(/,
  /\bimport\s*\(/,
  /\bon[a-z]+\s*=/i,
];

// The fingerprint input: every field that changes when the message changes, built
// with explicit lexicographic key order so the serialization is deterministic
// regardless of the record's own key order. Arrays keep their order.
function fingerprintInput(record) {
  const input = {};
  if (record.composed !== undefined) input.composed = record.composed;
  if (record.constraints !== undefined) {
    input.constraints = {};
    if (record.constraints.accessibility !== undefined) input.constraints.accessibility = record.constraints.accessibility;
    if (record.constraints.maxLength !== undefined) input.constraints.maxLength = record.constraints.maxLength;
  }
  input.context = record.context;
  if (record.discreteForms !== undefined) {
    input.discreteForms = {};
    for (const key of Object.keys(record.discreteForms).sort()) {
      input.discreteForms[key] = record.discreteForms[key];
    }
  }
  input.format = record.format;
  input.id = record.id;
  // Corrupt parameters must not crash the hash path the stored-hash check feeds:
  // a non-array answers as an empty list here and the schema/type diagnostics
  // name the violation elsewhere (recordStrings, checkMessageSyntax).
  const parameters = Array.isArray(record.parameters) ? record.parameters : [];
  input.parameters = parameters.map((parameter) => {
    const canonical = {};
    if (parameter?.fallback !== undefined) canonical.fallback = parameter.fallback;
    if (parameter?.join !== undefined) canonical.join = parameter.join;
    canonical.name = parameter?.name;
    canonical.type = parameter?.type;
    return canonical;
  });
  input.source = record.source;
  return JSON.stringify(input);
}

// The deterministic fingerprint of a source record: sha256 over the canonical
// serialization of its inputs. Exported for the tests, the migration tooling and
// the later per-locale review records (a translation pins the hash it reviewed).
export function sourceHash(record) {
  return createHash('sha256').update(fingerprintInput(record), 'utf8').digest('hex');
}

function recordStrings(record) {
  const strings = [record.source, record.context];
  const parameters = Array.isArray(record.parameters) ? record.parameters : [];
  for (const parameter of parameters) {
    if (parameter && typeof parameter === 'object') strings.push(parameter.fallback, parameter.join);
  }
  if (record.discreteForms && typeof record.discreteForms === 'object') {
    for (const form of Object.values(record.discreteForms)) strings.push(form);
  }
  return strings.filter((value) => typeof value === 'string');
}

// The message/parameter contract, cross-field by nature: the format agrees with the
// placeholders, every placeholder names a declared parameter, every declared
// parameter is reachable, and the parameter attributes fit their types.
function checkMessageSyntax(record, onError) {
  const path = `$.records[id=${record.id}]`;
  const parameters = Array.isArray(record.parameters) ? record.parameters : [];
  const parameterNames = new Set(parameters.map((parameter) => parameter?.name).filter((name) => typeof name === 'string'));
  const used = new Set();
  const scan = (text, where) => {
    if (typeof text !== 'string') return;
    for (const match of text.matchAll(PLACEHOLDER)) {
      const name = match[1];
      if (!PLACEHOLDER_NAME.test(name)) {
        onError('message_syntax_denied', `${path}.${where}`);
        continue;
      }
      if (!parameterNames.has(name)) {
        onError('message_syntax_denied', `${path}.${where}`);
        continue;
      }
      used.add(name);
    }
  };
  if (record.format === 'plain') {
    if (parameters.length > 0 || record.discreteForms !== undefined || record.composed === true) {
      onError('param_syntax_denied', path);
    }
    scan(record.source, 'source');
    for (const [key, form] of Object.entries(record.discreteForms ?? {})) scan(form, `discreteForms.${key}`);
  } else {
    if (parameters.length === 0) {
      onError('message_syntax_denied', path);
    }
    scan(record.source, 'source');
    for (const [key, form] of Object.entries(record.discreteForms ?? {})) scan(form, `discreteForms.${key}`);
    for (const name of parameterNames) {
      if (!used.has(name)) onError('message_syntax_denied', `${path}.parameters.${name}`);
    }
  }
  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== 'object') continue;
    if (parameter.join !== undefined && parameter.type !== 'list') {
      onError('param_syntax_denied', `${path}.parameters.${parameter.name}`);
    }
    if (parameter.fallback !== undefined && parameter.type !== 'string') {
      onError('param_syntax_denied', `${path}.parameters.${parameter.name}`);
    }
  }
}

// The shared record-walk of the ui-messages contract checkers: normalize the
// records array, skip corrupt entries (their diagnostics come from the schema
// layer), name duplicate ids, and hand every valid record to the checker's
// own visit with its diagnostic path.
export function walkRecords(doc, onError, visit) {
  const records = Array.isArray(doc.records) ? doc.records : [];
  const seen = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const path = `$.records[id=${record.id}]`;
    if (typeof record.id === 'string') {
      if (seen.has(record.id)) {
        onError('duplicate_key_denied', `${path}.id`);
      }
      seen.add(record.id);
    }
    visit(record, path);
  }
}

export function checkUiMessages(doc) {
  const errors = [];
  const onError = (rule, path) => errors.push({ rule, path });
  for (const e of validateSchemaFile(SCHEMA_FILE, doc).errors) {
    onError(NAMED_BY_KEYWORD[e.keyword] ?? e.keyword, e.path);
  }
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    if (doc.source_locale !== undefined && doc.source_locale !== 'be') {
      onError('source_locale_denied', '$.source_locale');
    }
    walkRecords(doc, onError, (record, path) => {
      if (typeof record.context !== 'string' || record.context.trim() === '') {
        onError('context_required', `${path}.context`);
      }
      for (const [index, value] of recordStrings(record).entries()) {
        for (const pattern of EXECUTABLE_PATTERNS) {
          if (pattern.test(value)) {
            onError('executable_payload_denied', `${path}.strings[${index}]`);
            break;
          }
        }
      }
      if (typeof record.format === 'string' && typeof record.id === 'string') {
        checkMessageSyntax(record, onError);
      }
      if (typeof record.sourceHash === 'string' && record.sourceHash.match(/^[0-9a-f]{64}$/)) {
        if (sourceHash(record) !== record.sourceHash) {
          onError('source_hash_mismatch_denied', `${path}.sourceHash`);
        }
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

// The shared fail-closed loader shape of the ui-messages contract files: an
// unreadable file and a file failing its contract are build-time defects — a
// named error, never a silent pass-through (the remote-config loader idiom).
// The sibling translation loader reuses this exact shape.
export function loadContractJson(file, check, ErrorClass, label) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ErrorClass(`the ${label} file is unreadable: ${file}`, error);
  }
  const verdict = check(doc);
  if (!verdict.ok) {
    const reasons = verdict.errors.map((entry) => `${entry.rule} at ${entry.path}`).join('; ');
    throw new ErrorClass(`the ${label} file failed its contract: ${reasons}`);
  }
  return doc;
}

// The canonical source document next to this module; the argument is the tests' seam
// (a fixture path), tooling reads the shipped contract file.
export function loadUiMessagesSource(path) {
  const file = path ?? join(dirname(fileURLToPath(import.meta.url)), SOURCE_FILE);
  return loadContractJson(file, checkUiMessages, UiMessagesContractError, 'canonical ui-messages source');
}

export class UiMessagesContractError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'UiMessagesContractError';
  }
}
