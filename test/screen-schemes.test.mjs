// G06.06 guard: the canonical screen-scheme doc must cover the G06.08 screen
// package verbatim — same screen set, every screen with a cited transition
// map (Back/«Прагулка»), and a filled state-coverage row. Fails if a screen
// or state family is dropped from docs/design/screens-and-transitions.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageScreensPath = join(root, 'spikes/G06.08-prototype/package/screens.md');
const schemesPath = join(root, 'docs/design/screens-and-transitions.md');

const NAV = /NAV\d+/;
const CANON = /ADR G01\.\d|§\s?\d|раздзел \d/;

function sectionsByHeading(text, marker) {
  const matches = [...text.matchAll(new RegExp(`^${marker} (.+)$`, 'gm'))];
  return matches.map((m, i) => ({
    heading: m[1].trim(),
    body: text.slice(m.index, i + 1 < matches.length ? matches[i + 1].index : text.length),
  }));
}

test('scheme doc covers exactly the screens of the G06.08 package', () => {
  const packageScreens = sectionsByHeading(readFileSync(packageScreensPath, 'utf8'), '##')
    .map((s) => s.heading)
    .filter((h) => h !== 'Shared rules (all screens)');
  const schemeScreens = sectionsByHeading(readFileSync(schemesPath, 'utf8'), '###').map(
    (s) => s.heading
  );

  const missing = packageScreens.filter((h) => !schemeScreens.includes(h));
  const extra = schemeScreens.filter((h) => !packageScreens.includes(h));
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    'screens-and-transitions.md must name the package screens verbatim: ' +
      'missing sections fail coverage, extra sections drift from the package'
  );
});

test('every screen scheme has a cited transition map with a Back/«Прагулка» return', () => {
  const schemeSections = sectionsByHeading(readFileSync(schemesPath, 'utf8'), '###');
  for (const { heading, body } of schemeSections) {
    const transitions = body.split('**Пераходы:**')[1];
    assert.ok(transitions, `${heading}: missing a «Пераходы» block`);
    assert.match(
      transitions,
      NAV,
      `${heading}: transitions must cite NAV1–NAV11 (11 §16.9)`
    );
    assert.match(
      transitions,
      CANON,
      `${heading}: transitions must cite an ADR or a canonical section`
    );
    assert.match(
      transitions,
      /Back|Прагулк/,
      `${heading}: the Back/surface-source mapping (or the «Прагулка» return) must be stated`
    );
  }
});

test('state-coverage table has a non-empty row per screen', () => {
  const doc = readFileSync(schemesPath, 'utf8');
  const tablePart = doc.split('## Кантроль покрыцця станаў')[1];
  assert.ok(tablePart, 'missing the «Кантроль покрыцця станаў» section');

  const rows = tablePart
    .split('## ')[0]
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  const dataRows = rows.filter(
    (cells) => cells.length === 5 && cells[0] !== 'Экран' && !cells.every((c) => /^-+$/.test(c))
  );

  const packageScreens = sectionsByHeading(readFileSync(packageScreensPath, 'utf8'), '##')
    .map((s) => s.heading)
    .filter((h) => h !== 'Shared rules (all screens)');
  const rowScreens = dataRows.map((cells) => cells[0]);
  assert.deepEqual(
    rowScreens,
    packageScreens,
    'coverage table must have exactly one row per package screen, in package order'
  );
  for (const cells of dataRows) {
    for (const [i, cell] of cells.entries()) {
      assert.ok(
        cell.length > 0,
        `${cells[0]}: state-family column ${i} is empty — a family is either named with its canonical state or refused with a reason`
      );
    }
  }
});
