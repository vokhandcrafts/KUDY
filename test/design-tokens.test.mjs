// G06.07 guard: docs/design/visual-language.md is the single source of visual
// values. The canon token block must be complete (every token has a value and
// a use), every contrast pair must hold at WCAG 1.4.3/1.4.11 thresholds, every
// :root custom property of the prototype CSS must resolve to a canon token
// (overrides recorded with a reason), state names must stay verbatim with
// their canonical sources, and the suite itself must stay wired into npm test.
// G06.10.a: every font family token carries a complete rights record
// (fontLicenses) and the paper grain fixes its token, opacity and places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrast } from './wcag-contrast.mjs';
import { loadCanon } from './design-canon.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Git-style repo-relative spelling for comparisons: the expected lists quote
// `/`, a walk produces the host separator (A26-08).
const repoRel = (filePath) => filePath.slice(root.length + 1).split(sep).join('/');
const canonPath = join(root, 'docs/design/visual-language.md');
const cssPath = join(root, 'spikes/G06.08-prototype/prototype/styles.css');
const packageScreensPath = join(root, 'spikes/G06.08-prototype/package/screens.md');
const schemesPath = join(root, 'docs/design/screens-and-transitions.md');
const adrMarkersPath = join(root, 'docs/architecture/decisions/G01.01-narration-progress.md');
const brandPath = join(root, 'docs/06_brand_and_promotion.md');

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

test('every font family token carries a complete rights record (G06.10.a)', () => {
  const records = canon.fontLicenses;
  assert.ok(records && typeof records === 'object', 'canon must carry fontLicenses records');
  const familyTokens = Object.keys(canon.tokens).filter((n) => n.startsWith('font.family-'));
  assert.deepEqual(Object.keys(records).sort(), [...familyTokens].sort(),
    'every font family token must have exactly one license record');
  for (const [name, record] of Object.entries(records)) {
    for (const field of ['family', 'license', 'embedding', 'source', 'selfHost', 'licenseText']) {
      const value = record[field];
      assert.ok(typeof value === 'string' && value.trim() !== '',
        `${name}: license record field ${field} must be non-empty`);
    }
    assert.match(record.license, /OFL 1\.1/, `${name}: license must be OFL 1.1`);
    for (const field of ['source', 'licenseText']) {
      assert.match(record[field], /^https:\/\//, `${name}: ${field} must be an https link`);
    }
    assert.ok(canon.tokens[name].value.startsWith(record.family),
      `${name}: token value must name the licensed family first`);
  }
});

test('paper grain fixes its token, opacity and allowed and forbidden places (G06.10.a)', () => {
  const grain = canon.paperGrain;
  assert.ok(grain && typeof grain === 'object', 'canon must carry the paperGrain rule');
  assert.ok(canon.tokens[grain.token], `grain token ${grain.token} must exist`);
  assert.match(grain.opacity, /4[–-]5/, 'grain opacity must stay in the approved 4–5% range');
  assert.ok(Array.isArray(grain.allowed) && grain.allowed.length > 0, 'allowed places must be listed');
  assert.ok(Array.isArray(grain.forbidden) && grain.forbidden.length > 0, 'forbidden places must be listed');
  assert.ok(grain.forbidden.some((p) => p.includes('Run')), 'forbidden places must name Run (never on Run)');
  assert.ok(grain.forbidden.some((p) => p.includes('тэкст')), 'forbidden places must name dense body text');
});

test('the paper grain is consumed only by the canon-allowed places (G06.10.e)', () => {
  // The canon paperGrain lists are prose (§2 and the machine block); the
  // machine side of the allowed-places rule walks the imports of both UI
  // zones: exactly the two calm screens (and the wrapper's own suite)
  // consume the shared wrapper — the Run panel, the map and every other
  // surface stay clean. An indirect consumer (a component embedding the
  // wrapper) imports it too, so the walk sees it; a new consumer outside
  // the list fails the assertion.
  const importers = [];
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const filePath = join(dir, entry.name);
      if (entry.isDirectory()) scan(filePath);
      else if (/\.(tsx|ts)$/.test(entry.name) && entry.name !== 'paper-surface.tsx' &&
        /from "[^"]*paper-surface"/.test(readFileSync(filePath, 'utf8'))) {
        importers.push(repoRel(filePath));
      }
    }
  };
  scan(join(root, 'app'));
  scan(join(root, 'components'));
  assert.deepEqual(importers.sort(),
    ['app/(tabs)/explore.tsx', 'app/(tabs)/my.tsx', 'components/paper-surface.test.tsx'],
    'the paper grain wrapper is allowed on the two calm screens only');
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

test('production surface tokens stay verbatim with the canon (G06.01.a)', () => {
  const source = readFileSync(join(root, 'components/design-tokens.ts'), 'utf8');
  // Each entry is anchored to its canon token by name in the trailing
  // comment; the guard fails when a value drifts from the canon or the
  // anchor is dropped.
  const stringEntries = [...source.matchAll(/(\w+):\s*'([^']+)',\s*\/\/\s*([\w.-]+)/g)];
  const numberEntries = [...source.matchAll(/(\w+):\s*(\d+(?:\.\d+)?),\s*\/\/\s*([\w.-]+)/g)];
  assert.ok(stringEntries.length + numberEntries.length >= 20, 'the surface token file must keep its canon-anchored entries');
  for (const [, key, value, tokenName] of stringEntries) {
    // G06.10.b: the font-family mirror entries are anchored to the canon
    // token but hold the named per-weight face React Native loads, not the
    // canon CSS chain — the G06.10.b test below pins them instead.
    if (tokenName.startsWith('font.family-')) continue;
    const token = canon.tokens[tokenName];
    assert.ok(token, `${key}: canon token ${tokenName} must exist`);
    assert.equal(value, token.value, `${key}: value must equal canon ${tokenName}`);
  }
  for (const [, key, value, tokenName] of numberEntries) {
    // G06.10.e: the grain layer opacity is anchored to the canon rule —
    // texture.paper-grain's value describes the tile asset, the approved
    // range lives in paperGrain.opacity.
    if (tokenName === 'texture.paper-grain') {
      const range = canon.paperGrain.opacity.match(/(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)/);
      assert.ok(range, 'canon paperGrain.opacity must keep the a–b% range form');
      const opacity = parseFloat(value);
      assert.ok(
        opacity * 100 >= parseFloat(range[1]) && opacity * 100 <= parseFloat(range[2]),
        `${key}: layer opacity ${value} must stay in the canon range ${range[1]}–${range[2]}%`,
      );
      continue;
    }
    const token = canon.tokens[tokenName];
    assert.ok(token, `${key}: canon token ${tokenName} must exist`);
    // The big-text factor is the one fractional canon value — the comparison
    // is numeric on purpose (G06.05, font.big-text-factor 1.25).
    assert.equal(parseFloat(token.value), parseFloat(value), `${key}: value must equal canon ${tokenName}`);
  }
});

test('surface font-family mirror stays anchored to the licensed canon families (G06.10.b)', () => {
  const source = readFileSync(join(root, 'components/design-tokens.ts'), 'utf8');
  const fontEntries = [...source.matchAll(/(\w+):\s*'([^']+)',\s*\/\/\s*(font\.family-[\w-]+)/g)];
  assert.ok(fontEntries.length >= 4, 'the font mirror must keep its canon-anchored entries');
  // The canon weights are the only weights the named faces may carry.
  const weights = ['font.weight-regular', 'font.weight-strong'].map(
    (n) => parseFloat(canon.tokens[n].value),
  );
  for (const [, key, value, tokenName] of fontEntries) {
    const record = canon.fontLicenses[tokenName];
    assert.ok(record, `${key}: ${tokenName} must carry a rights record (canon fontLicenses)`);
    const family = record.family.replace(/\s+/g, '');
    assert.ok(value.startsWith(family),
      `${key}: value ${value} must render the licensed family ${record.family}`);
    const weight = value.match(/(\d+)/);
    assert.ok(weight && weights.includes(parseFloat(weight[1])),
      `${key}: named weight in ${value} must be a canon weight (${weights.join(' / ')})`);
  }
  // Every approved family ships in the mirror — the dragon voice included —
  // and no mirror entry drifts to an unlicensed family.
  const familyTokens = Object.keys(canon.tokens).filter((n) => n.startsWith('font.family-'));
  assert.deepEqual(
    [...new Set(fontEntries.map(([, , , tokenName]) => tokenName))].sort(),
    [...familyTokens].sort(),
    'the mirror must cover exactly the canon family tokens',
  );
});

test('the display family renders only guide and history names (canon §3, issue #435)', () => {
  // Canon §3: Alegreya is the display face of the guide and story names
  // only. The role lives in one place — screenStyles.displayTitle; every
  // other screen title (rubrics, place names, collections) consumes
  // screenStyles.title on the UI family. The walk is the reverted-line
  // check (implementation-rules 1): re-pointing a rubric or place title
  // at the display role, or a screen consuming the display token
  // directly, turns this red.
  const roleSource = readFileSync(join(root, 'components/screen-styles.ts'), 'utf8');
  // \b anchors the key start: a future `subtitle:` must not satisfy the
  // `title:` assertion by substring (pr-review 2026-10-01).
  assert.match(roleSource, /\btitle:\s*{[^}]*fontFamily:\s*tokens\.fontFamilyUi/,
    'screenStyles.title must render the UI family');
  assert.match(roleSource, /\bdisplayTitle:\s*{[^}]*fontFamily:\s*tokens\.fontFamilyDisplay/,
    'screenStyles.displayTitle must render the display family');
  const displayConsumers = [];
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const filePath = join(dir, entry.name);
      if (entry.isDirectory()) scan(filePath);
      else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.includes('.test.')) {
        const source = readFileSync(filePath, 'utf8');
        if (dir === join(root, 'app') && /fontFamilyDisplay/.test(source)) {
          displayConsumers.push(`${repoRel(filePath)}: hard-coded display token`);
        }
        if (/screenStyles\.displayTitle/.test(source)) {
          displayConsumers.push(repoRel(filePath));
        }
      }
    }
  };
  scan(join(root, 'app'));
  scan(join(root, 'components'));
  assert.deepEqual(displayConsumers.sort(), ['app/route/[id].tsx'],
    'the display role is allowed on the route preview title (the history name) only');
});

test('surface styles consume the canon title token — no hardcoded title size (UX 08)', () => {
  // The six screen titles (Explore, My KUDY, Побач, guides rubric, route
  // preview, place detail) take their size from tokens.fontTitleSize, pinned
  // to canon font.size-title above. A literal fontSize: 18 on a surface
  // bypasses the canon — this walk is the reverted-line check
  // (implementation-rules 1) that fails until it is back on the token.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const filePath = join(dir, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (/\.(tsx|ts)$/.test(entry.name) &&
        /fontSize:\s*18(?![.\d])/.test(readFileSync(filePath, 'utf8'))) {
        offenders.push(filePath);
      }
    }
  };
  walk(join(root, 'app'));
  walk(join(root, 'components'));
  assert.deepEqual(offenders, [],
    `hardcoded title size must come from tokens.fontTitleSize: ${offenders.join(', ')}`);
});

test('guard is wired into npm test (implementation-rules 1 and 7)', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /test\/design-tokens\.test\.mjs/,
    'npm test must run test/design-tokens.test.mjs');
});
