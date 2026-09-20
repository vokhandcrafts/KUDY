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
// Negative fixtures live in fixtures/authoring-pipeline/; each isolates the
// rule named by its directory. Report content is re-rendered, not parsed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePackage } from './validate-package.mjs';
import { validateAuthoring } from './validate-authoring.mjs';
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
};

test('criterion 2: the real walkthrough validates clean — no invented connection passed as a fact', () => {
  assert.deepEqual(validateAuthoring(AUTHORING), { ok: true, errors: [], warnings: [] });
});

test('criterion 1: the committed review report equals the regenerated one (be + en)', () => {
  for (const draftId of ['gdansk-stmary-be', 'gdansk-stmary-en']) {
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
  const report = fs.readFileSync(path.join(AUTHORING, 'review', 'gdansk-stmary-be.review.md'), 'utf8');
  const claims = JSON.parse(fs.readFileSync(path.join(AUTHORING, 'claims.json'), 'utf8'));
  const fragments = JSON.parse(fs.readFileSync(path.join(AUTHORING, 'fragments.json'), 'utf8'));
  const fragmentsById = new Map(fragments.map((f) => [f.fragment_id, f]));
  const lines = report.split('\n');

  for (const claim of claims) {
    assert.ok(report.includes(`[${claim.claim_id}]`), `claim ${claim.claim_id} missing from the report`);
    for (const fragmentId of claim.support) {
      const fragment = fragmentsById.get(fragmentId);
      const quoteLine = lines.findIndex((line) => line.includes(`„${fragment.quote}“`));
      assert.ok(quoteLine !== -1, `quote of ${fragmentId} missing from the report`);
      // The locator renders on the line directly under its quote — assert it
      // there, with this fragment's page and paragraph, not anywhere in the report.
      const locatorLine = lines[quoteLine + 1] ?? '';
      assert.ok(
        locatorLine.includes('Локатар:') &&
          locatorLine.includes(`ст. ${fragment.locator.page}`) &&
          locatorLine.includes(`абзац ${fragment.locator.paragraph}`),
        `locator of ${fragmentId} missing directly under its quote`,
      );
    }
    assert.ok(report.includes('public_domain'), 'source rights missing from the report');
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
  let result;
  assert.doesNotThrow(() => {
    result = validateAuthoring(dir);
  });
  assert.equal(result.ok, false);
  const rules = new Set(result.errors.map((e) => e.rule));
  assert.ok(rules.has('invalid-shape'), `missing invalid-shape: ${result.errors.map((e) => e.rule).join()}`);
  assert.ok(rules.has('invalid-value'), `missing invalid-value: ${result.errors.map((e) => e.rule).join()}`);
  assert.ok(rules.has('invalid-json'), `missing invalid-json: ${result.errors.map((e) => e.rule).join()}`);
});
