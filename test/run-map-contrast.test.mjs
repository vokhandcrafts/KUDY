// UX 04 (issue #350) guard: the Run map's marker-status configuration is
// contrast-safe — the five ADR G01.01 §4.5 states each carry a canon
// color.marker.* fill with ≥3:1 against the canon map background (WCAG
// 1.4.11 non-text), the map background itself is the canon color.map, and
// the peek bar's progress strip keeps its identifying edge ≥3:1 against the
// card. Reverting any of those to the pre-fix values (a white pending dot,
// the notice-border available, a line-only track) turns this red.
// The suite is wired into npm test (implementation-rules 1 and 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contrast } from './wcag-contrast.mjs';
import { loadCanon } from './design-canon.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokensPath = join(root, 'components/design-tokens.ts');
const screenPath = join(root, 'app/run/[id].tsx');

// The anchored entries of components/design-tokens.ts: TS key → canon token
// name → hex, the same anchoring the design-tokens guard pins.
function loadSurfaceTokens() {
  const source = readFileSync(tokensPath, 'utf8');
  const entries = new Map();
  for (const [, key, value, tokenName] of source.matchAll(/(\w+):\s*'([^']+)',\s*\/\/\s*([\w.-]+)/g)) {
    entries.set(key, { hex: value, canon: tokenName });
  }
  return entries;
}

const canon = loadCanon();
const surfaceTokens = loadSurfaceTokens();
const screen = readFileSync(screenPath, 'utf8');

function styleBlock(name) {
  const match = screen.match(new RegExp(`(?:^|\\s)${name}:\\s*\\{[^{}]*\\}`));
  assert.ok(match, `app/run/[id].tsx must keep its ${name} style block`);
  return match[0];
}

function tokenOf(block, property) {
  const match = block.match(new RegExp(`${property}:\\s*tokens\\.(\\w+)`));
  assert.ok(match, `the style block must set ${property} from a design token`);
  const entry = surfaceTokens.get(match[1]);
  assert.ok(entry, `tokens.${match[1]} must exist in components/design-tokens.ts`);
  return entry;
}

test('the Run map background is the canon color.map, not card white', () => {
  const entry = tokenOf(styleBlock('map'), 'backgroundColor');
  assert.equal(entry.canon, 'color.map',
    `styles.map.backgroundColor must resolve to canon color.map, got ${entry.canon}`);
});

test('every marker status carries its canon color.marker.* fill', () => {
  const block = screen.match(/const STATUS_COLOR[^{]*\{([^}]*)\}/);
  assert.ok(block, 'app/run/[id].tsx must keep the STATUS_COLOR configuration');
  const entries = new Map(
    [...block[1].matchAll(/(\w+):\s*tokens\.(\w+)/g)].map((m) => [m[1], m[2]]),
  );
  assert.deepEqual(
    [...entries.keys()].sort(),
    [...canon.markers].sort(),
    'STATUS_COLOR must cover exactly the ADR G01.01 §4.5 states',
  );
  for (const [status, tsKey] of entries) {
    const entry = surfaceTokens.get(tsKey);
    assert.ok(entry, `STATUS_COLOR.${status} must reference a design token (tokens.${tsKey})`);
    assert.equal(entry.canon, `color.marker.${status}`,
      `STATUS_COLOR.${status} must be the canon token color.marker.${status}, got ${entry.canon}`);
  }
});

test('every marker fill keeps ≥3:1 against the canon map background (WCAG 1.4.11)', () => {
  const mapHex = canon.tokens['color.map'].value;
  const block = screen.match(/const STATUS_COLOR[^{]*\{([^}]*)\}/);
  for (const [status, tsKey] of [...block[1].matchAll(/(\w+):\s*tokens\.(\w+)/g)].map((m) => [m[1], m[2]])) {
    const hex = surfaceTokens.get(tsKey).hex;
    const ratio = contrast(hex, mapHex);
    assert.ok(ratio >= 3,
      `marker ${status} ${hex} on map ${mapHex}: ${ratio.toFixed(2)}:1 < 3:1`);
  }
});

test('the peek bar progress strip stays identifiable on the card (≥3:1 edge)', () => {
  const card = surfaceTokens.get('colorCard').hex;
  const track = styleBlock('progressTrack');
  const edge = tokenOf(track, 'borderColor');
  const edgeRatio = contrast(edge.hex, card);
  assert.ok(edgeRatio >= 3,
    `progressTrack border ${edge.hex} on card ${card}: ${edgeRatio.toFixed(2)}:1 < 3:1`);
  const fill = tokenOf(styleBlock('progressFill'), 'backgroundColor');
  const fillRatio = contrast(fill.hex, card);
  assert.ok(fillRatio >= 3,
    `progressFill ${fill.hex} on card ${card}: ${fillRatio.toFixed(2)}:1 < 3:1`);
});

test('guard is wired into npm test (implementation-rules 1 and 7)', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /test\/run-map-contrast\.test\.mjs/,
    'npm test must run test/run-map-contrast.test.mjs');
});
