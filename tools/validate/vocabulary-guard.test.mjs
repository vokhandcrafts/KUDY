// G18.02 — structural guard for the domain vocabulary (issue #165).
// Checks docs/architecture/25_domain_vocabulary.md: exactly one vocabulary table whose
// header is Тэрмін / Азначэнне / Крыніца / _Avoid_, and every row keeps a term, a
// definition, exactly one canonical source link that resolves on disk, and a non-empty
// _Avoid_ cell. Fails when the file is removed or any of those cells is lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const VOCAB = path.join(REPO, 'docs', 'architecture', '25_domain_vocabulary.md');
const VOCAB_DIR = path.dirname(VOCAB);

const HEADER = '| Тэрмін | Азначэнне | Крыніца | _Avoid_ |';
const LINK_FIND = /\[[^\]]*\]\(([^)\s]+)\)/g;
const LINK_HAS = /\[[^\]]*\]\([^)\s]+\)/;

// Reads the vocabulary file and returns its table rows as {term, definition, source, avoid}.
// Links resolve relative to baseDir (the file's own directory unless overridden).
// Throws on a missing file, a missing or duplicated table header, or any malformed row.
function checkVocabulary(filePath, baseDir = path.dirname(filePath)) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`vocabulary file is missing or unreadable: ${filePath}`);
  }
  const lines = text.split('\n');
  const headers = [];
  lines.forEach((line, i) => {
    if (line.trim() === HEADER) headers.push(i);
  });
  if (headers.length !== 1) {
    throw new Error(`expected exactly one vocabulary table header "${HEADER}", found ${headers.length}`);
  }
  if (!/^[\s|:-]+$/.test(lines[headers[0] + 1] ?? '')) {
    throw new Error('table separator row is missing right after the vocabulary header');
  }
  const rows = [];
  for (let i = headers[0] + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const line = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = line.split('|').map((cell) => cell.trim());
    const [term, definition, source, avoid] = cells;
    const where = `row ${rows.length + 1} (line ${i + 1}, term "${term ?? ''}")`;
    if (cells.length !== 4) {
      throw new Error(`${where}: expected 4 cells (term/definition/source/avoid), found ${cells.length}`);
    }
    if (!term || !definition) {
      throw new Error(`${where}: term and definition cells must be non-empty`);
    }
    const links = [...source.matchAll(LINK_FIND)].map((match) => match[1]);
    if (links.length !== 1) {
      throw new Error(`${where}: source cell must carry exactly one canonical link, found ${links.length}`);
    }
    for (const cell of [term, definition, avoid]) {
      if (LINK_HAS.test(cell)) {
        throw new Error(`${where}: only the source cell may contain a link`);
      }
    }
    const target = links[0].split('#')[0];
    if (!target || !fs.existsSync(path.resolve(baseDir, target))) {
      throw new Error(`${where}: source link "${links[0]}" does not resolve on disk`);
    }
    if (!avoid) {
      throw new Error(`${where}: _Avoid_ cell must be non-empty`);
    }
    rows.push({ term, definition, source, avoid });
  }
  if (rows.length === 0) {
    throw new Error('the vocabulary table has no data rows');
  }
  return rows;
}

// Writes a mutated copy of the real vocabulary file to a temp path and runs the guard on
// it. baseDir stays at the real docs/architecture/ so untouched rows still resolve their
// canon links and only the injected defect can fail the check.
function checkMutated(mutate) {
  const text = mutate(fs.readFileSync(VOCAB, 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g1802-'));
  const copy = path.join(dir, '25_domain_vocabulary.md');
  fs.writeFileSync(copy, text);
  return checkVocabulary(copy, VOCAB_DIR);
}

test('the real vocabulary file passes the structural guard', () => {
  const rows = checkVocabulary(VOCAB);
  assert.ok(rows.length > 0, 'vocabulary table parsed rows');
});

test('the guard fails when the file is removed', () => {
  assert.throws(() => checkVocabulary(path.join(REPO, 'docs', 'architecture', '25_does_not_exist.md')),
    /missing or unreadable/);
});

test('the guard fails when the table header or separator is lost or duplicated', () => {
  assert.throws(() => checkMutated((t) => t.replace(HEADER, '| Тэрмін | Азначэнне | Крыніца | Пазбегаць |')),
    /expected exactly one vocabulary table header/);
  const withoutHeader = (t) => t.replace(HEADER + '\n', '');
  assert.throws(() => checkMutated(withoutHeader), /expected exactly one vocabulary table header/);
});

test('the guard fails when a row loses its source link', () => {
  const noLink = (t) => t.replace(/\[09 §3\]\(09_technical_architecture\.md\)/, '09 §3 без спасылкі');
  assert.throws(() => checkMutated(noLink), /exactly one canonical link, found 0/);
});

test('the guard fails when a row carries two source links', () => {
  const twoLinks = (t) => t.replace(
    /\[09 §3\]\(09_technical_architecture\.md\)/,
    '[09 §3](09_technical_architecture.md) і [19](19_class_and_module_map.md)');
  assert.throws(() => checkMutated(twoLinks), /exactly one canonical link, found 2/);
});

test('the guard fails when a source link does not resolve on disk', () => {
  const deadLink = (t) => t.replace('09_technical_architecture.md', '09_nonexistent_file.md');
  assert.throws(() => checkMutated(deadLink), /does not resolve on disk/);
});

test('the guard fails when a row loses its _Avoid_ cell', () => {
  const noAvoid = (t) => t.replace(
    /\| адна назва на ўсе мовы; апісанне або назва ўбудаваная ў месца\. \|/, '|  |');
  assert.throws(() => checkMutated(noAvoid), /row 1/);
  const noAvoidSecondForm = (t) => t.replace(
    '| адна назва на ўсе мовы; апісанне або назва ўбудаваная ў месца. |', '| |');
  assert.throws(() => checkMutated(noAvoidSecondForm), /_Avoid_ cell must be non-empty/);
});

test('the guard fails when a row loses its term or definition cell', () => {
  const noTerm = (t) => t.replace(
    /\| `Place` \(месца\) \|/, '|  |');
  assert.throws(() => checkMutated(noTerm), /term and definition cells must be non-empty/);
});

test('the guard passes when a row re-points its link to another existing canon doc', () => {
  const rows = checkMutated((t) => t.replace('[09 §3](09_technical_architecture.md)',
    '[19 §2.1](19_class_and_module_map.md)'));
  assert.ok(rows[0].source.includes('19_class_and_module_map.md'));
});
