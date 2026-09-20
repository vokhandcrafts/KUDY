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
function isAboveAdvisoryRange(version: string): boolean {
  const m = version.match(/[\^~>= ]*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(m, `unparseable postcss version: ${version}`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (major !== 8) return major > 8;
  if (minor !== 5) return minor > 5;
  return patch >= 23;
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
