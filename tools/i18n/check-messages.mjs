// G21.26 (issue #559) — the shipped-locale message gate. The repository's
// standard checks fail while any shipped UI locale is missing, stale or lacks
// the required review evidence: a source change cannot slip through npm test
// (the required CI path runs it) with an incomplete, outdated or unreviewed
// translation set, and edited message data that is not reflected in the
// generated outputs fails the same gate.
//
// What the gate enforces per shipped locale (the registry's
// COMPLETE_UI_LOCALES — the loop is derived from the shared registry, never a
// fixed be/en/uk list; a language joins the gate by joining the registry):
//   missing_locale         — the translation file is absent while the output
//                            plan renders messages for the locale;
//   missing_locale_key     — the plan renders a message the set has no record
//                            for (planned coverage, so the documented uk
//                            guideHint be-fallback stays legal — the plan
//                            does not render those for uk);
//   translation_contract   — the per-file contract rules of
//                            translations.mjs (schema, extra/empty keys,
//                            placeholder and plural-form compatibility,
//                            stale reviewedSourceHash) surfaced through the
//                            gate instead of a silent pass;
//   review_evidence_required — a shipped record's review outcome is not
//                            approved (the missing-evidence case);
//   review_reason_required — a review pass that is not the original migration
//                            (provenance.kind) must give every record its
//                            renewed-review reason: a valid unchanged
//                            translation survives a source change only with
//                            an explicit renewed review and reason, not a
//                            blanket hash bump.
// When the data-level gate is clean, generated freshness rides the
// generator's own --check (the single owner of the plan and the byte
// comparison) — the gate surfaces its problems as generated_output_stale.
// The check proves mechanical completeness/freshness/evidence, not semantic
// translation quality (issue criterion 5); the recorded review stays the
// semantic responsibility.
//
// tools/ zone: node:* builtins and contracts/ imports only
// (.dependency-cruiser.cjs tools-zone-closed); run with
// `node --experimental-strip-types` — the locale registry is imported from
// contracts/ui-locales.ts so the shipped set stays defined once.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { COMPLETE_UI_LOCALES, UI_LOCALES } from '../../contracts/ui-locales.ts';
import { loadUiMessagesSource } from '../../contracts/ui-messages/ui-messages.mjs';
import { loadUiMessageTranslations } from '../../contracts/ui-messages/translations.mjs';
import { DOMAINS, run as checkGeneratedOutputs } from './generate-messages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TRANSLATIONS_DIR = 'contracts/ui-messages/translations';
const MIGRATION_KIND = 'migration';

// The (locale → ids) translation requirements the generator's output plan
// actually renders. The plan lives in the generator (DOMAINS) and is imported
// from there — no plan data is restated (implementation-rules 2), and a new
// planned output locale becomes gate-checked the same commit it joins the
// plan. The two selection predicates below (the domain filter and the
// selfNames skip) deliberately mirror buildLocaleTree's rendering decisions;
// a divergence turns the freshness leg or standard_gate_green red on the same
// commit. Records a plan output replaces wholesale (the registry self-names)
// need no translation record — buildLocaleTree renders them from the
// registry, not from the set.
export function plannedTranslationRequirements(sourceDoc) {
  const sourceLocale = sourceDoc.source_locale;
  const required = new Map();
  for (const domain of DOMAINS) {
    const records = sourceDoc.records.filter(
      (record) => typeof record.id === 'string' && record.id.startsWith(`${domain.domain}.`),
    );
    for (const output of domain.outputs) {
      for (const locale of output.locales) {
        if (locale === sourceLocale) continue;
        let ids = required.get(locale);
        if (!ids) required.set(locale, (ids = new Set()));
        for (const record of records) {
          if (output.selfNames && record.id.startsWith(`${output.selfNames}.`)) continue;
          ids.add(record.id);
        }
      }
    }
  }
  return required;
}

function problemReason(err) {
  return err instanceof Error ? err.message : String(err);
}

// The gate over one repository root (the argument is the tests' seam; tooling
// and CI read the shipped tree). Pure over the files: no writes, no network,
// no LLM.
export function checkShippedMessages({ root = ROOT } = {}) {
  const problems = [];
  let sourceDoc;
  try {
    sourceDoc = loadUiMessagesSource(join(root, 'contracts/ui-messages/source.json'));
  } catch (err) {
    problems.push({ rule: 'source_contract', reason: problemReason(err) });
    return { ok: false, problems };
  }
  const sourceLocale = sourceDoc.source_locale;
  const required = plannedTranslationRequirements(sourceDoc);
  const allowedLocales = UI_LOCALES.map((entry) => entry.code);
  for (const locale of COMPLETE_UI_LOCALES) {
    if (locale === sourceLocale) continue;
    const relative = `${TRANSLATIONS_DIR}/${locale}.json`;
    const file = join(root, relative);
    const planned = required.get(locale);
    if (!existsSync(file)) {
      if (planned && planned.size > 0) {
        problems.push({
          rule: 'missing_locale',
          locale,
          reason: `${relative} is missing while the output plan renders ${planned.size} messages for it`,
        });
      }
      continue;
    }
    let set;
    try {
      set = loadUiMessageTranslations(file, sourceDoc, allowedLocales);
    } catch (err) {
      problems.push({ rule: 'translation_contract', locale, reason: problemReason(err) });
      continue;
    }
    const present = new Set(
      set.records.map((record) => record.id).filter((id) => typeof id === 'string'),
    );
    for (const id of planned ?? []) {
      if (!present.has(id)) {
        problems.push({
          rule: 'missing_locale_key',
          locale,
          key: id,
          reason: 'the output plan renders this message for the locale but the translation set has no record for it',
        });
      }
    }
    // The original migration pass speaks through the file-level provenance;
    // any later pass (a source change re-review, G21.19's process) is a
    // deliberate review act and must document itself per record. Hashes alone
    // prove nothing: the same-commit update of criterion 5 carries a reason.
    const renewedPass = set.provenance?.kind !== MIGRATION_KIND;
    for (const record of set.records) {
      const outcome = record.review?.outcome;
      if (outcome !== 'approved') {
        problems.push({
          rule: 'review_evidence_required',
          locale,
          key: record.id,
          reason: `review outcome is ${outcome === undefined ? 'missing' : JSON.stringify(outcome)} — a shipped locale ships approved records only`,
        });
      }
      if (renewedPass && !record.review?.note) {
        problems.push({
          rule: 'review_reason_required',
          locale,
          key: record.id,
          reason: `the review pass (provenance.kind ${JSON.stringify(set.provenance?.kind)}) is not the migration and must give every record its renewed-review reason`,
        });
      }
    }
  }
  if (problems.length === 0) {
    // The generator owns the output plan and the freshness comparison; a
    // contract-clean data set that is not reflected in the generated outputs
    // fails here under the gate's own rule name.
    let verdict;
    try {
      verdict = checkGeneratedOutputs(['--check'], { root, log: () => {}, error: () => {} });
    } catch (err) {
      problems.push({ rule: 'generated_output_stale', reason: problemReason(err) });
      return { ok: false, problems };
    }
    if (verdict.status !== 'fresh') {
      for (const problem of verdict.problems ?? []) {
        problems.push({ rule: 'generated_output_stale', reason: problem });
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

// The standard-runner wiring check: does a repository test script discover a
// suite file? The standard path is `node --test` over the script's glob
// tokens (Node ≥22 expands them itself); the same tokens are matched here
// against the file path — `**/` spans zero or more directories, `*` stays
// within one. The wiring guard's controlled removal case mutates the script
// and watches this answer flip (implementation-rules 1/7).
export function standardRunnerDiscovers(testScript, filePath) {
  return testScript.split(/\s+/).some((token) => {
    const bare = token.replace(/^["']+|["']+$/g, '');
    if (!bare.includes('*')) return bare === filePath;
    const source = bare
      .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
      .replace(/\*\*\//g, '\u0000')
      .replace(/\*\*/g, '\u0001')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '(?:.*/)?')
      .replace(/\u0001/g, '.*');
    return new RegExp(`^${source}$`).test(filePath);
  });
}

export function run(argv = process.argv.slice(2), { root = ROOT, log = console.log, error = console.error } = {}) {
  if (argv.length > 0) {
    error(`check-messages: unknown arguments: ${argv.join(' ')}`);
    return { ok: false, problems: [{ rule: 'usage', reason: 'no arguments expected' }] };
  }
  const verdict = checkShippedMessages({ root });
  if (verdict.ok) {
    log('check-messages: shipped locales complete, reviewed and fresh');
    return verdict;
  }
  for (const problem of verdict.problems) {
    const where = [problem.locale, problem.key].filter(Boolean).join('/');
    error(`check-messages: ${problem.rule}${where ? ` [${where}]` : ''}: ${problem.reason}`);
  }
  error(`check-messages: ${verdict.problems.length} problem(s)`);
  return verdict;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const verdict = run();
  if (!verdict.ok) process.exitCode = 1;
}
