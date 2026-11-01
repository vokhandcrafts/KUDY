// MAP-05 (#883): pin the proposal to actual routes, localization keys,
// the approved theme canon, and the existing npm-test glob (test/*.test.mjs).
// DQ-12 (#922): the canon colors, contrast pairs and state names run through
// the shared mockup preflight (test/mockup-preflight.mjs); the structural
// pins below stay MAP-05-specific.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMockup, formatFindings } from './mockup-preflight.mjs';
import { loadCanon } from './design-canon.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const specimen = read('docs/design/brand/outputs/MAP-05/specimen.html');
const explore = read('app/(tabs)/explore.tsx');
const guideCard = read('components/guide-card.tsx');
const strings = JSON.parse(read('contracts/ui-messages/source.json')).records;
const canon = loadCanon();

const nav = [
  { key: 'native.chrome.guidesLink', path: '/city/gdansk/guides', property: 'guidesLink' },
  { key: 'native.chrome.nearby', path: '/map', property: 'nearby' },
  { key: 'native.chrome.whatToDo', path: '/discovery', property: 'whatToDo' },
  { key: 'native.chrome.kudyLink', path: '/my', property: 'kudyLink' },
];
const states = ['enabled', 'pressed', 'dragging', 'snapped', 'disabled'];

test('menu specimen documents only the actual routes and existing localization keys', () => {
  const entries = [...specimen.matchAll(/<tr data-key="([^"]+)" data-path="([^"]+)"/g)]
    .map(([, key, path]) => ({ key, path }));
  assert.deepEqual(entries, [
    ...nav.map(({ key, path }) => ({ key, path })),
    { key: 'pending:880', path: 'none' },
  ]);
  assert.equal(guideCard.match(/ACTIVE_CITY_ID = "([^"]+)"/)?.[1], 'gdansk');
  assert.ok(guideCard.includes('/city/${ACTIVE_CITY_ID}/guides'));
  assert.ok(guideCard.includes('uiStrings(locale).guidesLink'));
  for (const { key, path, property } of nav) {
    assert.ok(strings.some((entry) => entry.id === key), key + ' must exist in the canonical catalog');
    assert.ok(specimen.includes(key), key + ' must be documented');
    if (property !== 'guidesLink') {
      assert.ok(explore.includes('href="' + path + '" label={strings.' + property + '}'), path + ' must be live');
    }
  }
  assert.ok(specimen.includes('native.chrome.walk'));
  assert.ok(!specimen.includes('href="/soon"'), 'no invented child route');
});

test('both themes show all required states, textual cues and fallback specimens', () => {
  for (const theme of ['light', 'dark']) {
    const block = specimen.match(new RegExp('<section class="theme" data-theme="' + theme + '"[\\s\\S]*?<\\/section>'))?.[0];
    assert.ok(block, theme + ' must have a full preview');
    const rendered = [...block.matchAll(/data-state="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(rendered, states);
    assert.match(block, /Яшчэ недаступна · можна перамясціць/);
    assert.match(block, /Перамяшчэнне/);
    assert.match(block, /Злучана з суседам/);
  }
  assert.match(specimen, /Без іконкі і без drag/);
  assert.match(specimen, /class="words long"/);
  assert.match(specimen, /:focus-visible/);
  assert.match(specimen, /Future-only focus proposal: static fragments are not keyboard-focusable/);
  assert.match(specimen, /Статычныя фрагменты не даступныя праз Tab/);
  assert.match(specimen, /prefers-reduced-motion: reduce/);
});

test('light/dark specimen colors match canon and clear contrast thresholds', () => {
  const findings = checkMockup(specimen, {
    label: 'MAP-05 specimen',
    canon,
    strings,
    themes: ['light', 'dark'],
    mappings: {
      paper: 'color.paper', card: 'color.card', ink: 'color.ink',
      muted: 'color.muted', line: 'color.line', accent: 'color.accent',
      'accent-ink': 'color.accent-ink', 'disabled-ink': 'color.disabled-ink',
      'disabled-line': 'color.disabled-line',
    },
    contrastPairs: [
      { fg: 'ink', bg: 'card', why: 'regular label' },
      { fg: 'disabled-ink', bg: 'card', why: 'disabled label' },
      { fg: 'accent-ink', bg: 'accent', why: 'pressed label' },
      { fg: 'accent', bg: 'paper', min: 3, why: 'highlight outline' },
      { fg: 'disabled-line', bg: 'paper', min: 3, why: 'disabled border' },
    ],
    states,
    keys: nav.map(({ key }) => key),
  });
  assert.deepEqual(findings, [], formatFindings(findings));
});
