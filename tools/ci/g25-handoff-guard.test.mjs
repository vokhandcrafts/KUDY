import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const paths = {
  card: 'docs/agent-tasks/brand-design/G25.08.md',
  index: 'docs/agent-tasks/brand-design/README.md',
  skeleton: 'docs/agent-tasks/brand-skeleton/README.md',
};

const sources = {
  card: read(paths.card),
  index: read(paths.index),
  skeleton: read(paths.skeleton),
};

const refs = (text) => [...text.matchAll(/#\d+/g)].map((match) => match[0]).sort();

function assertHandoffGate({ card, index, skeleton }) {
  const blockedBy = card.match(/^Blocked-by:\s*([^\r\n]+)$/m);
  assert.ok(blockedBy, 'G25.08 task card must name its Blocked-by prerequisites');

  const taskRow = index.split(/\r?\n/).find((line) => line.startsWith('| [G25.08](G25.08.md) |'));
  assert.ok(taskRow, 'G25 index must contain the G25.08 task row');
  const indexDeps = taskRow.split('|').at(-2);
  assert.ok(indexDeps, 'G25.08 task row must retain a dependency cell');

  assert.deepEqual(refs(indexDeps), refs(blockedBy[1]), 'G25.08 index and task card blockers differ');
  assert.ok(refs(blockedBy[1]).includes('#778'), 'G26.14 (#778) must block G25.08');

  // These assertions specifically catch reverting PR #843's prose while the
  // pre-existing #778 dependency remains present in the card and task row.
  assert.match(
    card,
    /The G26\.14 prerequisite \(#778\) is a hard start gate: do not claim G25\.08 or publish its final implementation handoff while #778 is open/,
    'G25.08 card must forbid starting before G26.14 closes',
  );
  assert.match(
    index,
    /G25\.08 \/ #708 нельга браць у працу або перадаваць у распрацоўку да закрыцця G26\.14 \/ #778/,
    'G25 index must forbid early handoff',
  );
  assert.match(
    skeleton,
    /Толькі пасля закрыцця \[G26\.14 \/ #778\]\([^)]+\) можна браць \[G25\.08 \/ #708\]/,
    'G26 index must require a closed G26.14 before claiming G25.08',
  );
}

const without = (content, match) => {
  assert.match(content, match, 'the fixture must contain the original gate');
  return content.replace(match, '');
};

test('G25.08 blockers and both task indices preserve the G26.14 start gate', () => {
  assertHandoffGate(sources);
});

test('guard rejects deleting the #778 card prerequisite', () => {
  const card = without(sources.card, /, #778(?=\r?\n)/);
  assert.throws(() => assertHandoffGate({ ...sources, card }), assert.AssertionError);
});

test('guard rejects deleting the #778 G25 index prerequisite', () => {
  const index = without(sources.index, /, #778 \(G26\.14\)(?= \|)/);
  assert.throws(() => assertHandoffGate({ ...sources, index }), assert.AssertionError);
});

test('guard rejects reverting the task-card hard-gate sentence', () => {
  const card = without(sources.card, /^The G26\.14 prerequisite .*$/m);
  assert.throws(() => assertHandoffGate({ ...sources, card }), assert.AssertionError);
});

test('guard rejects reverting the G25 index no-early-handoff sentence', () => {
  const index = without(sources.index, /\*\*G25\.08 \/ #708 нельга[^*]+\*\*/);
  assert.throws(() => assertHandoffGate({ ...sources, index }), assert.AssertionError);
});

test('guard rejects reverting the G26 index no-early-handoff sentence', () => {
  const skeleton = without(sources.skeleton, /Толькі пасля закрыцця \[G26\.14 \/ #778\].*?ў распрацоўку\./);
  assert.throws(() => assertHandoffGate({ ...sources, skeleton }), assert.AssertionError);
});
