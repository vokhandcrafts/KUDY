// #860 guard: docs/design/dark-theme.md is the dark-theme proposal for #436.
// The machine block must stay a complete, honest proposal: every canon color
// token is either given a dark value or placed in the light cartography zone
// (never both, never missing), every surface pair holds at the WCAG thresholds
// in both themes with the repo contrast helper, the tier-2 cartography
// candidates hold their thresholds, and the recorded behavior keeps the
// owner-confirmed system default (DT-3, 2026-10-24) on record. The suite
// itself stays wired into npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrast } from './wcag-contrast.mjs';
import { loadCanon, loadMachineBlock } from './design-canon.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = loadMachineBlock(join(root, 'docs/design/dark-theme.md'));
const canon = loadCanon();
const zone = spec.cartographyZone;
const zoneTokens = new Set(zone.tokens);

const darkValue = (token) => spec.darkTokens[token] ?? canon.tokens[token].value;

test('the spec block stays a proposal tied to its issue and a verified source', () => {
  assert.equal(spec.status, 'proposal', 'values stay a proposal until the owner approves them (#860 criterion 5)');
  assert.match(spec.issue, /\/issues\/860$/);
  assert.match(spec.verifiedSha, /^[0-9a-f]{40}$/, 'the compared main SHA must be recorded in full');
});

test('dark tokens plus the cartography zone cover every canon color token exactly once', () => {
  const colorTokens = Object.keys(canon.tokens).filter((n) => n.startsWith('color.'));
  const covered = [...Object.keys(spec.darkTokens), ...zoneTokens];
  assert.equal(covered.length, new Set(covered).size, 'a token must not be both dark and cartography');
  assert.deepEqual([...covered].sort(), [...colorTokens].sort(),
    'every canon color token needs either a dark value or an explicit light-zone entry');
});

test('every dark token value is a hex color different from its light value', () => {
  for (const [name, value] of Object.entries(spec.darkTokens)) {
    assert.match(value, /^#[0-9a-f]{6}$/i, `${name}: dark value must be #rrggbb`);
    assert.notEqual(value.toLowerCase(), canon.tokens[name].value.toLowerCase(),
      `${name}: dark value must differ from the light canon value`);
  }
});

test('surface pairs hold in both themes at the canon thresholds', () => {
  for (const { fg, bg, min } of [...canon.contrastPairs, ...spec.pairAdditions]) {
    if (zoneTokens.has(bg)) continue; // cartography pairs are measured against light values below
    const light = contrast(canon.tokens[fg].value, canon.tokens[bg].value);
    const dark = contrast(darkValue(fg), darkValue(bg));
    assert.ok(light >= min, `${fg} on ${bg} light ${light.toFixed(2)}:1 < ${min}`);
    assert.ok(dark >= min, `${fg} on ${bg} dark ${dark.toFixed(2)}:1 < ${min}`);
  }
});

test('cartography pairs keep the light values in both themes (MVP zone rule)', () => {
  for (const { fg, bg, min } of [...canon.contrastPairs, ...spec.pairAdditions]) {
    if (!zoneTokens.has(bg)) continue;
    // The marker letter follows the zone: the light accent-ink in both themes.
    const fgValue = zoneTokens.has(fg) || fg === 'color.accent-ink'
      ? canon.tokens[fg].value
      : darkValue(fg);
    const ratio = contrast(fgValue, canon.tokens[bg].value);
    assert.ok(ratio >= min, `${fg} on ${bg} (light zone) ${ratio.toFixed(2)}:1 < ${min}`);
  }
});

test('the zone rule exists because partial theming breaks the marker letter', () => {
  const broken = contrast(spec.darkTokens['color.accent-ink'], canon.tokens['color.marker.played'].value);
  assert.ok(broken < 4.5,
    `dark accent-ink on a light marker fill measures ${broken.toFixed(2)}:1; ` +
    'if values change so it passes, the cartography zone rule can be revisited');
});

test('tier-2 dark cartography candidates hold the thresholds without entering production', () => {
  const tier2 = zone.tier2Proposal;
  assert.equal(Object.keys(tier2).length, zoneTokens.size + 1,
    'tier-2 lists a candidate per zone token plus the marker letter');
  for (const { fg, bg, min } of canon.contrastPairs) {
    if (!zoneTokens.has(bg)) continue;
    const fgValue = fg === 'color.accent-ink' ? tier2.markerLetter : (tier2[fg] ?? canon.tokens[fg].value);
    const ratio = contrast(fgValue, tier2[bg]);
    assert.ok(ratio >= min, `tier-2 ${fg} on ${bg} ${ratio.toFixed(2)}:1 < ${min}`);
  }
});

test('behavior fixes the three choices and records the confirmed system default', () => {
  const behavior = spec.themeBehavior;
  assert.deepEqual(behavior.choices, ['system', 'light', 'dark']);
  assert.equal(behavior.default, 'system');
  assert.match(behavior.systemDefault, /2026-10-24/,
    'the system default must carry the owner confirmation date (DT-3, #860 criterion 4)');
  for (const key of ['persistence', 'firstFrame', 'liveOsChange', 'runContinuity', 'statusBar', 'illustrations', 'webBoundary']) {
    assert.ok(typeof behavior[key] === 'string' && behavior[key].trim() !== '',
      `themeBehavior.${key} must be recorded`);
  }
});

test('guard is wired into npm test (implementation-rules 1 and 7)', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /"test\/\*\.test\.mjs"/,
    'npm test must run the test/ zone that owns design-dark-theme.test.mjs');
});
