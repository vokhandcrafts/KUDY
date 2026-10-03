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
// negative fixtures assert on.
const NAMED_BY_KEYWORD = {
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
const PLACEHOLDER = /\$\{([^{}]*)\}/g;
const PLACEHOLDER_NAME = /^[a-zA-Z0-9_]+$/;

// Executable-payload denylist for the user-visible strings (source, context,
// discrete forms, parameter fallbacks/joins). These records are data, never code;
// a string carrying markup or a call cannot be a UI word.
const EXECUTABLE_PATTERNS = [
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
  input.parameters = (record.parameters ?? []).map((parameter) => {
    const canonical = { name: parameter.name, type: parameter.type };
    if (parameter.fallback !== undefined) {
      return { fallback: parameter.fallback, name: parameter.name, type: parameter.type };
    }
    if (parameter.join !== undefined) {
      return { join: parameter.join, name: parameter.name, type: parameter.type };
    }
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
function checkMessageSyntax(record, errors) {
  const path = `$.records[id=${record.id}]`;
  const parameters = Array.isArray(record.parameters) ? record.parameters : [];
  const parameterNames = new Set(parameters.map((parameter) => parameter?.name).filter((name) => typeof name === 'string'));
  const used = new Set();
  const scan = (text, where) => {
    if (typeof text !== 'string') return;
    for (const match of text.matchAll(PLACEHOLDER)) {
      const name = match[1];
      if (!PLACEHOLDER_NAME.test(name)) {
        errors.push({ rule: 'message_syntax_denied', path: `${path}.${where}` });
        continue;
      }
      if (!parameterNames.has(name)) {
        errors.push({ rule: 'message_syntax_denied', path: `${path}.${where}` });
        continue;
      }
      used.add(name);
    }
  };
  if (record.format === 'plain') {
    if (parameters.length > 0 || record.discreteForms !== undefined || record.composed === true) {
      errors.push({ rule: 'param_syntax_denied', path });
    }
    scan(record.source, 'source');
    for (const [key, form] of Object.entries(record.discreteForms ?? {})) scan(form, `discreteForms.${key}`);
  } else {
    if (parameters.length === 0) {
      errors.push({ rule: 'message_syntax_denied', path });
    }
    scan(record.source, 'source');
    for (const [key, form] of Object.entries(record.discreteForms ?? {})) scan(form, `discreteForms.${key}`);
    for (const name of parameterNames) {
      if (!used.has(name)) errors.push({ rule: 'message_syntax_denied', path: `${path}.parameters.${name}` });
    }
  }
  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== 'object') continue;
    if (parameter.join !== undefined && parameter.type !== 'list') {
      errors.push({ rule: 'param_syntax_denied', path: `${path}.parameters.${parameter.name}` });
    }
    if (parameter.fallback !== undefined && parameter.type !== 'string') {
      errors.push({ rule: 'param_syntax_denied', path: `${path}.parameters.${parameter.name}` });
    }
  }
}

export function checkUiMessages(doc) {
  const errors = [];
  for (const e of validateSchemaFile(SCHEMA_FILE, doc).errors) {
    errors.push({ rule: NAMED_BY_KEYWORD[e.keyword] ?? e.keyword, path: e.path });
  }
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    if (doc.source_locale !== undefined && doc.source_locale !== 'be') {
      errors.push({ rule: 'source_locale_denied', path: '$.source_locale' });
    }
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
      }
      if (typeof record.context !== 'string' || record.context.trim() === '') {
        errors.push({ rule: 'context_required', path: `${path}.context` });
      }
      for (const [index, value] of recordStrings(record).entries()) {
        for (const pattern of EXECUTABLE_PATTERNS) {
          if (pattern.test(value)) {
            errors.push({ rule: 'executable_payload_denied', path: `${path}.strings[${index}]` });
            break;
          }
        }
      }
      if (typeof record.format === 'string' && typeof record.id === 'string') {
        checkMessageSyntax(record, errors);
      }
      if (typeof record.sourceHash === 'string' && record.sourceHash.match(/^[0-9a-f]{64}$/)) {
        if (sourceHash(record) !== record.sourceHash) {
          errors.push({ rule: 'source_hash_mismatch_denied', path: `${path}.sourceHash` });
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// The canonical source document next to this module; the argument is the tests' seam
// (a fixture path), tooling reads the shipped contract file. A source document that
// fails its own contract is a build-time defect, not a runtime fallback: a named
// error, never a silent pass-through (the remote-config loader idiom).
export function loadUiMessagesSource(path) {
  const file = path ?? join(dirname(fileURLToPath(import.meta.url)), SOURCE_FILE);
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new UiMessagesContractError(`the canonical ui-messages source file is unreadable: ${file}`, error);
  }
  const verdict = checkUiMessages(doc);
  if (!verdict.ok) {
    const reasons = verdict.errors.map((entry) => `${entry.rule} at ${entry.path}`).join('; ');
    throw new UiMessagesContractError(`the canonical ui-messages source file failed its contract: ${reasons}`);
  }
  return doc;
}

export class UiMessagesContractError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'UiMessagesContractError';
  }
}
