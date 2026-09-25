// G06.07 guard: docs/design/visual-language.md is the single source of visual
// values. The canon token block must be complete (every token has a value and
// a use), every contrast pair must hold at WCAG 1.4.3/1.4.11 thresholds, every
// :root custom property of the prototype CSS must resolve to a canon token
// (overrides recorded with a reason), state names must stay verbatim with
// their canonical sources, and the suite itself must stay wired into npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const canonPath = join(root, 'docs/design/visual-language.md');
const cssPath = join(root, 'spikes/G06.08-prototype/prototype/styles.css');
const packageScreensPath = join(root, 'spikes/G06.08-prototype/package/screens.md');
const schemesPath = join(root, 'docs/design/screens-and-transitions.md');
const adrMarkersPath = join(root, 'docs/architecture/decisions/G01.01-narration-progress.md');
const brandPath = join(root, 'docs/06_brand_and_promotion.md');

function loadCanon() {
  const doc = readFileSync(canonPath, 'utf8');
  const fenced = doc.split('```json')[1];
  assert.ok(fenced, 'visual-language.md must contain the machine token block (```json)');
  const raw = fenced.split('```')[0];
  try {
    return JSON.parse(raw);
  } catch (error) {
    assert.fail(`canon token block is not valid JSON: ${error.message}`);
  }
}

function loadRootVars(css) {
  const start = css.indexOf(':root {');
  assert.ok(start !== -1, 'prototype styles.css must keep a :root token block');
  const end = css.indexOf('}', start);
  const body = css.slice(start, end);
  const vars = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

// WCAG 2.x relative luminance and contrast ratio (1.4.3 text, 1.4.11 objects).
function luminance(hex) {
  const c = hex.replace('#', '');
  assert.match(hex, /^#[0-9a-f]{6}$/i, `contrast helper expects #rrggbb, got ${hex}`);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fgHex, bgHex) {
  const [l1, l2] = [luminance(fgHex), luminance(bgHex)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

function sectionAfter(text, marker) {
  const start = text.indexOf(marker);
  assert.ok(start !== -1, `expected section marker ${marker} in its source file`);
  return text.slice(start);
}

const canon = loadCanon();
const css = readFileSync(cssPath, 'utf8');
const rootVars = loadRootVars(css);

test('every canon token has a non-empty value and a use rule', () => {
  const entries = Object.entries(canon.tokens);
  assert.ok(entries.length > 0, 'canon token block must not be empty');
  for (const [name, token] of entries) {
    assert.ok(token && typeof token === 'object', `${name}: token must be an object`);
    assert.ok(typeof token.value === 'string' && token.value.trim() !== '', `${name}: missing value`);
    assert.ok(typeof token.use === 'string' && token.use.trim() !== '', `${name}: missing use rule`);
  }
  for (const key of ['color.paper', 'color.ink', 'color.accent', 'font.family', 'radius.base', 'space.m']) {
    assert.ok(canon.tokens[key], `canon must fix the ${key} token`);
  }
});

test('canon fixes the component inventory: three card kinds, buttons, panel, dragon, scale', () => {
  assert.deepEqual(canon.cardKinds, ['base', 'hint', 'moment'], 'exactly three card kinds');
  for (const doc of ['Карткі', 'Кнопкі і чыпы', 'Панэль Run', 'Маркеры мапы', 'Дракон', 'Шкала ацэнак', 'Назвы станаў', 'Чытэльнасць']) {
    assert.match(readFileSync(canonPath, 'utf8'), new RegExp(`^#+ .*${doc}`, 'm'), `canon must have a «${doc}» section`);
  }
  assert.ok(canon.tokens['color.hint.bg'] && canon.tokens['color.moment.bg'], 'hint and moment card kinds need their color tokens');
});

test('every declared contrast pair holds at its WCAG threshold', () => {
  assert.ok(canon.contrastPairs.length >= 12, 'text and non-text pairs must both be declared');
  for (const [i, pair] of canon.contrastPairs.entries()) {
    const fg = canon.tokens[pair.fg];
    const bg = canon.tokens[pair.bg];
    assert.ok(fg && bg, `pair ${i}: ${pair.fg}/${pair.bg} must reference defined tokens`);
    const ratio = contrast(fg.value, bg.value);
    assert.ok(
      ratio >= pair.min,
      `${pair.fg} ${fg.value} on ${pair.bg} ${bg.value}: ${ratio.toFixed(2)}:1 < ${pair.min}:1`
    );
  }
});

test('big-text mode reaches the a11y floor of 1.2× the base size', () => {
  const base = parseFloat(canon.tokens[canon.bigText.baseToken].value);
  const factor = parseFloat(canon.tokens[canon.bigText.factorToken].value);
  assert.ok(factor >= 1.2, `big-text factor ${factor} must be ≥ 1.2 (a11y floor in screens.md)`);
  const resolved = `${base * factor}px`;
  assert.equal(canon.bigText.cssValue, resolved, 'bigText.cssValue must equal base × factor');
  const rule = css.match(/\.big-text\s*{[^}]*}/);
  assert.ok(rule, 'prototype styles.css must keep the .big-text rule');
  assert.match(rule[0], new RegExp(`font-size:\\s*${canon.bigText.cssValue.replace('.', '\\.')}`),
    `.big-text must render the canon value ${canon.bigText.cssValue}`);
});

test('rating scale is 1–5, reachable, without default and without public average', () => {
  assert.equal(canon.ratingScale.min, 1);
  assert.equal(canon.ratingScale.max, 5);
  assert.equal(canon.ratingScale.default, null, 'no preselected score (20 §7)');
  assert.equal(canon.ratingScale.publicAverage, false, 'no public average in MVP (20)');
  assert.ok(canon.tokens['size.scale-button'], 'scale button size must be a canon token');
  assert.match(css, /\.fb-scale button\[aria-pressed="true"\]/, 'the chosen score must be visible as pressed state');
});

test('marker names stay verbatim with ADR G01.01 §4.5', () => {
  const adr = readFileSync(adrMarkersPath, 'utf8');
  const section = sectionAfter(adr, '### 4.5');
  const fromAdr = [...section.matchAll(/^\| `([a-z]+)` \|/gm)].map((m) => m[1]);
  assert.ok(fromAdr.length > 0, 'ADR G01.01 §4.5 marker table must be parseable');
  assert.deepEqual(canon.markers, fromAdr, 'canon marker list must equal the ADR list in order');
  for (const marker of canon.markers) {
    assert.ok(canon.tokens[`color.marker.${marker}`], `marker ${marker} needs its color token`);
  }
});

test('state family, delivery and session names stay verbatim with their sources', () => {
  const schemes = readFileSync(schemesPath, 'utf8');
  const families = [...schemes.matchAll(/\*\*(Пусты|Offline|Denied|Error)\*\*/g)].map((m) => m[1]);
  assert.ok(families.length > 0, 'G06.06 scheme doc must declare the four state families');
  assert.deepEqual(canon.stateFamilies, families, 'canon families must equal the G06.06 families in order');

  const screens = readFileSync(packageScreensPath, 'utf8');
  const myKudy = sectionAfter(screens, '## My KUDY').split('\n## ')[0];
  for (const state of canon.sessionStates) {
    assert.ok(myKudy.includes(state), `session state ${state} must exist in screens.md My KUDY`);
  }
  for (const state of canon.deliveryStates) {
    assert.ok(myKudy.includes(`\`${state}\``) || myKudy.includes(state),
      `delivery state ${state} must exist verbatim in screens.md My KUDY (21 §5.4)`);
  }
  assert.match(myKudy, /`draft → pending → sending → sent`/, 'delivery chain must be quoted verbatim');
});

test('dragon states stay verbatim with doc 06 §1', () => {
  const brand = readFileSync(brandPath, 'utf8');
  const m = brand.match(/станаў дракона \(([^)]+)\)/);
  assert.ok(m, 'doc 06 §1 must name the dragon state set');
  const fromBrand = m[1].split('/').map((s) => s.trim());
  assert.deepEqual(canon.dragonStates, fromBrand, 'canon dragon states must equal doc 06 §1');
});

test('every prototype :root token maps to the canon; overrides are recorded with a reason', () => {
  const map = canon.supersession;
  assert.ok(map && typeof map === 'object', 'canon must carry a supersession map');
  for (const [name, value] of Object.entries(rootVars)) {
    const entry = map[name];
    assert.ok(entry, `${name}: draft token is not covered by the canon supersession map`);
    const token = canon.tokens[entry.token];
    assert.ok(token, `${name}: mapped token ${entry.token} must exist`);
    assert.equal(value, token.value, `${name}: CSS value must equal canon ${entry.token}`);
    if (entry.override) {
      assert.ok(entry.reason && entry.reason.trim() !== '', `${name}: override needs a reason`);
      assert.ok(entry.draftValue && entry.draftValue !== token.value,
        `${name}: override must record the draft value it replaces`);
    }
  }
  assert.ok(map['--kudy-locked'].override && map['--kudy-available'].override &&
    map['--kudy-pending'].override, 'the three contrast-driven marker overrides must stay recorded');
});

test('component-level CSS overrides resolve to canon tokens', () => {
  for (const override of canon.cssOverrides) {
    const rule = css.match(new RegExp(`${override.selector.replace('.', '\\.')}\\s*{[^}]*}`));
    assert.ok(rule, `${override.selector}: rule must exist in prototype styles.css`);
    if (override.token) {
      const varRef = rule[0].match(/var\(--([\w-]+)\)/);
      assert.ok(varRef, `${override.selector}.${override.property}: must consume the canon via var()`);
      assert.equal(rootVars[`--${varRef[1]}`], canon.tokens[override.token].value,
        `${override.selector}: resolved value must equal canon ${override.token}`);
    }
    if (override.fromTokens) {
      const [base, factor] = override.fromTokens.map((t) => parseFloat(canon.tokens[t].value));
      assert.match(rule[0], new RegExp(`${override.property}:\\s*${base * factor}px`),
        `${override.selector}.${override.property}: must render base × factor`);
    }
    assert.ok(override.reason && override.reason.trim() !== '', `${override.selector}: override needs a reason`);
    assert.ok(override.draftValue, `${override.selector}: override must record the draft value`);
  }
});

test('guard is wired into npm test (implementation-rules 1 and 7)', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /test\/design-tokens\.test\.mjs/,
    'npm test must run test/design-tokens.test.mjs');
});
