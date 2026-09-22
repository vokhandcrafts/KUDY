// G18.04 — guard for the size guideline in the review rules (issue #167).
// Checks docs/agent-rules/code-review.md keeps the "Size orientation — one phrase, not
// dogma" section with the ≤400-lines / ≤12-public-methods orientation and the one-phrase
// reviewer obligation. Fails if the section is removed or any of those anchors is lost.
// The guideline lives only in code-review.md — this guard pins that single home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RULES = path.join(REPO, 'docs', 'agent-rules', 'code-review.md');

const HEADING = '### Size orientation — one phrase, not dogma';
const ANCHORS = [
  '400',
  '12 public methods',
  'one phrase',
  'orientation, not a gate',
  'next real touch',
];

// Reads the rules file, returns the guideline section body (up to the next heading).
// Throws on a missing file, a missing section, or a lost anchor.
function checkSizeGuideline(filePath = RULES) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`review rules file is missing or unreadable: ${filePath}`);
  }
  const lines = text.split('\n');
  const hits = lines.reduce((n, line) => (line.trim() === HEADING ? n + 1 : n), 0);
  if (hits === 0) {
    throw new Error(`size guideline section is missing from code-review.md: "${HEADING}"`);
  }
  if (hits > 1) {
    throw new Error(`size guideline section appears ${hits} times in code-review.md`);
  }
  const at = lines.findIndex((line) => line.trim() === HEADING);
  const body = [];
  for (let i = at + 1; i < lines.length && !lines[i].startsWith('#'); i++) {
    body.push(lines[i]);
  }
  const bodyText = body.join('\n');
  for (const anchor of ANCHORS) {
    if (!bodyText.includes(anchor)) {
      throw new Error(`size guideline lost its anchor "${anchor}" — the requirement or its orientation wording was removed`);
    }
  }
  return bodyText;
}

// Writes a mutated copy of the rules file to a temp path and runs the guard on it.
function checkMutated(mutate) {
  const text = mutate(fs.readFileSync(RULES, 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g1804-'));
  try {
    const copy = path.join(dir, 'code-review.md');
    fs.writeFileSync(copy, text);
    return checkSizeGuideline(copy);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the real review rules pass the size-guideline guard', () => {
  const body = checkSizeGuideline(RULES);
  assert.ok(body.trim().length > 0, 'guideline section body is non-empty');
});

test('the guard fails when the rules file is removed', () => {
  assert.throws(() => checkSizeGuideline(path.join(REPO, 'docs', 'agent-rules', 'code-review-missing.md')),
    /missing or unreadable/);
});

test('the guard fails when the guideline section is removed', () => {
  const withoutSection = (t) => t.replace(`${HEADING}\n\nA file over ~400 lines or a contract with more than ~12 public methods obliges the\nreviewer to write one phrase answering a single question: is there a second owner or\na contract asking to be extracted? The numbers are orientation, not a gate — no CI\ncheck enforces them and nothing is refactored for the count's sake; the assessment\nhappens on the next real touch of the file.\n\n`, '');
  assert.throws(() => checkMutated(withoutSection), /size guideline section is missing/);
});

test('the guard fails when an anchor of the guideline is lost', () => {
  assert.throws(() => checkMutated((t) => t.replace('more than ~12 public methods', 'more than a dozen public methods')),
    /lost its anchor "12 public methods"/);
  assert.throws(() => checkMutated((t) => t.split('400').join('four hundred')),
    /lost its anchor "400"/);
  assert.throws(() => checkMutated((t) => t.replace('orientation, not a gate', 'orientation; not a gate')),
    /lost its anchor "orientation, not a gate"/);
});
