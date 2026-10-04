// G21.06 (issue #539) — canonical byte-compared text paths carry their EOL pins.
// Each path below is compared byte-wise against generated LF output or a fixed
// sha256 pin, so a CRLF checkout must never touch its bytes (implementation-rules
// 1 and 4: configuration is code). Reverting any of the G21.06 .gitattributes
// entries fails the first check. Text-only parsers are deliberately absent —
// they accept both EOLs (campaign docs/24 extraction, size-guideline and
// vocabulary mutations).
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const FIXTURES = path.join(REPO, 'fixtures', 'discovery-contract');

function checkEolAttr(rel) {
  return execFileSync('git', ['check-attr', 'eol', '--', rel], { cwd: REPO, encoding: 'utf8' });
}

test('reverting the G21.06 .gitattributes entries fails: every byte-compared path carries eol=lf', () => {
  const pinned = [
    'contracts/wire/wire-types.ts',
    'fixtures/discovery-contract/index-stop-places.json',
    ...fs
      .readdirSync(path.join(REPO, 'tools', 'simulate', 'traces'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => `tools/simulate/traces/${name}`),
    ...fs
      .readdirSync(path.join(REPO, 'authoring', 'gdansk', 'review'))
      .filter((name) => name.endsWith('.review.md'))
      .map((name) => `authoring/gdansk/review/${name}`),
  ];
  // 9 committed traces + 10 committed review reports + 2 single files — a
  // shrinking set must fail here, not silently lose its pins (rule 14).
  assert.ok(pinned.length >= 21, `expected the committed canonical set, got ${pinned.length}`);
  for (const rel of pinned) {
    const out = checkEolAttr(rel);
    assert.match(out, /eol: lf/, `${rel} must carry the eol=lf pin (rule 4), got: ${out}`);
  }
});

test('the committed stop-places index matches the sha256+bytes pin its catalog declares', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'catalog-discovery-stop-places.json'), 'utf8'));
  const { bytes, sha256 } = catalog.discovery_index;
  const raw = fs.readFileSync(path.join(FIXTURES, 'index-stop-places.json'));
  assert.equal(raw.byteLength, bytes, 'the index bytes must match the declared size');
  assert.equal(createHash('sha256').update(raw).digest('hex'), sha256, 'the index bytes must match the declared sha256');
});

test('corrupting one pinned byte changes the digest the production gate pins', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'catalog-discovery-stop-places.json'), 'utf8'));
  const raw = fs.readFileSync(path.join(FIXTURES, 'index-stop-places.json'));
  const corrupted = Uint8Array.from(raw);
  corrupted[0] ^= 0x20;
  assert.notEqual(
    createHash('sha256').update(corrupted).digest('hex'),
    catalog.discovery_index.sha256,
    'a one-byte corruption must fail the sha256+bytes gate (index-pin-mismatch), never pass it',
  );
});

test('the eol-pin guard is wired into the default test command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /"?tools\/ci\/\*\.test\.mjs"?/, 'npm test glob must include tools/ci tests');
});
