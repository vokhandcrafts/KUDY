// G08.01 criterion 3 — "сакрэты і production-права не ў fixtures". Guard over
// the repo's fixture surface (fixtures/, supabase/, web/ fixtures): no JWT-
// shaped tokens, no value assignments to the secret-bearing env names, and
// no 43-character base64url literals (the exact encoding of a 32-byte device
// secret). Secrets in this repo are minted at runtime (device-core.ts), so a
// committed literal of that shape is a leak; reverting any fix that removes
// one makes this guard fail (implementation-rules 1/14).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Names whose value must never be committed (names alone in .env.example are
// the documented interface — ADR G00.03 §5; only `NAME=value` pairs fail).
const SECRET_ENV_NAMES = [
  'REVENUECAT_SECRET_API_KEY',
  'SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GRANT_URL_SIGNING_KEY',
  'DATABASE_URL',
];

const SCAN_GLOBS = ['fixtures', 'supabase', 'web/public'];

const committedFiles = SCAN_GLOBS.flatMap((glob) =>
  execFileSync('git', ['ls-files', glob], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((rel) => rel !== ''),
);

test('guard: fixture surface enumerates the expected trees', () => {
  assert.ok(committedFiles.length > 0, 'scan scope must not silently empty out');
});

test('guard: no JWT-shaped token is committed in the fixture surface', () => {
  const selfPath = path.relative(repoRoot, fileURLToPath(import.meta.url));
  for (const rel of committedFiles) {
    // A guard cannot flag its own source: its message names the marker itself.
    if (rel === selfPath) continue;
    const content = readFileSync(path.resolve(repoRoot, rel), 'utf8');
    assert.ok(!content.includes('eyJ'), `${rel} contains a JWT-shaped literal (ey…J marker)`);
  }
});

test('guard: secret-bearing env names are never committed with values', () => {
  for (const rel of committedFiles) {
    const content = readFileSync(path.resolve(repoRoot, rel), 'utf8');
    for (const name of SECRET_ENV_NAMES) {
      const withValue = new RegExp(`${name}\\s*[=:"]+\\s*["']?[A-Za-z0-9_-]{8,}`, 'g');
      assert.ok(!withValue.test(content), `${rel} assigns a value to ${name}`);
    }
  }
});

test('guard: no 43-char base64url literal (32-byte secret shape) is committed', () => {
  // fixtures/discovery-contract/ holds schema-boundary fixtures whose long
  // strings (oversized fields, repeated filler, content hashes) are the
  // G01.06 contract's own test data — not credentials (fixed in G01.06,
  // verified by its contract suite).
  const allowlistedPrefixes = ['fixtures/discovery-contract/'];
  const secretShape = /[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
  for (const rel of committedFiles) {
    if (rel.endsWith('.svg')) continue;
    if (allowlistedPrefixes.some((prefix) => rel.startsWith(prefix))) continue;
    const content = readFileSync(path.resolve(repoRoot, rel), 'utf8');
    const hits = content.match(secretShape) ?? [];
    assert.deepEqual(hits, [], `${rel} contains a 32-byte-secret-shaped literal`);
  }
});
