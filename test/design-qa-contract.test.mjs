import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('both agent entrypoints require on-request and pre-closure UI review outside CI', () => {
  for (const entry of ['AGENTS.md', 'CLAUDE.md']) {
    const body = read(entry);
    assert.match(body, /docs\/agent-rules\/design-qa\.md/);
    assert.match(body, /on request/i);
    assert.match(body, /before closing.*interface/i);
    assert.match(body, /not (?:run )?in CI/i);
    assert.match(body, /no (?:model )?API key/i);
  }
});

test('design-QA rules keep evidence, second-pass rejection and accepted exceptions', () => {
  const rules = read('docs/agent-rules/design-qa.md');
  const exceptions = read('docs/design-qa/exceptions.md');
  for (const kind of ['RULE', 'DIFF', 'OPINION', 'NOT-VERIFIED']) {
    assert.match(rules, new RegExp('\\b' + kind + '\\b'));
  }
  assert.match(rules, /refuting second pass/i);
  assert.match(rules, /at most 3 per report/i);
  assert.match(rules, /48 dp.*OPINION/i);
  assert.match(rules, /accepted.*rule/i);
  assert.match(rules, /drop the RULE/i);
  for (const exception of ['DT-4', 'DT-6', 'hitSlop', 'color.muted']) {
    assert.ok(exceptions.includes(exception), 'missing exception: ' + exception);
  }
});

test('design-QA contract pins the rule elements its guard cites', () => {
  // Verbatim pins: each assertion fails on one judge mutation (issue #937)
  // that silently reverted a contract element while path-anywhere matches
  // stayed green. No end-of-line anchors: checkouts may hold CRLF bytes.
  const claude = read('CLAUDE.md');
  assert.match(claude, /^@docs\/agent-rules\/design-qa\.md/m);

  const rules = read('docs/agent-rules/design-qa.md');
  assert.match(rules, /Drafts, mockups, proposals, and unmerged changes are \*\*not\*\* rules\./);
  assert.match(
    rules,
    /\| RULE \| Exact accepted source\/section or decision ID \*\*and\*\* concrete measured evidence or reproducible artifact showing its violation \| Blocks design-QA green \|/,
  );
  assert.match(
    rules,
    /A RULE without either a cited \*\*accepted\*\* rule or evidence must be dropped or reclassified as a nonblocking suggestion where useful\./,
  );
  assert.match(rules, /^## Required report/m);
  assert.match(rules, /^- Verdict: RULE_BLOCKED \/ OWNER_DIFF_REVIEW \/ NO_VERIFIED_RULE \/ INSUFFICIENT_EVIDENCE/m);
  assert.match(
    rules,
    /\*\*surface\/state \| approved baseline \| current PNG \| difference PNG \| region\/threshold \| owner verdict\*\*/,
  );
  for (const field of [
    '[RULE] surface / state / theme / font / locale',
    'Accepted rule: file §section or accepted decision ID',
    'Evidence: artifact/command and observed measurement',
    'Expected: canonical measurable condition',
    'Reproduce: executable check or source of evidence',
    '[DIFF] surface; three artifact links; observed region; owner verdict pending',
    '[OPINION] suggestion; reason not in canon',
    '[NOT-VERIFIED] scope; missing input; what evidence is needed',
  ]) {
    assert.ok(rules.includes(field), 'missing report field: ' + field);
  }
  assert.match(rules, /second-pass rejected candidates/i);
});

test('design-QA first pass carries the spec 6.2 story-capture and canon-entry check', () => {
  // Verbatim pins: each assertion fails when a §6.2 check silently leaves the
  // first pass (issue #939). No end-of-line anchors: checkouts may hold CRLF bytes.
  const spec = read('docs/specifications/design-qa/2026-10-30-design-qa-system.md');
  const canon =
    "Кожная гісторыя (стан) мае здымак; новы стан не з'яўляецца без запісу ў каноне";
  assert.ok(spec.includes(canon), 'spec §6.2 canon line drifted');
  const rules = read('docs/agent-rules/design-qa.md');
  assert.ok(rules.includes(canon), 'first pass no longer quotes the §6.2 canon line');
  assert.match(rules, /A state without a capture is \*\*NOT-VERIFIED\*\*/);
  assert.match(rules, /a new state without a canon entry is reported for owner review/);
});
