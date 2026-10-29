// MAP-05 (#883): pin the proposal to actual routes, localization keys,
// the approved theme canon, and the existing npm-test glob (test/*.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrast } from './wcag-contrast.mjs';
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

function themeVars(theme) {
  const css = specimen.match(new RegExp('section\\.theme\\[data-theme="' + theme + '"\\]\\s*\\{([^}]+)\\}'))?.[1];
  assert.ok(css, theme + ' theme token block exists');
  return Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[a-f0-9]{6})/gi)]
    .map(([, key, value]) => [key, value.toLowerCase()]));
}

test('menu specimen documents only the actual routes and existing localization keys', () => {
  const entries = [...specimen.matchAll(/<tr data-key="([^"]+)" data-path="([^"]+)"/g)]
    .map(([, key, path]) => ({ key, path }));
  assert.deepEqual(entries, [
    ...nav.map(({ key, path }) => ({ key, path })),
    { key: 'pending:880', path: 'none' },
  ]);
  assert.equal(guideCard.match(/ACTIVE_CITY_ID = "([^"]+)"/)?.[1], 'gdansk');
  assert.ok(guideCard.includes('/city/' + String.fromCharCode(36) + '{ACTIVE_CITY_ID}/guides'));
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
  const mappings = {
    paper: 'color.paper', card: 'color.card', ink: 'color.ink',
    muted: 'color.muted', line: 'color.line', accent: 'color.accent',
    'accent-ink': 'color.accent-ink', 'disabled-ink': 'color.disabled-ink',
    'disabled-line': 'color.disabled-line',
  };
  for (const theme of ['light', 'dark']) {
    const vars = themeVars(theme);
    for (const [name, token] of Object.entries(mappings)) {
      const expected = theme === 'dark' ? canon.darkTheme.tokens[token] ?? canon.tokens[token].value : canon.tokens[token].value;
      assert.equal(vars[name], expected.toLowerCase(), theme + ': ' + token);
    }
    assert.ok(contrast(vars.ink, vars.card) >= 4.5, theme + ': regular label');
    assert.ok(contrast(vars['disabled-ink'], vars.card) >= 4.5, theme + ': disabled label');
    assert.ok(contrast(vars['accent-ink'], vars.accent) >= 4.5, theme + ': pressed label');
    assert.ok(contrast(vars.accent, vars.paper) >= 3, theme + ': highlight outline');
    assert.ok(contrast(vars['disabled-line'], vars.paper) >= 3, theme + ': disabled border');
  }
});
