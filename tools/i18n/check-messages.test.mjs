// G21.26 (issue #559) — the shipped-locale gate's behavioral suites. The five
// named deliverables of the issue run here: missing_locale_key,
// stale_source_hash, unreviewed_hash_bump, valid_same_commit_update and
// standard_runner_enforces_messages; the remaining suites cover the real-tree
// green path (plan-aware: uk's guideHint be-fallback stays legal), the
// missing-file case, the generated-freshness surfacing and corrupt input
// (diagnostics, never a throw). Controlled cases run on a fixture root built
// from the real contract files — the real tree is never mutated. Node stdlib
// only (tools-zone-closed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPLETE_UI_LOCALES } from '../../contracts/ui-locales.ts';
import { loadUiMessagesSource, sourceHash } from '../../contracts/ui-messages/ui-messages.mjs';

import { DOMAINS, run as regenerateOutputs } from './generate-messages.mjs';
import { checkShippedMessages, plannedTranslationRequirements, run, standardRunnerDiscovers } from './check-messages.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const SHIPPED = COMPLETE_UI_LOCALES.filter((locale) => locale !== 'be');
const PROBE_ID = 'native.chrome.back';

// A fixture root carries the real contract data (both pass their contracts)
// and nothing else — the gate's data leg can run, the freshness leg only
// after the generator has written its outputs into the fixture.
function fixtureRoot() {
  const fake = mkdtempSync(join(tmpdir(), 'kudy-g2126-'));
  mkdirSync(join(fake, 'contracts/ui-messages/translations'), { recursive: true });
  cpSync(join(root, 'contracts/ui-messages/source.json'), join(fake, 'contracts/ui-messages/source.json'));
  for (const locale of SHIPPED) {
    cpSync(
      join(root, `contracts/ui-messages/translations/${locale}.json`),
      join(fake, `contracts/ui-messages/translations/${locale}.json`),
    );
  }
  return fake;
}

function readTranslation(fake, locale) {
  return JSON.parse(readFileSync(join(fake, `contracts/ui-messages/translations/${locale}.json`), 'utf8'));
}

function writeTranslation(fake, locale, set) {
  writeFileSync(join(fake, `contracts/ui-messages/translations/${locale}.json`), JSON.stringify(set, null, 2), 'utf8');
}

// The honest simulation of a source edit: the text changes and the record's
// stored fingerprint is recomputed (the source contract requires the stored
// hash to match), so the source stays contract-valid and only the
// translations' pins can go stale.
function editSourceRecord(fake, id) {
  const doc = JSON.parse(readFileSync(join(fake, 'contracts/ui-messages/source.json'), 'utf8'));
  const record = doc.records.find((candidate) => candidate.id === id);
  record.source = `${record.source} (перагледжана)`;
  record.context = `${record.context}; кантэкст удакладнены`;
  record.sourceHash = sourceHash(record);
  writeFileSync(join(fake, 'contracts/ui-messages/source.json'), JSON.stringify(doc, null, 2), 'utf8');
  return record.sourceHash;
}

test('standard_gate_green: the shipped-locale gate passes the committed tree', () => {
  const verdict = checkShippedMessages();
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.ok, true);
});

test('standard_gate_green: the requirements are plan-aware — uk keeps its documented guideHint fallback', () => {
  const sourceDoc = loadUiMessagesSource(join(root, 'contracts/ui-messages/source.json'));
  const required = plannedTranslationRequirements(sourceDoc);
  // guide-hint-strings.generated.ts renders be/en only (uk-release-scope
  // §6.4): the plan must not demand uk guideHint records the set lacks —
  // and must demand the chrome records it does ship.
  for (const guideHintId of ['native.guideHint.heading', 'native.guideHint.paid']) {
    assert.ok(!required.get('uk')?.has(guideHintId), `${guideHintId}: not required for uk`);
    assert.ok(required.get('en')?.has(guideHintId), `${guideHintId}: required for en`);
  }
  assert.ok(required.get('uk')?.has(PROBE_ID), `${PROBE_ID}: required for uk`);
});

test('missing_locale_key: a planned message without a record is named with locale, key and reason', () => {
  const fake = fixtureRoot();
  try {
    const set = readTranslation(fake, 'uk');
    const dropped = set.records.find((record) => record.id.startsWith('native.chrome.'));
    set.records = set.records.filter((record) => record !== dropped);
    writeTranslation(fake, 'uk', set);
    const verdict = checkShippedMessages({ root: fake });
    assert.equal(verdict.ok, false);
    const named = verdict.problems.filter((problem) => problem.rule === 'missing_locale_key');
    assert.deepEqual(named, [{
      rule: 'missing_locale_key',
      locale: 'uk',
      key: dropped.id,
      reason: named[0]?.reason,
    }]);
    assert.match(named[0]?.reason ?? '', /output plan renders this message/, 'the reason names the planned-coverage cause');
    assert.equal(verdict.problems.length, named.length, 'no unrelated problems fire');
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test('missing_locale_key: a shipped locale without a translation file fails as missing_locale', () => {
  const fake = fixtureRoot();
  try {
    rmSync(join(fake, 'contracts/ui-messages/translations/en.json'));
    const verdict = checkShippedMessages({ root: fake });
    assert.equal(verdict.ok, false);
    const named = verdict.problems.filter((problem) => problem.rule === 'missing_locale');
    assert.deepEqual(named.map((problem) => problem.locale), ['en']);
    assert.match(named[0]?.reason ?? '', /en\.json is missing/, 'the reason names the missing file');
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test('stale_source_hash: a changed source record with old pins fails through the gate', () => {
  const fake = fixtureRoot();
  try {
    editSourceRecord(fake, PROBE_ID);
    const verdict = checkShippedMessages({ root: fake });
    assert.equal(verdict.ok, false);
    const stale = verdict.problems.filter((problem) => problem.rule === 'translation_contract');
    assert.deepEqual(stale.map((problem) => problem.locale).sort(), SHIPPED.sort(), 'every shipped locale holding the old pin is named');
    for (const problem of stale) {
      assert.match(problem.reason, /stale_translation_denied/);
      assert.ok(
        problem.reason.includes(`$.records[id=${PROBE_ID}].reviewedSourceHash`),
        `the failing record is named: ${problem.reason}`,
      );
    }
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test('unreviewed_hash_bump: hash bumps without the required review record fail', () => {
  // Variant 1 — the pin is bumped while the record stays unreviewed: the
  // missing-evidence case, rejected regardless of hash freshness.
  const unreviewed = fixtureRoot();
  try {
    const newHash = editSourceRecord(unreviewed, PROBE_ID);
    const set = readTranslation(unreviewed, 'uk');
    const record = set.records.find((candidate) => candidate.id === PROBE_ID);
    record.reviewedSourceHash = newHash;
    record.review = { outcome: 'unreviewed' };
    writeTranslation(unreviewed, 'uk', set);
    const verdict = checkShippedMessages({ root: unreviewed });
    const named = verdict.problems.filter((problem) => problem.rule === 'review_evidence_required');
    assert.deepEqual(named, [{ rule: 'review_evidence_required', locale: 'uk', key: PROBE_ID, reason: named[0]?.reason }]);
    assert.match(named[0]?.reason ?? '', /"unreviewed"/);
  } finally {
    rmSync(unreviewed, { recursive: true, force: true });
  }

  // Variant 2 — a re-review pass that bumps the pin but documents no reason:
  // the renewed review must say why the translation survives the source
  // change, a hash swap alone is not a review.
  const silent = fixtureRoot();
  try {
    const newHash = editSourceRecord(silent, PROBE_ID);
    const set = readTranslation(silent, 'uk');
    set.provenance = { kind: 'source-change re-review', reviewer: 'owner', evidence: 'same-commit re-review of the changed message' };
    for (const record of set.records) {
      if (record.id === PROBE_ID) {
        record.reviewedSourceHash = newHash;
        continue;
      }
      record.review = { outcome: 'approved', note: 'unchanged translation, re-checked against the new source' };
    }
    writeTranslation(silent, 'uk', set);
    const verdict = checkShippedMessages({ root: silent });
    const named = verdict.problems.filter((problem) => problem.rule === 'review_reason_required');
    assert.deepEqual(named, [{ rule: 'review_reason_required', locale: 'uk', key: PROBE_ID, reason: named[0]?.reason }]);
    assert.match(named[0]?.reason ?? '', /renewed-review reason/);
  } finally {
    rmSync(silent, { recursive: true, force: true });
  }
});

test('valid_same_commit_update: a fully reviewed same-commit update passes end to end', () => {
  const fake = fixtureRoot();
  try {
    const newHash = editSourceRecord(fake, PROBE_ID);
    for (const locale of SHIPPED) {
      const set = readTranslation(fake, locale);
      set.provenance = { kind: 'source-change re-review', reviewer: 'owner', evidence: 'every shipped locale re-reviewed in the source-change commit (G21.19 process)' };
      for (const record of set.records) {
        if (record.id === PROBE_ID) {
          record.reviewedSourceHash = newHash;
          record.review = { outcome: 'approved', note: 'пераклад адпавядае новаму арыгіналу даслоўна — праверана супраць new source/context' };
        } else {
          record.review = { outcome: 'approved', note: 'unchanged translation, re-checked against the new source' };
        }
      }
      writeTranslation(fake, locale, set);
    }
    // The same commit regenerates the outputs into the fixture root, so the
    // freshness leg runs clean too.
    for (const domain of DOMAINS) {
      for (const output of domain.outputs) {
        mkdirSync(join(fake, dirname(output.file)), { recursive: true });
      }
    }
    const written = regenerateOutputs([], { root: fake, log: () => {}, error: () => {} });
    assert.equal(written.status, 'written');
    const verdict = checkShippedMessages({ root: fake });
    assert.deepEqual(verdict.problems, []);
    assert.equal(verdict.ok, true);
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test('generated_output_stale: data clean but generated outputs not regenerated fails the gate', () => {
  const fake = fixtureRoot();
  try {
    for (const domain of DOMAINS) {
      for (const output of domain.outputs) {
        mkdirSync(join(fake, dirname(output.file)), { recursive: true });
      }
    }
    assert.equal(regenerateOutputs([], { root: fake, log: () => {}, error: () => {} }).status, 'written');
    const target = 'components/ui-strings.generated.ts';
    writeFileSync(join(fake, target), `${readFileSync(join(fake, target), 'utf8')}\n// hand edit\n`, 'utf8');
    const verdict = checkShippedMessages({ root: fake });
    assert.equal(verdict.ok, false);
    const named = verdict.problems.filter((problem) => problem.rule === 'generated_output_stale');
    assert.ok(named.some((problem) => problem.reason.includes(target)), named.map((problem) => problem.reason).join('\n'));
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test('corrupt_input: corrupt files answer with diagnostics, never a throw', () => {
  const badSource = fixtureRoot();
  try {
    writeFileSync(join(badSource, 'contracts/ui-messages/source.json'), '{not json', 'utf8');
    const verdict = checkShippedMessages({ root: badSource });
    assert.deepEqual(verdict.problems.map((problem) => problem.rule), ['source_contract']);
    assert.equal(verdict.ok, false);
  } finally {
    rmSync(badSource, { recursive: true, force: true });
  }
  const badSet = fixtureRoot();
  try {
    writeFileSync(join(badSet, 'contracts/ui-messages/translations/en.json'), '{not json', 'utf8');
    const verdict = checkShippedMessages({ root: badSet });
    assert.equal(verdict.ok, false);
    const named = verdict.problems.filter((problem) => problem.rule === 'translation_contract');
    assert.deepEqual(named.map((problem) => problem.locale), ['en']);
    assert.match(named[0]?.reason ?? '', /unreadable/);
  } finally {
    rmSync(badSet, { recursive: true, force: true });
  }
});

test('standard_runner_enforces_messages: the standard test script discovers the gate suite and the removal is visible', () => {
  const script = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.test;
  const suite = 'tools/i18n/check-messages.test.mjs';
  // The real wiring: the suite runs through npm test — the required CI path.
  assert.equal(standardRunnerDiscovers(script, suite), true);
  assert.match(script, /node --test/, 'the standard path is the node --test discovery');
  // Controlled removed-wiring cases: dropping or narrowing the token makes
  // the guard answer false — the wiring cannot be silently reverted.
  const withoutToken = script.replace(/\s*"tools\/i18n\/\*\.test\.mjs"/, '');
  assert.notEqual(withoutToken, script, 'the mutation really removed the token');
  assert.equal(standardRunnerDiscovers(withoutToken, suite), false);
  const narrowed = script.replace('"tools/i18n/*.test.mjs"', '"tools/i18n/generate-messages.test.mjs"');
  assert.equal(standardRunnerDiscovers(narrowed, suite), false);
  // A future re-wiring keeps the guarantee when a covering glob stays.
  assert.equal(standardRunnerDiscovers('node --test "tools/**/*.test.mjs"', suite), true);
});

test('run: problems print named lines and the verdict carries the exit signal', () => {
  const fake = fixtureRoot();
  try {
    rmSync(join(fake, 'contracts/ui-messages/translations/en.json'));
    const lines = [];
    const verdict = run([], { root: fake, log: (line) => lines.push(line), error: (line) => lines.push(line) });
    assert.equal(verdict.ok, false);
    assert.ok(lines.some((line) => line.startsWith('check-messages: missing_locale [en]:')), lines.join('\n'));
    assert.ok(lines.some((line) => line.match(/check-messages: \d+ problem\(s\)/)), lines.join('\n'));
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});
