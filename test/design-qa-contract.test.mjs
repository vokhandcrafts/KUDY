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
    assert.match(body, /not (?:run|in) CI/i);
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
