// G18.05 step c — counts out of prose (issue #200, criterion 3). Docs outside
// agent-tasks/results carry no test/module counts in prose: the reader runs the
// producing command (npm test, npm run arch:check) instead of a number that rots
// at the next merge. A count inside a results file or inside a captured ```output
// block of a demo is a dated historical record and stays. The repo walk below is
// what makes npm test fail when a count is re-added to prose
// (implementation-rules §1 and the §13 G18.05 extension).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DOCS = path.join(REPO, 'docs');
const RESULTS = path.join(DOCS, 'agent-tasks', 'results');

// Same pattern the G18.05 gate fixes: `git grep -E "[0-9]+ pass|[0-9]+ modules"`.
// Global: findCounts reports every occurrence on a line via matchAll.
const COUNT = /[0-9]+ (pass|modules)/g;

// Blanks the lines inside fenced blocks tagged `output` while keeping line
// numbers, so a captured command output (dated evidence, like a results file)
// is exempt and everything around it stays scanned.
function stripCapturedOutput(text) {
  const out = [];
  let captured = false;
  for (const line of text.split(/\r?\n/)) {
    if (captured) {
      if (/^```\s*$/.test(line)) captured = false;
      out.push('');
    } else {
      if (/^```output\b/.test(line)) captured = true;
      out.push(line);
    }
  }
  return out.join('\n');
}

function findCounts(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const match of line.matchAll(COUNT)) {
      hits.push({ line: i + 1, match: match[0] });
    }
  });
  return hits;
}

function listMarkdown(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (path.resolve(dir, entry.name) === RESULTS) continue;
      files.push(...listMarkdown(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.md')) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

test('docs prose carries no test/module counts outside captured output and results', () => {
  const violations = [];
  for (const file of listMarkdown(DOCS)) {
    const text = stripCapturedOutput(fs.readFileSync(file, 'utf8'));
    for (const hit of findCounts(text)) {
      violations.push(`${path.relative(REPO, file)}:${hit.line}: "${hit.match}"`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    'hard-coded counts in prose — replace with the producing command, or move the dated count into a results file / captured output block',
  );
});

test('the guard flags a count in prose and names the line', () => {
  assert.deepEqual(findCounts('зялёны прагон: 572 pass / 0 fail\n'), [
    { line: 1, match: '572 pass' },
  ]);
  assert.deepEqual(findCounts('scan 115 → 120 modules\n'), [
    { line: 1, match: '120 modules' },
  ]);
});

test('a count inside a captured output block is dated evidence and stays', () => {
  const text = [
    '```sh',
    'npm run arch:check',
    '```',
    '',
    '```output',
    'arch:check: OK — 120 modules cruised, 6 violation(s) pass via the baseline',
    '```',
    '',
  ].join('\n');
  assert.deepEqual(findCounts(stripCapturedOutput(text)), []);
});

test('prose after a captured block is scanned again, with line numbers kept', () => {
  const text = ['```output', '9 passed, 9 total', '```', 'Suites: 3 pass', ''].join('\n');
  assert.deepEqual(findCounts(stripCapturedOutput(text)), [{ line: 4, match: '3 pass' }]);
});
