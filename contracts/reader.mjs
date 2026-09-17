// G02.01 — contracts reader: a small JSON Schema kernel (the draft-07 subset
// used by contracts/schemas/) + named rules from 21 §3.2/§3.3 + catalog reading
// per the G01.06 envelope/legacy decision. Node stdlib only. This is the single
// interpretation source for the schemas, shared by the G02.02 validator, the
// app and the web (09 §4: "Фармат — публічны кантракт").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISCOVERY_INDEX_BYTES = 524288; // 21 §3.2: ≤ 512 KiB, праверка да загрузкі

const cache = new Map();

function loadSchema(absFile) {
  if (!cache.has(absFile)) {
    cache.set(absFile, JSON.parse(fs.readFileSync(absFile, 'utf8')));
  }
  return cache.get(absFile);
}

function resolveRef(root, rootFile, schemaFile, ref) {
  if (ref.startsWith('#/')) {
    let node = root;
    for (const part of ref.slice(2).split('/')) {
      node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    return { schema: node, file: schemaFile };
  }
  const target = path.resolve(path.dirname(schemaFile), ref);
  return { schema: loadSchema(target), file: target, root: loadSchema(target) };
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  return typeof value;
}

function fails(keyword, rule, schemaPath) {
  return { keyword, rule: rule ?? keyword, path: schemaPath ?? rule };
}

// Draft-07 `number` includes integers; typeOf distinguishes them, so a
// `number` constraint must accept both spellings of the same value.
function typeMatches(t, got) {
  if (t === 'integer') return got === 'integer';
  if (t === 'number') return got === 'number' || got === 'integer';
  return got === t;
}

const patternCache = new Map();
function compiledPattern(pattern) {
  if (!patternCache.has(pattern)) patternCache.set(pattern, new RegExp(pattern));
  return patternCache.get(pattern);
}

// RFC 3339 date-time — the only `format` the schemas declare (catalog generated_at).
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function checkSimple(schema, value, errors, rule) {
  const t = schema.type;
  if (t && !typeMatches(t, typeOf(value))) {
    errors.push(fails('type', rule));
    return false;
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(fails('const', rule));
  if (schema.enum && !schema.enum.includes(value)) errors.push(fails('enum', rule));
  if (typeof value === 'string') {
    if (schema.pattern && !compiledPattern(schema.pattern).test(value)) errors.push(fails('pattern', rule));
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(fails('minLength', rule));
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(fails('maxLength', rule));
    if (schema.format === 'date-time' && !DATE_TIME_PATTERN.test(value)) errors.push(fails('format', rule));
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(fails('minimum', rule));
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(fails('maximum', rule));
  }
  return true;
}

// Returns true when the node validates; errors accumulate into `errors`.
function validateNode(schema, value, errors, rule, ctx) {
  if (!schema || typeof schema !== 'object') return true;
  if (schema.$ref) {
    const { schema: target, file, root } = resolveRef(ctx.root, ctx.rootFile, ctx.file, schema.$ref);
    return validateNode(target, value, errors, rule, { root: root ?? ctx.root, rootFile: ctx.rootFile, file });
  }
  let ok = checkSimple(schema, value, errors, rule);
  // Object keywords apply whenever the value IS an object, not only when the
  // schema declares type:"object" — if/then branches such as
  // { then: { required: [...] } } carry required without a type (stop.schema).
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push(fails('required', `${rule}.${req}`));
    }
    const props = schema.properties ?? {};
    for (const [key, child] of Object.entries(props)) {
      if (key in value) validateNode(child, value[key], errors, `${rule}.${key}`, ctx);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) errors.push(fails('additionalProperties', `${rule}.${key}`));
      }
    } else if (typeof schema.additionalProperties === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (!(key in props)) validateNode(schema.additionalProperties, child, errors, `${rule}.${key}`, ctx);
      }
    }
    if (schema.propertyNames) {
      for (const key of Object.keys(value)) validateNode(schema.propertyNames, key, errors, `${rule}.<key>`, ctx);
    }
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) {
      errors.push(fails('maxProperties', rule));
    }
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(fails('minItems', rule));
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(fails('maxItems', rule));
    if (schema.items) {
      value.forEach((item, i) => validateNode(schema.items, item, errors, `${rule}[${i}]`, ctx));
    }
  }
  for (const sub of schema.allOf ?? []) validateNode(sub, value, errors, rule, ctx);
  if (schema.oneOf) {
    const passed = schema.oneOf.filter((branch) => {
      const probe = [];
      return validateNode(branch, value, probe, rule, ctx) && probe.length === 0;
    });
    if (passed.length !== 1) errors.push(fails('oneOf', rule));
  }
  if (schema.if) {
    const probe = [];
    const matched = validateNode(schema.if, value, probe, rule, ctx) && probe.length === 0;
    if (matched && schema.then) validateNode(schema.then, value, errors, rule, ctx);
  }
  return ok && errors.length === 0;
}

export function validateSchemaFile(schemaFile, doc) {
  const abs = path.resolve(HERE, schemaFile);
  const root = loadSchema(abs);
  const errors = [];
  validateNode(root, doc, errors, '$', { root, rootFile: abs, file: abs });
  return { ok: errors.length === 0, errors };
}

function walk(value, visit, keyPath = []) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, visit, [...keyPath, i]));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, visit, [...keyPath, k]);
  } else if (typeof value === 'string') {
    visit(value, keyPath);
  }
}

// Owned identifiers carry the imp.<namespace>.… namespace check in both
// profiles; other strings (credits, notes, URLs) are never namespace-checked.
// story_base_id/story_extended_id are included: an imported route must not
// reference official stories any more than carry official route ids.
// city_id is excluded: it references the shared city taxonomy, not
// import-owned content. Charset and limits — 21 §3.2.
const OWNED_ID_KEYS = new Set(['id', 'route_id', 'story_id', 'story_base_id', 'story_extended_id', 'place_id', 'collection_id', 'offer_id', 'media_id', 'voice_id', 'theme_id']);

// Criterion 4: an import cannot claim official provenance. The official profile
// runs on top of the schema: no origin:"imported" anywhere in the document and
// no identifiers carrying the reserved import prefix (21 §3.1: refs point to
// official KUDY content only).
export function checkOfficialProfile(doc) {
  const errors = [];
  walk(doc, (value, keyPath) => {
    const key = keyPath.at(-1);
    if (key === 'origin' && value === 'imported') {
      errors.push({ rule: 'origin-not-official', path: keyPath.join('.') });
    }
    if (OWNED_ID_KEYS.has(key) && /^imp\.[a-z0-9._-]+/.test(value)) {
      errors.push({ rule: 'import-namespace-in-official', path: keyPath.join('.') });
    }
  });
  return { ok: errors.length === 0, errors };
}

// Imported document (G12, deferred): origin:"imported" is required and owned
// identifiers live in the "imp.<namespace>.…" namespace (G12.03: marked by
// provenance, never masquerading as KUDY).
export function checkImportedProfile(doc) {
  const errors = [];
  let hasOrigin = false;
  walk(doc, (value, keyPath) => {
    const key = keyPath.at(-1);
    if (key === 'origin') {
      hasOrigin = true;
      if (value !== 'imported') errors.push({ rule: 'import-origin-required', path: keyPath.join('.') });
    }
    if (OWNED_ID_KEYS.has(key)) {
      if (!/^imp\.[a-z0-9._-]{1,60}$/.test(value)) {
        errors.push({ rule: 'import-namespace-required', path: keyPath.join('.') });
      }
    }
  });
  if (!hasOrigin) errors.push({ rule: 'import-origin-required', path: '$' });
  return { ok: errors.length === 0, errors };
}

// Named index rules from 21 §3.2 — the cross-record checks a single-document
// schema cannot express. The full validator with diagnostics is G02.02.
export function checkIndexRules(index) {
  const errors = [];
  const seenOffers = new Set();
  const seenRefs = new Set();
  for (const offer of index.offers ?? []) {
    if (seenOffers.has(offer.offer_id)) errors.push({ rule: 'duplicate-offer-id', path: offer.offer_id });
    seenOffers.add(offer.offer_id);
    const refKey = JSON.stringify(offer.ref);
    if (seenRefs.has(refKey)) errors.push({ rule: 'duplicate-ref', path: offer.offer_id });
    seenRefs.add(refKey);
    if (offer.city_id !== index.city_id) errors.push({ rule: 'foreign-city', path: offer.offer_id });
    const d = offer.estimated_duration;
    if (d && d.min_minutes > d.max_minutes) errors.push({ rule: 'estimated_duration_range', path: offer.offer_id });
  }
  const offerByRef = new Map((index.offers ?? []).map((o) => [JSON.stringify(o.ref), o]));
  for (const collection of index.collections ?? []) {
    if (collection.city_id !== index.city_id) errors.push({ rule: 'foreign-city', path: collection.collection_id });
    const seenMembers = new Set();
    for (const member of collection.members ?? []) {
      const key = JSON.stringify(member);
      if (seenMembers.has(key)) errors.push({ rule: 'duplicate-member-ref', path: collection.collection_id });
      seenMembers.add(key);
      if (member.kind === 'collection') errors.push({ rule: 'nested-collection', path: collection.collection_id });
    }
    const guide = collection.members?.find((m) => m.kind === 'guide');
    const place = collection.members?.find((m) => m.kind === 'place');
    if (guide && place) {
      const guideOffer = offerByRef.get(JSON.stringify(guide));
      if (guideOffer?.suggested_start_place_id === place.place_id && !collection.overlap_note) {
        errors.push({ rule: 'missing-overlap-note', path: collection.collection_id });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function checkDiscoveryIndexBytes(bytes) {
  if (bytes > DISCOVERY_INDEX_BYTES) {
    return { ok: false, errors: [{ rule: 'discovery-index-oversized', path: 'discovery_index.bytes' }] };
  }
  return { ok: true, errors: [] };
}

// Catalog reading per 21 §3.3 (G01.06 decision): v1 — full; unknown major —
// the route list still works, discovery is not pulled; a bare array — legacy v0
// read as a catalog without discovery. Run is never blocked.
export function readCatalogDoc(doc) {
  if (Array.isArray(doc)) {
    return { status: 'legacy-v0', routes: doc, discovery_index: null, degraded: 'legacy-v0', ok: true, errors: [] };
  }
  if (!doc || typeof doc !== 'object') {
    return { status: 'invalid', routes: [], discovery_index: null, degraded: null, ok: false, errors: [{ rule: 'catalog-not-an-object', path: '$' }] };
  }
  const version = doc.catalog_schema_version;
  if (version !== 1) {
    return {
      status: 'unknown-major',
      routes: Array.isArray(doc.routes) ? doc.routes : [],
      discovery_index: null,
      degraded: 'catalog-schema-version',
      ok: true,
      errors: [],
    };
  }
  const schema = validateSchemaFile('schemas/catalog.schema.json', doc);
  let errors = [...schema.errors];
  if (doc.discovery_index) {
    const bytes = checkDiscoveryIndexBytes(doc.discovery_index.bytes);
    if (!bytes.ok) errors = [...errors, ...bytes.errors];
  }
  return {
    status: 'v1',
    routes: Array.isArray(doc.routes) ? doc.routes : [],
    discovery_index: doc.discovery_index ?? null,
    degraded: null,
    ok: errors.length === 0,
    errors,
  };
}

export function readCatalogText(text) {
  return readCatalogDoc(JSON.parse(text));
}
