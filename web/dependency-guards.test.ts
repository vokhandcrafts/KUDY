// Revert-failing guard for the postcss advisory fix (implementation-rules 1, PR #137):
// the four postcss advisories (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q,
// GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849) cover 8.4.31 that next 15.x pins
// transitively and are fixed in 8.5.23. Both the override in web/package.json and
// the resolution actually installed from the lockfile must stay above that range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const readJson = (rel: string) => {
  const target = path.resolve(webRoot, rel);
  if (!target.startsWith(webRoot + path.sep)) throw new Error(`refusing to read outside ${webRoot}: ${rel}`);
  return JSON.parse(fs.readFileSync(target, 'utf8'));
};

// The vulnerable range ends at 8.5.22: anything above it clears all four advisories.
// A spec may be a union or a range ("^8.5.23 || 8.4.31", ">=8.5.23 <9"): a part is
// safe only if the lowest version it allows clears the range, so each union part's
// lower bounds are checked — an exclusive ">" bound as its successor, while upper
// bounds ("<", "<=", the right side of a hyphen range) only narrow and are not
// proof of safety. A part without a lower bound — a dist-tag, a wildcard, a bare
// upper bound — allows versions this check cannot enumerate, so it fails loudly
// instead of passing on a partial read.
function isAboveAdvisoryRange(version: string): boolean {
  return version.split('||').every((part) => {
    assert.ok(
      !/\d+\.[xX*]|[xX*]\.\d+/.test(part),
      `unparseable postcss version (wildcards are not supported): ${part.trim()}`,
    );
    const matches = [...part.matchAll(/(-\s*)?(>=|<=|>|<|\^|~)?\s*(\d+)\.(\d+)\.(\d+)/g)];
    assert.ok(matches.length > 0, `unparseable postcss version (no version triple): ${part.trim()}`);
    const clears = (major: number, minor: number, patch: number) => {
      if (major !== 8) return major > 8;
      if (minor !== 5) return minor > 5;
      return patch >= 23;
    };
    let hasLower = false;
    const above = matches.every((m) => {
      const [, hyphen, comparator, major, minor, patch] = m;
      const isUpper = comparator === '<' || comparator === '<=' || (hyphen !== undefined && !comparator);
      if (isUpper) return true;
      hasLower = true;
      const bound = [Number(major), Number(minor), Number(patch)];
      if (comparator === '>') bound[2] += 1;
      return clears(bound[0], bound[1], bound[2]);
    });
    assert.ok(hasLower, `unparseable postcss version (no lower bound): ${part.trim()}`);
    return above;
  });
}

test('guard: the web postcss override pins above the 8.5.22 advisory range', () => {
  const pkg = readJson('package.json');
  const spec = pkg.overrides?.postcss;
  assert.ok(spec, 'the postcss override is missing from web/package.json');
  assert.ok(
    isAboveAdvisoryRange(spec),
    `the postcss override "${spec}" no longer pins above the vulnerable range (fixed in 8.5.23)`,
  );
});

test('guard: the postcss resolution installed from the web lockfile is above the advisory range', () => {
  const target = path.resolve(webRoot, 'node_modules/postcss/package.json');
  assert.ok(
    fs.existsSync(target),
    'web dependencies are not installed — run npm ci in web/ before the suite (the guard reads the installed postcss)',
  );
  const resolved = JSON.parse(fs.readFileSync(target, 'utf8')).version;
  assert.ok(
    isAboveAdvisoryRange(resolved),
    `resolved postcss ${resolved} is inside the advisory range (<=8.5.22); the lockfile lost the override`,
  );
});

test('guard: a spec is above the range only if every version triple it allows is', () => {
  assert.equal(isAboveAdvisoryRange('^8.5.23'), true, 'single clean spec must pass');
  assert.equal(isAboveAdvisoryRange('^8.5.23 || 8.4.31'), false, 'union allowing the transitively pinned 8.4.31 must fail');
  assert.equal(isAboveAdvisoryRange('^8.5.23 || 8.5.28'), true, 'union of two fixed versions must pass');
  assert.equal(isAboveAdvisoryRange('>=8.5.23 <9'), true, 'range with an above-range lower bound must pass');
  assert.equal(isAboveAdvisoryRange('8.5.22'), false, 'the boundary version still inside the advisory range must fail');
  assert.equal(isAboveAdvisoryRange('>8.5.22'), true, 'an exclusive lower bound means its successor, which clears the range');
  assert.equal(isAboveAdvisoryRange('~8.5.22'), false, 'a tilde range includes its lower bound, which is inside the range');
});

test('guard: a spec the guard cannot fully enumerate fails loudly', () => {
  assert.throws(
    () => isAboveAdvisoryRange('latest'),
    /unparseable postcss version \(no version triple\): latest/,
    'no version triple at all',
  );
  assert.throws(
    () => isAboveAdvisoryRange('^8.5.23 || latest'),
    /unparseable postcss version \(no version triple\): latest/,
    'a dist-tag union part allows unenumerated versions inside the advisory range',
  );
  assert.throws(
    () => isAboveAdvisoryRange('^8.5.23 || next'),
    /unparseable postcss version \(no version triple\): next/,
    'a part named like a dist-tag is not confused with a wildcard',
  );
  assert.throws(
    () => isAboveAdvisoryRange('8.5.x || ^8.5.23'),
    /wildcards are not supported/,
    'a wildcard part allows unenumerated versions inside the advisory range',
  );
  assert.throws(
    () => isAboveAdvisoryRange('<8.6.0'),
    /\(no lower bound\): <8\.6\.0/,
    'an upper bound alone allows versions below it, inside the advisory range',
  );
  assert.throws(
    () => isAboveAdvisoryRange('^8.5.23 || <8.6.0'),
    /\(no lower bound\): <8\.6\.0/,
    'a union part with only an upper bound must fail the whole spec',
  );
});
