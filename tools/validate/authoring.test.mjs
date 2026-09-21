// G03.01 — authoring-process acceptance suite (issue #123). Criteria:
// 1. the author sees locator + quote for every fact — the committed review
//    report matches the regenerated one and carries quote + locator per cited
//    claim (docs/07_content_pipeline.md, review step);
// 2. an invented connection cannot pass as a fact — the unbacked-connection
//    fixture fails with exactly that rule; the real walkthrough validates
//    clean;
// 3. no auto-publish — approval requires a human review record, the package
//    validator refuses non-approved stories on the only export path, and no
//    bundle-build or web-reader file references the authoring workspace;
// 4. a translation is a new draft with its own review.
// G03.02 (issue #58) adds the guide-scenario criteria: a base story opens with
// orientation and never sells or dangles the paid layer, every extended story
// states its value, and the scenario file links each stop to own drafts,
// verified source refs and the discovery season canon.
// Negative fixtures live in fixtures/authoring-pipeline/; each isolates the
// rule named by its directory. Report content is re-rendered, not parsed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePackage } from './validate-package.mjs';
import { validateAuthoring, BASE_PURCHASE, BASE_DANGLE } from './validate-authoring.mjs';
import { renderReviewReport } from './authoring-review-report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const AUTHORING = path.join(REPO, 'authoring', 'gdansk');
const FIXTURES = path.join(REPO, 'fixtures', 'authoring-pipeline');
const TEMPLATE = path.join(REPO, 'content', 'author-template');

// The invalid fixtures, each expected to fail on exactly its named rule.
const NEGATIVE = {
  'invalid-unknown-source-ref': 'unknown-source-ref',
  'invalid-unknown-fragment-ref': 'unknown-fragment-ref',
  'invalid-unknown-claim-ref': 'unknown-claim-ref',
  'invalid-unknown-draft-ref': 'unknown-draft-ref',
  'invalid-fact-without-claim': 'fact-without-claim',
  'invalid-unbacked-connection': 'unbacked-connection',
  'invalid-rejected-claim-cited': 'rejected-claim-cited',
  'invalid-unmarked-claim-in-approved': 'unmarked-claim-in-approved',
  'invalid-approval-without-reviewer': 'approval-without-reviewer',
  'invalid-translation-copied-review': 'translation-copied-review',
  'invalid-duplicate-id': 'duplicate-id',
  'invalid-missing-locator': 'missing-locator',
  'invalid-draft-id-mismatch': 'draft-id-mismatch',
  'invalid-mark-without-reviewer': 'mark-without-reviewer',
  'invalid-claims-on-non-fact-block': 'claims-on-non-fact-block',
  'invalid-missing-quote': 'missing-quote',
  'invalid-review-by-too-long': 'invalid-value',
  // G03.02 (issue #58): tier rules and the guide scenario.
  'invalid-missing-orientation': 'missing-orientation',
  'invalid-base-purchase-hook': 'base-purchase-hook',
  'invalid-base-purchase-hook-nabyts': 'base-purchase-hook',
  'invalid-base-paid-dangle': 'base-paid-dangle',
  'invalid-base-paid-dangle-noun': 'base-paid-dangle',
  'invalid-extended-without-value': 'extended-without-value',
  'invalid-scenario-id-mismatch': 'scenario-id-mismatch',
  'invalid-scenario-unknown-draft-ref': 'scenario-unknown-draft-ref',
  'invalid-scenario-unknown-source-ref': 'scenario-unknown-source-ref',
  'invalid-scenario-place-without-source-refs': 'scenario-place-without-source-refs',
  'invalid-season-recommendation-without-reason': 'season-recommendation-without-reason',
  'invalid-scenario-draft-place-mismatch': 'scenario-draft-place-mismatch',
  'invalid-scenario-paid-note-missing': 'scenario-paid-note-missing',
};

test('criterion 2: the real walkthrough validates clean — no invented connection passed as a fact', () => {
  assert.deepEqual(validateAuthoring(AUTHORING), { ok: true, errors: [], warnings: [] });
});

test('criterion 1: the committed review report equals the regenerated one (every draft)', () => {
  const draftIds = fs
    .readdirSync(path.join(AUTHORING, 'drafts'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(AUTHORING, 'drafts', name), 'utf8')).draft_id)
    .sort();
  assert.ok(draftIds.length >= 7, `expected the full walkthrough set, got ${draftIds.length}`);
  for (const draftId of draftIds) {
    const file = path.join(AUTHORING, 'review', `${draftId}.review.md`);
    const rendered = renderReviewReport(AUTHORING, draftId);
    assert.ok(rendered !== null, `draft missing: ${draftId}`);
    assert.equal(fs.readFileSync(file, 'utf8'), `${rendered}\n`, `${draftId}.review.md is stale — regenerate it`);
  }
});

test('criterion 1: the report renderer refuses a space that fails validation, naming the rule', () => {
  const dir = path.join(FIXTURES, 'invalid-unbacked-connection');
  const draftId = JSON.parse(fs.readFileSync(path.join(dir, 'drafts', 'be.json'), 'utf8')).draft_id;
  assert.throws(
    () => renderReviewReport(dir, draftId),
    /прастора не праходзіць праверку \(unbacked-connection\)/,
    'the renderer must refuse an invalid workspace with the named rule',
  );
});

test('criterion 1: every fact block appears with its claim, exact quote and print locator', () => {
  const fragments = JSON.parse(fs.readFileSync(path.join(AUTHORING, 'fragments.json'), 'utf8'));
  const fragmentsById = new Map(fragments.map((f) => [f.fragment_id, f]));
  const claims = JSON.parse(fs.readFileSync(path.join(AUTHORING, 'claims.json'), 'utf8'));
  const claimsById = new Map(claims.map((c) => [c.claim_id, c]));
  const draftsDir = path.join(AUTHORING, 'drafts');

  for (const name of fs.readdirSync(draftsDir).filter((n) => n.endsWith('.json'))) {
    const draft = JSON.parse(fs.readFileSync(path.join(draftsDir, name), 'utf8'));
    const report = fs.readFileSync(path.join(AUTHORING, 'review', `${draft.draft_id}.review.md`), 'utf8');
    const lines = report.split('\n');
    for (const block of draft.blocks) {
      if (block.kind !== 'fact') continue;
      for (const claimId of block.claims) {
        const claim = claimsById.get(claimId);
        assert.ok(claim, `claim ${claimId} must exist`);
        assert.ok(report.includes(`[${claim.claim_id}]`), `claim ${claim.claim_id} missing from the ${draft.draft_id} report`);
        for (const fragmentId of claim.support) {
          const fragment = fragmentsById.get(fragmentId);
          const quoteLine = lines.findIndex((line) => line.includes(`„${fragment.quote}“`));
          assert.ok(quoteLine !== -1, `quote of ${fragmentId} missing from the ${draft.draft_id} report`);
          // The locator renders on the line directly under its quote — assert it
          // there, with this fragment's page and paragraph, not anywhere in the report.
          const locatorLine = lines[quoteLine + 1] ?? '';
          assert.ok(
            locatorLine.includes('Локатар:') &&
              locatorLine.includes(`ст. ${fragment.locator.page}`) &&
              locatorLine.includes(`абзац ${fragment.locator.paragraph}`),
            `locator of ${fragmentId} missing directly under its quote in the ${draft.draft_id} report`,
          );
        }
        assert.ok(report.includes('public_domain'), 'source rights missing from the report');
      }
    }
  }
});

test('criterion 3: the valid approved fixture passes — approval is reachable for a human-recorded review', () => {
  assert.deepEqual(validateAuthoring(path.join(FIXTURES, 'valid-approved')), { ok: true, errors: [], warnings: [] });
});

for (const [fixture, rule] of Object.entries(NEGATIVE)) {
  test(`negative fixture ${fixture} fails on exactly ${rule}`, () => {
    const result = validateAuthoring(path.join(FIXTURES, fixture));
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.errors.map((e) => e.rule),
      [rule],
      'the fixture must isolate exactly one violation',
    );
  });
}

test('criterion 3: the package validator refuses a story whose review.decision is not approved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g0301-'));
  fs.cpSync(TEMPLATE, dir, { recursive: true });
  const stripApproval = (rel) => {
    const file = path.join(dir, ...rel.split('/'));
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const stories = Array.isArray(doc) ? doc : doc.stories ?? [];
    for (const story of stories) {
      if (story.review) story.review.decision = 'pending';
    }
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  };
  for (const rel of ['be/base/stops.json', 'en/base/stops.json']) stripApproval(rel);
  const result = validatePackage(dir);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.rule === 'content-not-approved'), 'the approved gate must fire');
});

test('criterion 3: no bundle-build or web-reader file references the authoring workspace path', () => {
  const roots = ['tools/build-bundle', 'web/lib/content'];
  const offenders = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.(mjs|ts|tsx)$/.test(entry.name) && /authoring\//.test(fs.readFileSync(path.join(REPO, child), 'utf8'))) {
        offenders.push(child);
      }
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(offenders, [], 'the bundle path must never read the authoring workspace (no auto-publish)');
});

test('criterion 4: the translation is a separate draft that stays pending with its own review', () => {
  const en = JSON.parse(fs.readFileSync(path.join(AUTHORING, 'drafts', 'gdansk-stmary-en.json'), 'utf8'));
  assert.equal(en.source_draft_id, 'gdansk-stmary-be', 'the translation must declare its source draft');
  assert.equal(en.review.decision, 'pending', 'a translation never inherits approval');
  assert.equal(en.review.by, null);
});

// --- G03.02 (issue #58): the guide scenario ---------------------------------

test('g03.02 criterion 1: every base draft opens with an orientation block', () => {
  const draftsDir = path.join(AUTHORING, 'drafts');
  const names = fs.readdirSync(draftsDir).filter((name) => name.endsWith('.json'));
  assert.ok(names.length >= 7, 'the walkthrough set must be present');
  for (const name of names) {
    const draft = JSON.parse(fs.readFileSync(path.join(draftsDir, name), 'utf8'));
    if (draft.tier !== 'base') continue;
    assert.equal(
      draft.blocks[0]?.kind,
      'orientation',
      `${name} must open with orientation — the story stands alone under any approach (13 §2)`,
    );
  }
});

test('g03.02 criterion 4: every extended draft states the value the paid layer adds', () => {
  const draftsDir = path.join(AUTHORING, 'drafts');
  const names = fs.readdirSync(draftsDir).filter((name) => name.endsWith('.json'));
  const extended = names.filter((name) => JSON.parse(fs.readFileSync(path.join(draftsDir, name), 'utf8')).tier === 'extended');
  assert.ok(extended.length >= 3, 'each scenario stop must have its extended story');
  for (const name of extended) {
    const draft = JSON.parse(fs.readFileSync(path.join(draftsDir, name), 'utf8'));
    assert.ok(typeof draft.value === 'string' && draft.value.trim().length > 0, `${name} must carry a value note`);
  }
});

test('g03.02 criterion 5: the scenario links every stop to own drafts, verified refs and the season canon', () => {
  const scenario = JSON.parse(fs.readFileSync(path.join(AUTHORING, 'scenarios', 'gdansk-first-walk.json'), 'utf8'));
  const sources = JSON.parse(fs.readFileSync(path.join(AUTHORING, 'sources.json'), 'utf8'));
  const sourceIds = new Set(sources.map((source) => source.source_id));
  const draftsById = new Map(
    fs
      .readdirSync(path.join(AUTHORING, 'drafts'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const draft = JSON.parse(fs.readFileSync(path.join(AUTHORING, 'drafts', name), 'utf8'));
        return [draft.draft_id, draft];
      }),
  );
  assert.equal(scenario.stops.length, 3, 'the pilot walk has three stops');
  for (const stop of scenario.stops) {
    assert.ok(stop.drafts.length > 0, `${stop.place_id} must list its drafts`);
    for (const draftId of stop.drafts) {
      const draft = draftsById.get(draftId);
      assert.ok(draft, `draft ${draftId} of ${stop.place_id} must exist`);
      assert.equal(draft.place_id, stop.place_id, `draft ${draftId} must belong to ${stop.place_id}`);
    }
    assert.ok(
      Array.isArray(stop.refs) && stop.refs.length > 0 && stop.refs.every((ref) => sourceIds.has(ref)),
      `${stop.place_id} must cite verified source refs`,
    );
    assert.ok(
      Array.isArray(stop.season_recommendations) &&
        stop.season_recommendations.every((rec) => typeof rec.season === 'string' && typeof rec.reason === 'string' && rec.reason.length > 0),
      `${stop.place_id} season recommendations must follow the {season, reason} canon (empty = not_assessed)`,
    );
  }
  assert.ok(typeof scenario.paid_note === 'string' && scenario.paid_note.trim().length > 0, 'the scenario must say what the paid layer adds');
});

test('g03.02: a base draft is free of purchase hooks and paid-layer dangling (13 §3–§4)', () => {
  const draftsDir = path.join(AUTHORING, 'drafts');
  for (const name of fs.readdirSync(draftsDir).filter((n) => n.endsWith('.json'))) {
    const draft = JSON.parse(fs.readFileSync(path.join(draftsDir, name), 'utf8'));
    if (draft.tier !== 'base') continue;
    for (const block of draft.blocks) {
      assert.doesNotMatch(block.text, BASE_PURCHASE, `${name}/${block.block_id} must not sell`);
      assert.doesNotMatch(block.text, BASE_DANGLE, `${name}/${block.block_id} must not dangle the paid layer`);
    }
  }
});

test('g03.02: the sell/dangle patterns cover the project vocabulary without false positives', () => {
  // Alternatives beyond the isolating fixtures — pinned here so widening or
  // narrowing the patterns fails this suite (implementation-rules 1).
  for (const phrase of ['поўнай версіі', 'поўную версію', 'набыць пашырэнне', 'купіць', 'purchase']) {
    assert.match(phrase, BASE_PURCHASE, `BASE_PURCHASE must catch «${phrase}»`);
  }
  for (const phrase of ['у пашырэнні', 'платнае пашырэнне', 'працяг гісторыі', 'пашыраная версія']) {
    assert.match(phrase, BASE_DANGLE, `BASE_DANGLE must catch «${phrase}»`);
  }
  for (const phrase of ['пашырэнне гандлю', 'сцэнару пашырэнне не тычыцца']) {
    assert.doesNotMatch(phrase, BASE_DANGLE, `BASE_DANGLE must stay narrow: «${phrase}»`);
  }
});

test('g03.02: the season reason accepts the draft string and the canon localized object', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g0302-season-'));
  fs.mkdirSync(path.join(dir, 'drafts'));
  fs.mkdirSync(path.join(dir, 'scenarios'));
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify([{ source_id: 'src-x', title: 'T', creator: 'c', year: 1900, rights: 'public_domain', ref: 'https://example.com/x' }]));
  fs.writeFileSync(path.join(dir, 'fragments.json'), JSON.stringify([{ fragment_id: 'fr-1', source_id: 'src-x', locator: { page: 1, paragraph: 1 }, quote: 'Q.' }]));
  fs.writeFileSync(path.join(dir, 'claims.json'), JSON.stringify([{ claim_id: 'cl-1', text: 'C', support: ['fr-1'], mark: null, mark_by: null, mark_at: null }]));
  fs.writeFileSync(
    path.join(dir, 'drafts', 'be.json'),
    JSON.stringify({
      draft_id: 'be', locale: 'be', place_id: 'place-x', tier: 'base', source_draft_id: null, title: 'T',
      blocks: [
        { block_id: 'b0', kind: 'orientation', text: 'Арыентоўны сказ: паглядзіце на фасад.' },
        { block_id: 'b1', kind: 'fact', claims: ['cl-1'], text: 'Факт фікстуры.' },
      ],
      review: { by: null, at: null, decision: 'pending' },
    }),
  );
  const scenarioWith = (reason) => JSON.stringify({
    scenario_id: 'g', city: 'gdansk', locale: 'be', theme: 'Тэма', path_minutes: 30,
    stops: [{ place_id: 'place-x', title: 'P', walk_minutes: 10, drafts: ['be'], refs: ['src-x'], season_recommendations: [{ season: 'autumn', reason }] }],
  });
  const scenarioFile = path.join(dir, 'scenarios', 'g.json');

  fs.writeFileSync(scenarioFile, scenarioWith('Прыгожа ўвосень праз колер дрэў'));
  assert.deepEqual(validateAuthoring(dir), { ok: true, errors: [], warnings: [] }, 'the draft string form is a reason');

  fs.writeFileSync(scenarioFile, scenarioWith({ be: 'Прыгожа ўвосень праз колер дрэў', en: 'Autumn colours' }));
  assert.deepEqual(validateAuthoring(dir), { ok: true, errors: [], warnings: [] }, 'the canon localized object is a reason');

  fs.writeFileSync(scenarioFile, scenarioWith({ be: '' }));
  const result = validateAuthoring(dir);
  assert.deepEqual(result.errors.map((e) => e.rule), ['season-recommendation-without-reason'], 'an empty localized value is no reason');
});

test('corrupt input answers with diagnostics, never a thrown error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g0301-corrupt-'));
  fs.mkdirSync(path.join(dir, 'drafts'));
  fs.writeFileSync(path.join(dir, 'sources.json'), '[null, {"year": "old"}]');
  fs.writeFileSync(path.join(dir, 'fragments.json'), '{"fragment_id": "fr-1"}');
  fs.writeFileSync(
    path.join(dir, 'claims.json'),
    '[{"claim_id": "cl-1", "support": "fr-1", "mark": "maybe", "mark_at": "20-09-2026"}]',
  );
  fs.writeFileSync(
    path.join(dir, 'drafts', 'be.json'),
    '{"draft_id": "be", "blocks": null, "review": {"decision": "approved"}, "source_draft_id": "be"}',
  );
  fs.writeFileSync(path.join(dir, 'drafts', 'broken.json'), '{"draft_id": ');
  fs.writeFileSync(
    path.join(dir, 'drafts', 'empty.json'),
    '{"draft_id": "empty", "place_id": "place-x", "locale": "be", "tier": "base", "title": "T", "blocks": [], "review": {"decision": "pending"}}',
  );
  fs.mkdirSync(path.join(dir, 'scenarios'));
  fs.writeFileSync(path.join(dir, 'scenarios', 'broken.json'), '{"scenario_id": ');
  fs.writeFileSync(path.join(dir, 'scenarios', 's2.json'), '{"scenario_id": "s2", "stops": "x"}');
  let result;
  assert.doesNotThrow(() => {
    result = validateAuthoring(dir);
  });
  assert.equal(result.ok, false);
  const rules = new Set(result.errors.map((e) => e.rule));
  assert.ok(rules.has('invalid-shape'), `missing invalid-shape: ${result.errors.map((e) => e.rule).join()}`);
  assert.ok(rules.has('invalid-value'), `missing invalid-value: ${result.errors.map((e) => e.rule).join()}`);
  assert.ok(rules.has('invalid-json'), `missing invalid-json: ${result.errors.map((e) => e.rule).join()}`);
  assert.ok(rules.has('missing-orientation'), `missing missing-orientation: ${result.errors.map((e) => e.rule).join()}`);
});
