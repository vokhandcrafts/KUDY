// G19.01 — corpus contracts: pinned version-1 validators (issue #458).
// Local, source-free validation of the research pipeline documents:
// the import manifest, the private run configuration, both model result
// levels and the research Case. Every validator answers { ok, errors }
// and never coerces an invalid value into a valid one (25_content_research
// §3–§9 own the fields and limits; the schemas under schemas/ restate them).
//
// Draft-07 semantics come from contracts/reader.mjs — the single schema
// interpretation source (09 §4); the corpus adds only what a single-document
// schema cannot express: cross-record duplicates, path safety, vocabulary
// membership and quote equality over Unicode code points. Diagnostics carry
// a stable rule name and a document path, never file content — the same
// leak boundary as 25 §6 (ключы і тэкст крыніцы ў агульны журнал не пішуцца).
// No filesystem or model call happens here: the validators work on plain
// documents; referenced files are checked later, at unpack (G19.02).

import { readFileSync } from 'node:fs';

import { validateSchemaFile } from '../../contracts/reader.mjs';

const SCHEMA_NAMES = new Set([
  'corpus-input-v1',
  'article-fragment-v1',
  'model-result-level1-v1',
  'model-result-level2-v1',
  'case-v1',
  'review-decision-v1',
  'run-config-v1',
  'export-private-v1',
  'export-public-status-v1',
]);

// Schema files resolve relative to contracts/ — the reader's own root.
function schemaErrors(name, doc) {
  return validateSchemaFile(`../tools/corpus/schemas/${name}.schema.json`, doc).errors.map((error) => ({
    rule: error.keyword,
    path: error.path,
  }));
}

// 25 §5: слоўнікі тэм, эпох і раёнаў маюць версію; proposed_topics — асобны
// спіс, прызначэнні правяраюцца толькі па прынятых тэмах.
function loadVocabulary() {
  try {
    const doc = JSON.parse(readFileSync(new URL('./vocabularies/gdansk-v1.json', import.meta.url), 'utf8'));
    const ids = (list) => (Array.isArray(list) ? list.map((entry) => entry?.topic_id ?? entry?.epoch_id ?? entry?.district_id) : []);
    return {
      ok: true,
      version: typeof doc.version === 'string' ? doc.version : null,
      topicIds: new Set(ids(doc.topics).filter((id) => typeof id === 'string')),
      districtIds: new Set([...ids(doc.districts).filter((id) => typeof id === 'string')]),
    };
  } catch {
    return { ok: false, version: null, topicIds: new Set(), districtIds: new Set() };
  }
}

const VOCABULARY = loadVocabulary();

// Paths in the manifest are relative to an explicitly passed root (25 §3).
// Absolute, Windows drive and backslash spellings, empty segments and `..`
// escapes are rejected on sight; symlink/junction confinement needs the
// filesystem and belongs to unpack (G19.02), same split as validate-package.
const UNSAFE_SEGMENTS = new Set(['.', '..']);

function isSafeRelativePath(value) {
  return (
    !value.includes('\\') &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:/.test(value) &&
    value.split('/').every((segment) => segment !== '' && !UNSAFE_SEGMENTS.has(segment))
  );
}

// Unicode code points, not UTF-16 units (25 §8): evidence ranges index
// [...text] slices, `end` exclusive, and the quote must equal that slice
// exactly — no re-normalization on check.
function codePointSlice(text, start, end) {
  return Array.from(text).slice(start, end).join('');
}

function codePointLength(text) {
  return Array.from(text).length;
}

export function validateInput(manifest) {
  const errors = schemaErrors('corpus-input-v1', manifest);
  const records = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest.records : null;
  if (Array.isArray(records)) {
    const seenKeys = new Set();
    records.forEach((record, i) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return;
      if (typeof record.source_record_key === 'string') {
        if (seenKeys.has(record.source_record_key)) {
          errors.push({ rule: 'duplicate-source-key', path: `$.records[${i}].source_record_key` });
        }
        seenKeys.add(record.source_record_key);
      }
      if (typeof record.html_path === 'string' && !isSafeRelativePath(record.html_path)) {
        errors.push({ rule: 'path-unsafe', path: `$.records[${i}].html_path` });
      }
      if (!Array.isArray(record.media)) return;
      const seenMedia = new Set();
      record.media.forEach((medium, j) => {
        if (!medium || typeof medium !== 'object' || Array.isArray(medium)) return;
        if (typeof medium.media_key === 'string') {
          if (seenMedia.has(medium.media_key)) {
            errors.push({ rule: 'duplicate-media-key', path: `$.records[${i}].media[${j}].media_key` });
          }
          seenMedia.add(medium.media_key);
        }
        if (typeof medium.local_path === 'string' && !isSafeRelativePath(medium.local_path)) {
          errors.push({ rule: 'path-unsafe', path: `$.records[${i}].media[${j}].local_path` });
        }
      });
    });
  }
  return { ok: errors.length === 0, errors };
}

export function validateRunConfig(config) {
  const errors = schemaErrors('run-config-v1', config);
  if (!VOCABULARY.ok) errors.push({ rule: 'invalid-vocabulary', path: '$' });
  const version = config && typeof config === 'object' ? config.vocabulary_version : undefined;
  if (typeof version === 'string' && version !== VOCABULARY.version) {
    errors.push({ rule: 'unknown-vocabulary-version', path: '$.vocabulary_version' });
  }
  return { ok: errors.length === 0, errors };
}

// Fragments map fragment_id → cleaned text; every reference the result makes
// must name a known fragment (25 §6: праверка існавання фрагмента).
function checkFragmentReference(list, container, i, fragments, errors, { withRange }) {
  const item = list[i];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return;
  const id = item.fragment_id;
  if (typeof id !== 'string') return;
  const at = (field) => `$.${container}[${i}].${field}`;
  const text = fragments[id];
  if (typeof text !== 'string') {
    errors.push({ rule: 'unknown-fragment-id', path: at('fragment_id') });
    return;
  }
  if (!withRange) return;
  const length = codePointLength(text);
  if (!Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start || item.end > length) {
    errors.push({ rule: 'invalid-text-range', path: at('end') });
  }
}

function validateLevel1(result, fragments, errors) {
  if (!VOCABULARY.ok) errors.push({ rule: 'invalid-vocabulary', path: '$' });
  if (typeof result.vocabulary_version === 'string' && result.vocabulary_version !== VOCABULARY.version) {
    errors.push({ rule: 'unknown-vocabulary-version', path: '$.vocabulary_version' });
  }
  const entities = Array.isArray(result.entities) ? result.entities : [];
  const entityIds = new Set(entities.map((entity) => entity?.entity_id).filter((id) => typeof id === 'string'));
  const seenEntities = new Set();
  entities.forEach((entity, i) => {
    const id = entity?.entity_id;
    if (typeof id !== 'string') return;
    if (seenEntities.has(id)) errors.push({ rule: 'duplicate-entity-id', path: `$.entities[${i}].entity_id` });
    seenEntities.add(id);
  });

  const containers = [
    { key: 'mentions', withRange: true },
    { key: 'time_references', withRange: true },
    { key: 'topic_assignments', withRange: false },
    { key: 'hooks', withRange: false },
    { key: 'context_needs', withRange: false },
  ];
  for (const { key, withRange } of containers) {
    const list = result[key];
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i++) {
      checkFragmentReference(list, key, i, fragments, errors, { withRange });
    }
  }

  const mentions = Array.isArray(result.mentions) ? result.mentions : [];
  mentions.forEach((mention, i) => {
    if (typeof mention?.proposed_entity_id === 'string' && !entityIds.has(mention.proposed_entity_id)) {
      errors.push({ rule: 'unknown-entity-id', path: `$.mentions[${i}].proposed_entity_id` });
    }
  });

  const topics = Array.isArray(result.topic_assignments) ? result.topic_assignments : [];
  topics.forEach((assignment, i) => {
    const id = assignment?.topic_id;
    if (typeof id === 'string' && !VOCABULARY.topicIds.has(id)) {
      errors.push({ rule: 'unknown-topic', path: `$.topic_assignments[${i}].topic_id` });
    }
  });

  const times = Array.isArray(result.time_references) ? result.time_references : [];
  times.forEach((time, i) => {
    const from = time?.year_from;
    const to = time?.year_to;
    if (Number.isInteger(from) && Number.isInteger(to) && to < from) {
      errors.push({ rule: 'inverted-year-range', path: `$.time_references[${i}]` });
    }
  });

  const places = Array.isArray(result.place_references) ? result.place_references : [];
  places.forEach((place, i) => {
    const districts = place?.districts;
    if (!Array.isArray(districts)) return;
    districts.forEach((district, j) => {
      if (typeof district !== 'string') return;
      if (district !== 'unknown' && !VOCABULARY.districtIds.has(district)) {
        errors.push({ rule: 'unknown-district', path: `$.place_references[${i}].districts[${j}]` });
      }
    });
  });
}

function validateLevel2(result, fragments, errors) {
  const claims = Array.isArray(result.claims) ? result.claims : [];
  const relations = Array.isArray(result.relations) ? result.relations : [];

  const seenClaims = new Set();
  const claimIds = new Set();
  claims.forEach((claim, i) => {
    const id = claim?.claim_id;
    if (typeof id !== 'string') return;
    if (seenClaims.has(id)) errors.push({ rule: 'duplicate-claim-id', path: `$.claims[${i}].claim_id` });
    seenClaims.add(id);
    claimIds.add(id);
    if (typeof claim.case_id === 'string' && claim.case_id !== result.case_id) {
      errors.push({ rule: 'case-mismatch', path: `$.claims[${i}].case_id` });
    }
    if (typeof claim.run_id === 'string' && claim.run_id !== result.run_id) {
      errors.push({ rule: 'run-mismatch', path: `$.claims[${i}].run_id` });
    }
    if (!Array.isArray(claim.evidence)) return;
    claim.evidence.forEach((evidence, j) => {
      if (!evidence || typeof evidence !== 'object') return;
      const id = evidence.fragment_id;
      if (typeof id !== 'string') return;
      const at = (field) => `$.claims[${i}].evidence[${j}].${field}`;
      const text = fragments[id];
      if (typeof text !== 'string') {
        errors.push({ rule: 'unknown-fragment-id', path: at('fragment_id') });
        return;
      }
      const length = codePointLength(text);
      if (
        !Number.isInteger(evidence.start) ||
        !Number.isInteger(evidence.end) ||
        evidence.start < 0 ||
        evidence.end <= evidence.start ||
        evidence.end > length
      ) {
        errors.push({ rule: 'invalid-text-range', path: at('end') });
        return;
      }
      if (evidence.quote !== codePointSlice(text, evidence.start, evidence.end)) {
        errors.push({ rule: 'quote-mismatch', path: at('quote') });
      }
    });
  });

  const seenRelations = new Set();
  relations.forEach((relation, i) => {
    const id = relation?.relation_id;
    if (typeof id !== 'string') return;
    if (seenRelations.has(id)) errors.push({ rule: 'duplicate-relation-id', path: `$.relations[${i}].relation_id` });
    seenRelations.add(id);
    if (typeof relation.claim_id === 'string' && !claimIds.has(relation.claim_id)) {
      errors.push({ rule: 'unknown-claim-id', path: `$.relations[${i}].claim_id` });
    }
  });
}

export function validateModelResult(level, result, fragments) {
  if (level !== 1 && level !== 2) {
    return { ok: false, errors: [{ rule: 'unknown-level', path: '$' }] };
  }
  const errors = schemaErrors(level === 1 ? 'model-result-level1-v1' : 'model-result-level2-v1', result);
  // A non-object result already carries the schema type diagnostic; the
  // cross-reference rules below must not crash on it.
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { ok: false, errors };
  }
  if (!fragments || typeof fragments !== 'object' || Array.isArray(fragments)) {
    errors.push({ rule: 'invalid-fragments', path: '$' });
    return { ok: false, errors };
  }
  if (level === 1) validateLevel1(result, fragments, errors);
  else validateLevel2(result, fragments, errors);
  return { ok: errors.length === 0, errors };
}

export function validateCase(record) {
  const errors = schemaErrors('case-v1', record);
  const doc = record && typeof record === 'object' && !Array.isArray(record) ? record : null;
  const selected = doc ? doc.selected : null;
  if (Array.isArray(selected)) {
    const seenFragments = new Set();
    selected.forEach((item, i) => {
      const id = item?.fragment_id;
      if (typeof id !== 'string') return;
      if (seenFragments.has(id)) {
        errors.push({ rule: 'duplicate-selected-fragment', path: `$.selected[${i}].fragment_id` });
      }
      seenFragments.add(id);
    });
  }
  const candidates = doc ? doc.candidates : null;
  if (Array.isArray(candidates)) {
    const seenCandidates = new Set();
    candidates.forEach((item, i) => {
      const id = item?.candidate_id;
      if (typeof id !== 'string') return;
      if (seenCandidates.has(id)) {
        errors.push({ rule: 'duplicate-candidate-id', path: `$.candidates[${i}].candidate_id` });
      }
      seenCandidates.add(id);
    });
  }
  if (doc && Number.isInteger(doc.filters?.year_from) && Number.isInteger(doc.filters?.year_to) && doc.filters.year_to < doc.filters.year_from) {
    errors.push({ rule: 'inverted-year-range', path: '$.filters' });
  }
  return { ok: errors.length === 0, errors };
}

// Schema-only pinning for documents whose commands come later (article
// packages G19.02, review decisions G19.07, exports G19.07): the same
// Draft-07 interpretation, { ok, errors } answer, no coercion.
export function validateDocument(schemaName, doc) {
  if (!SCHEMA_NAMES.has(schemaName)) {
    return { ok: false, errors: [{ rule: 'unknown-schema', path: '$' }] };
  }
  const errors = schemaErrors(schemaName, doc);
  return { ok: errors.length === 0, errors };
}
