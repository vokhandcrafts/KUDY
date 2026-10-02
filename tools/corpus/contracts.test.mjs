// G19.01 — behavioral checks for the corpus contracts (issue #458).
// The named checks below mirror the brief's Checks list: invalid_null_manifest,
// duplicate_source_key, invalid_rights, hook_limit, quote_unicode_offsets,
// unknown_fragment_id. Schema-only pins (article packages, review decisions,
// exports) run through validateDocument; the vocabulary shape is checked
// against 25 §5 verbatim. Reverting any validator rule must fail the matching
// named check (implementation-rules 1).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateCase, validateDocument, validateInput, validateModelResult, validateRunConfig } from './contracts.mjs';

const sha = (seed) => seed.padStart(64, '0');
const F1 = sha('aa');
const F2 = sha('b2');

const TEXT_F1 = 'Ян Прыкладны нарадзіўся ў 1688 годзе ў Прыкладава.';
const TEXT_F2 = 'Камяніца A🏰B стаіць з 1343 года — з цэглы.';

// [start, end) of needle inside text, counted in Unicode code points —
// the same arithmetic the validators must apply (25 §8).
function spanOf(text, needle) {
  const cps = Array.from(text);
  const target = Array.from(needle);
  for (let i = 0; i + target.length <= cps.length; i++) {
    if (target.every((ch, j) => cps[i + j] === ch)) return [i, i + target.length];
  }
  throw new Error(`needle not found: ${needle}`);
}

function quoteOf(text, [start, end]) {
  return Array.from(text).slice(start, end).join('');
}

function validManifest() {
  return {
    source_namespace: 'fixture-wiki',
    records: [
      {
        source_record_key: 'example-0001',
        html_path: 'pages/example-0001.html',
        language: 'be',
        rights: 'public-domain',
        city_id: 'gdansk',
      },
      {
        source_record_key: 'example-0002',
        html_path: 'pages/example-0002.html',
        language: 'be',
        rights: 'research_only',
        media: [{ media_key: 'example-0002-01', local_path: 'images/example-0002-01.png', rights: 'cc0' }],
      },
    ],
  };
}

function validRunConfig() {
  return {
    level: 1,
    mode: 'dry-run',
    provider_id: 'provider.example',
    model_id: 'model.example-1',
    vocabulary_version: 'gdansk-v1',
    timeout_ms: 120000,
    max_attempts: 2,
  };
}

function validLevel1() {
  const nameSpan = spanOf(TEXT_F1, 'Ян Прыкладны');
  const yearSpan = spanOf(TEXT_F1, '1688');
  return {
    article_id: sha('cc'),
    revision_id: sha('dd'),
    run_id: 'run-0001',
    vocabulary_version: 'gdansk-v1',
    entities: [
      { entity_id: 'entity.yan', kind: 'person', name: 'Ян Прыкладны' },
      { entity_id: 'entity.rod', kind: 'family', name: 'род Прыкладных' },
    ],
    mentions: [
      { kind: 'person', fragment_id: F1, start: nameSpan[0], end: nameSpan[1], mention_type: 'biography', proposed_entity_id: 'entity.yan' },
    ],
    time_references: [
      { fragment_id: F1, start: yearSpan[0], end: yearSpan[1], role: 'lifespan', year_from: 1688, year_to: 1751, precision: 'exact' },
    ],
    place_references: [
      {
        place: 'Прыкладава',
        name: 'Прыкладава',
        participation_type: 'birthplace',
        districts: ['district.main-town', 'unknown'],
        district_basis: 'згадка горада ў тэксце',
      },
    ],
    topic_assignments: [{ topic_id: 'topic.biographies', fragment_id: F1 }],
    hooks: [{ text: 'Нараджэнне гандляра', rationale: 'пачатак гісторыі роду', fragment_id: F1 }],
    context_needs: [{ concept: 'цэх', fragment_id: F1, closure_state: 'open' }],
  };
}

function validLevel2() {
  const castleSpan = spanOf(TEXT_F2, 'A🏰B');
  return {
    case_id: 'case-0001',
    run_id: 'run-0002',
    claims: [
      {
        claim_id: 'claim-0001',
        case_id: 'case-0001',
        run_id: 'run-0002',
        statement: 'Камяніца згадваецца з 1343 года.',
        modality: 'occurred',
        evidence: [{ fragment_id: F2, start: castleSpan[0], end: castleSpan[1], quote: quoteOf(TEXT_F2, castleSpan) }],
      },
    ],
    relations: [
      { relation_id: 'relation-0001', subject: 'Камяніца', action: 'згадваецца', object: '1343', claim_id: 'claim-0001' },
    ],
  };
}

const FRAGMENTS = { [F1]: TEXT_F1, [F2]: TEXT_F2 };

test('invalid_null_manifest: null, scalar and array documents are rejected with a type diagnostic', () => {
  for (const bad of [null, 42, 'manifest', []]) {
    const verdict = validateInput(bad);
    assert.equal(verdict.ok, false, JSON.stringify(bad));
    assert.ok(verdict.errors.some((e) => e.rule === 'type' && e.path === '$'), JSON.stringify(verdict.errors));
  }
  // Corrupt containers answer with diagnostics, never a thrown error
  // (implementation-rules 14).
  assert.equal(validateInput({ source_namespace: 'fixture-wiki', records: null }).ok, false);
  assert.equal(validateInput({ source_namespace: 'fixture-wiki', records: [null] }).ok, false);
});

test('duplicate_source_key: a repeated key is named; distinct keys and distinct media keys pass', () => {
  const duplicate = validManifest();
  duplicate.records[1].source_record_key = 'example-0001';
  const verdict = validateInput(duplicate);
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.errors.some((e) => e.rule === 'duplicate-source-key' && e.path === '$.records[1].source_record_key'),
    JSON.stringify(verdict.errors)
  );
  assert.equal(validateInput(validManifest()).ok, true);

  const duplicateMedia = validManifest();
  duplicateMedia.records[1].media.push({ media_key: 'example-0002-01', local_path: 'images/other.png', rights: 'cc0' });
  const mediaVerdict = validateInput(duplicateMedia);
  assert.ok(
    mediaVerdict.errors.some((e) => e.rule === 'duplicate-media-key' && e.path === '$.records[1].media[1].media_key'),
    JSON.stringify(mediaVerdict.errors)
  );
});

test('invalid_rights: a value outside the closed list is rejected; research_only marks unknown rights', () => {
  const bad = validManifest();
  bad.records[0].rights = 'gfdl-1.2';
  const verdict = validateInput(bad);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((e) => e.rule === 'enum' && e.path === '$.records[0].rights'), JSON.stringify(verdict.errors));

  const badMedia = validManifest();
  badMedia.records[1].media[0].rights = 'own-work';
  assert.ok(validateInput(badMedia).errors.some((e) => e.rule === 'enum' && e.path === '$.records[1].media[0].rights'));

  const unknown = validManifest();
  unknown.records[0].rights = 'research_only';
  assert.equal(validateInput(unknown).ok, true);
});

test('path-unsafe: absolute, traversal, empty-segment, backslash and drive paths are rejected on sight', () => {
  for (const bad of ['/etc/x.html', '../outside.html', 'pages//x.html', './x.html', 'pages/x/', 'pages\\x.html', 'C:/pages/x.html']) {
    const manifest = validManifest();
    manifest.records[0].html_path = bad;
    const verdict = validateInput(manifest);
    assert.equal(verdict.ok, false, bad);
    assert.ok(verdict.errors.some((e) => e.rule === 'path-unsafe' && e.path === '$.records[0].html_path'), `${bad}: ${JSON.stringify(verdict.errors)}`);
  }
  const mediaPath = validManifest();
  mediaPath.records[1].media[0].local_path = '../outside.png';
  assert.ok(validateInput(mediaPath).errors.some((e) => e.rule === 'path-unsafe' && e.path === '$.records[1].media[0].local_path'));
});

test('validation passes without touching the referenced files (existence is unpack G19.02)', () => {
  const manifest = validManifest();
  manifest.records[0].html_path = 'pages/never-on-disk.html';
  manifest.records[1].media[0].local_path = 'images/never-on-disk.png';
  const verdict = validateInput(manifest);
  assert.deepEqual(verdict, { ok: true, errors: [] });
});

test('hook_limit: more than three hooks per article are rejected (25 §2), three pass', () => {
  const result = validLevel1();
  result.hooks = result.hooks.concat([
    { text: 'Другая', rationale: 'працяг', fragment_id: F1 },
    { text: 'Трэцяя', rationale: 'кульмінацыя', fragment_id: F1 },
    { text: 'Чацвёртая', rationale: 'лішняя', fragment_id: F1 },
  ]);
  const verdict = validateModelResult(1, result, FRAGMENTS);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((e) => e.rule === 'maxItems' && e.path === '$.hooks'), JSON.stringify(verdict.errors));

  result.hooks = result.hooks.slice(0, 3);
  assert.deepEqual(validateModelResult(1, result, FRAGMENTS), { ok: true, errors: [] });
});

test('quote_unicode_offsets: ranges index code points, end is exclusive, equality is exact (25 §8)', () => {
  const castleSpan = spanOf(TEXT_F2, 'A🏰B');
  assert.ok(validateModelResult(2, validLevel2(), FRAGMENTS).ok, 'an astral char inside the quote validates by code points');

  // The same quote with a UTF-16-flavoured end (one unit more) does not match:
  // offsets are code points, not UTF-16 units.
  const utf16 = validLevel2();
  utf16.claims[0].evidence[0] = { fragment_id: F2, start: castleSpan[0], end: castleSpan[1] + 1, quote: quoteOf(TEXT_F2, castleSpan) };
  const utf16Verdict = validateModelResult(2, utf16, FRAGMENTS);
  assert.ok(utf16Verdict.errors.some((e) => e.rule === 'quote-mismatch' && e.path === '$.claims[0].evidence[0].quote'), JSON.stringify(utf16Verdict.errors));

  // No re-normalization on check: a dash variant is a mismatch, not a fix.
  const dashSpan = spanOf(TEXT_F2, '—');
  const dash = validLevel2();
  dash.claims[0].evidence[0] = { fragment_id: F2, start: dashSpan[0], end: dashSpan[1], quote: '-' };
  assert.ok(validateModelResult(2, dash, FRAGMENTS).errors.some((e) => e.rule === 'quote-mismatch'));
});

test('unknown_fragment_id: absent fragment references are named at both levels; corrupt fragments answer with diagnostics', () => {
  const absent = sha('ff');

  const level1 = validLevel1();
  level1.mentions[0].fragment_id = absent;
  const level1Verdict = validateModelResult(1, level1, FRAGMENTS);
  assert.ok(
    level1Verdict.errors.some((e) => e.rule === 'unknown-fragment-id' && e.path === '$.mentions[0].fragment_id'),
    JSON.stringify(level1Verdict.errors)
  );

  const level2 = validLevel2();
  level2.claims[0].evidence[0].fragment_id = absent;
  assert.ok(validateModelResult(2, level2, FRAGMENTS).errors.some((e) => e.rule === 'unknown-fragment-id'));

  // A non-string fragment value is treated as absent, not crashed on.
  assert.ok(validateModelResult(1, validLevel1(), { [F1]: 42 }).errors.some((e) => e.rule === 'unknown-fragment-id'));
  // Missing or non-object fragment maps answer with a diagnostic.
  for (const bad of [null, undefined, 'fragments', [TEXT_F1]]) {
    const verdict = validateModelResult(1, validLevel1(), bad);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.errors.some((e) => e.rule === 'invalid-fragments'), `${String(bad)}: ${JSON.stringify(verdict.errors)}`);
  }
  // Unknown level answers with a diagnostic.
  assert.deepEqual(validateModelResult(3, {}, {}), { ok: false, errors: [{ rule: 'unknown-level', path: '$' }] });
});

test('level-1 semantics: inverted years, unknown topics, districts, entities and ranges are named', () => {
  const base = validLevel1();

  const inverted = structuredClone(base);
  inverted.time_references[0].year_from = 1900;
  inverted.time_references[0].year_to = 1800;
  assert.ok(
    validateModelResult(1, inverted, FRAGMENTS).errors.some((e) => e.rule === 'inverted-year-range' && e.path === '$.time_references[0]'),
    'year_to before year_from is rejected'
  );

  const topic = structuredClone(base);
  topic.topic_assignments[0].topic_id = 'topic.absent';
  assert.ok(validateModelResult(1, topic, FRAGMENTS).errors.some((e) => e.rule === 'unknown-topic' && e.path === '$.topic_assignments[0].topic_id'));

  const district = structuredClone(base);
  district.place_references[0].districts = ['district.absent'];
  assert.ok(validateModelResult(1, district, FRAGMENTS).errors.some((e) => e.rule === 'unknown-district'));
  district.place_references[0].districts = ['unknown'];
  assert.ok(validateModelResult(1, district, FRAGMENTS).ok, 'unknown district stays unknown');

  const entity = structuredClone(base);
  entity.mentions[0].proposed_entity_id = 'entity.absent';
  assert.ok(validateModelResult(1, entity, FRAGMENTS).errors.some((e) => e.rule === 'unknown-entity-id'));

  const entityDuplicate = structuredClone(base);
  entityDuplicate.entities.push({ entity_id: 'entity.yan', kind: 'person', name: 'Ян Прыкладны' });
  assert.ok(validateModelResult(1, entityDuplicate, FRAGMENTS).errors.some((e) => e.rule === 'duplicate-entity-id' && e.path === '$.entities[2].entity_id'));

  const range = structuredClone(base);
  range.mentions[0].end = 100000;
  assert.ok(validateModelResult(1, range, FRAGMENTS).errors.some((e) => e.rule === 'invalid-text-range' && e.path === '$.mentions[0].end'));
  range.mentions[0].end = range.mentions[0].start;
  assert.ok(validateModelResult(1, range, FRAGMENTS).errors.some((e) => e.rule === 'invalid-text-range'), 'an empty range is invalid');

  const vocabulary = structuredClone(base);
  vocabulary.vocabulary_version = 'nowhere-v9';
  assert.ok(validateModelResult(1, vocabulary, FRAGMENTS).errors.some((e) => e.rule === 'unknown-vocabulary-version'));
});

test('level-2 cross-references: relations cite claims, claims match the envelope, ids stay unique', () => {
  const base = validLevel2();

  const relation = structuredClone(base);
  relation.relations[0].claim_id = 'claim.absent';
  assert.ok(validateModelResult(2, relation, FRAGMENTS).errors.some((e) => e.rule === 'unknown-claim-id' && e.path === '$.relations[0].claim_id'));

  const caseMismatch = structuredClone(base);
  caseMismatch.claims[0].case_id = 'case-other';
  assert.ok(validateModelResult(2, caseMismatch, FRAGMENTS).errors.some((e) => e.rule === 'case-mismatch'));

  const runMismatch = structuredClone(base);
  runMismatch.claims[0].run_id = 'run-other';
  assert.ok(validateModelResult(2, runMismatch, FRAGMENTS).errors.some((e) => e.rule === 'run-mismatch'));

  const duplicate = structuredClone(base);
  duplicate.claims.push(structuredClone(base.claims[0]));
  assert.ok(validateModelResult(2, duplicate, FRAGMENTS).errors.some((e) => e.rule === 'duplicate-claim-id' && e.path === '$.claims[1].claim_id'));

  const range = structuredClone(base);
  range.claims[0].evidence[0].end = 100000;
  assert.ok(validateModelResult(2, range, FRAGMENTS).errors.some((e) => e.rule === 'invalid-text-range' && e.path === '$.claims[0].evidence[0].end'));

  // A null result answers with the schema type diagnostic, never a crash.
  const verdict = validateModelResult(2, null, FRAGMENTS);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((e) => e.rule === 'type' && e.path === '$'));
});

test('validate-run-config: live requires consent and caps, attempts stay within three', () => {
  assert.deepEqual(validateRunConfig(validRunConfig()), { ok: true, errors: [] });

  const live = { ...validRunConfig(), mode: 'live' };
  const noConsent = validateRunConfig(live);
  assert.equal(noConsent.ok, false);
  assert.ok(noConsent.errors.some((e) => e.rule === 'required' && e.path === '$.data_transfer_consent'), JSON.stringify(noConsent.errors));

  const falseConsent = { ...live, data_transfer_consent: false, token_limit_total: 1000, cost_cap_per_request: 1 };
  assert.ok(validateRunConfig(falseConsent).errors.some((e) => e.rule === 'const' && e.path === '$.data_transfer_consent'));

  const consented = { ...live, data_transfer_consent: true, token_limit_total: 1000, cost_cap_per_request: 0.5 };
  assert.deepEqual(validateRunConfig(consented), { ok: true, errors: [] });

  const attempts = { ...validRunConfig(), max_attempts: 4 };
  assert.ok(validateRunConfig(attempts).errors.some((e) => e.rule === 'maximum' && e.path === '$.max_attempts'));

  const vocabulary = { ...validRunConfig(), vocabulary_version: 'nowhere-v9' };
  assert.ok(validateRunConfig(vocabulary).errors.some((e) => e.rule === 'unknown-vocabulary-version'));

  const corrupt = validateRunConfig(null);
  assert.equal(corrupt.ok, false);
  assert.ok(corrupt.errors.some((e) => e.rule === 'type' && e.path === '$'));
});

test('validateCase: pinned shape, duplicates and inverted filter years are named', () => {
  const validCase = () => ({
    case_id: 'case-0001',
    question: 'Як камяніцы Выдуманай вуліцы перажылі 1734 год?',
    filters: { districts: ['district.main-town'], year_from: 1700, year_to: 1800 },
    candidates: [{ candidate_id: 'episode-1', fragment_ids: [F1] }],
    selected: [{ fragment_id: F1, revision_id: sha('dd') }],
  });
  assert.deepEqual(validateCase(validCase()), { ok: true, errors: [] });

  const duplicateSelected = validCase();
  duplicateSelected.selected.push({ fragment_id: F1, revision_id: sha('dd') });
  assert.ok(validateCase(duplicateSelected).errors.some((e) => e.rule === 'duplicate-selected-fragment' && e.path === '$.selected[1].fragment_id'));

  const duplicateCandidate = validCase();
  duplicateCandidate.candidates.push({ candidate_id: 'episode-1', fragment_ids: [F2] });
  assert.ok(validateCase(duplicateCandidate).errors.some((e) => e.rule === 'duplicate-candidate-id'));

  const inverted = validCase();
  inverted.filters.year_from = 1800;
  inverted.filters.year_to = 1700;
  assert.ok(validateCase(inverted).errors.some((e) => e.rule === 'inverted-year-range' && e.path === '$.filters'));

  const corrupt = validateCase([]);
  assert.equal(corrupt.ok, false);
  assert.ok(corrupt.errors.some((e) => e.rule === 'type' && e.path === '$'));
});

test('validateDocument pins the article, review and export shapes', () => {
  const validArticle = () => ({
    article_id: sha('cc'),
    revision_id: sha('dd'),
    extractor_version: 'wiki-html/v1',
    title: 'Камяніца Прыкладных',
    fragments: [
      {
        fragment_id: sha('aa'),
        article_id: sha('cc'),
        revision_id: sha('dd'),
        extractor_version: 'wiki-html/v1',
        kind: 'body',
        section_path: ['Гісторыя'],
        text: 'Дом узвялі ў 1712 годзе.',
        source_locator: 'p[1]',
      },
    ],
    links: [{ visible_text: 'суседні дом', target: './Суседні_дом', source_locator: 'p[1]a[1]' }],
    images: [
      {
        asset_id: sha('ee'),
        source_locator: 'figure[1]',
        caption: 'Знак спадчыны',
        author: 'Стэфан Вынаходлівы',
        dates: { file: 1901, caption: 1905 },
      },
    ],
  });
  assert.deepEqual(validateDocument('article-fragment-v1', validArticle()), { ok: true, errors: [] });

  const badFragmentId = validArticle();
  badFragmentId.fragments[0].fragment_id = 'not-hex';
  assert.ok(validateDocument('article-fragment-v1', badFragmentId).errors.some((e) => e.rule === 'pattern' && e.path === '$.fragments[0].fragment_id'));

  const badKind = validArticle();
  badKind.fragments[0].kind = 'heading';
  assert.ok(validateDocument('article-fragment-v1', badKind).errors.some((e) => e.rule === 'enum'));

  const review = (extra) => ({
    claim_id: 'claim-0001',
    decision: 'accepted',
    decided_by: 'аўтар',
    decided_at: '2026-10-02T01:00:00Z',
    ...extra,
  });
  assert.deepEqual(validateDocument('review-decision-v1', review({ result_revision: sha('dd') })), { ok: true, errors: [] });
  const bothRefs = review({ result_revision: sha('dd'), result_version: 'v2' });
  assert.ok(validateDocument('review-decision-v1', bothRefs).errors.some((e) => e.rule === 'oneOf'), 'exactly one of revision/version');
  assert.ok(validateDocument('review-decision-v1', review({})).errors.some((e) => e.rule === 'oneOf'));
  assert.ok(validateDocument('review-decision-v1', review({ result_revision: sha('dd'), decision: 'maybe' })).errors.some((e) => e.rule === 'enum'));

  const privateExport = {
    case_id: 'case-0001',
    generated_at: '2026-10-02T01:00:00Z',
    claims: [
      {
        claim_id: 'claim-0001',
        statement: 'Камяніца згадваецца з 1343 года.',
        modality: 'occurred',
        evidence: [{ fragment_id: sha('aa'), start: 0, end: 5, quote: 'Камян' }],
      },
    ],
    relations: [],
    images: [{ media_key: 'example-0003-01', rights: 'research_only', caption: 'Садзіба' }],
    open_context_needs: [{ concept: 'цэх' }],
  };
  assert.deepEqual(validateDocument('export-private-v1', privateExport), { ok: true, errors: [] });

  const publicStatus = {
    generated_at: '2026-10-02T01:00:00Z',
    cases: [{ case_ref: 'a'.repeat(32), state: 'reviewed', metrics: { claims_accepted: 3 } }],
  };
  assert.deepEqual(validateDocument('export-public-status-v1', publicStatus), { ok: true, errors: [] });

  // 25 §9: the public-status export has no place for quotes or non-opaque ids.
  const leak = structuredClone(publicStatus);
  leak.cases[0].quote = 'уцечка';
  assert.ok(validateDocument('export-public-status-v1', leak).errors.some((e) => e.rule === 'additionalProperties' && e.path === '$.cases[0].quote'));

  const namedRef = structuredClone(publicStatus);
  namedRef.cases[0].case_ref = 'case-0001';
  assert.ok(validateDocument('export-public-status-v1', namedRef).errors.some((e) => e.rule === 'pattern' && e.path === '$.cases[0].case_ref'));

  const stringMetric = structuredClone(publicStatus);
  stringMetric.cases[0].metrics.claims = 'шмат';
  assert.ok(validateDocument('export-public-status-v1', stringMetric).errors.some((e) => e.rule === 'type' && e.path === '$.cases[0].metrics.claims'));

  assert.deepEqual(validateDocument('no-such-schema', {}), { ok: false, errors: [{ rule: 'unknown-schema', path: '$' }] });
});

test('gdansk-v1 dictionary: version, stable unique ids and the district list of 25 §5', () => {
  const vocabulary = JSON.parse(readFileSync(new URL('./vocabularies/gdansk-v1.json', import.meta.url), 'utf8'));
  assert.equal(vocabulary.version, 'gdansk-v1');

  const topicIds = vocabulary.topics.map((topic) => topic.topic_id);
  assert.ok(topicIds.length > 0);
  assert.equal(new Set(topicIds).size, topicIds.length, 'topic ids are stable and unique');
  assert.ok(Array.isArray(vocabulary.proposed_topics), 'proposed themes live in a separate list, not in topics');

  const districtTitles = vocabulary.districts.map((district) => district.title).sort();
  assert.deepEqual(districtTitles, ['Główne Miasto', 'Oliwa', 'Stare Miasto', 'Wrzeszcz']);

  const epochIds = vocabulary.epochs.map((epoch) => epoch.epoch_id);
  assert.equal(new Set(epochIds).size, epochIds.length);
});
