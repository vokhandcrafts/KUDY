// AR-1 regression guard (#78, PR review 2026-09-15): the `eol=lf` attribute
// rule for the hash-verified fixture assets is what keeps a CRLF checkout
// byte-identical to the lock.json sha256 values. The integrity tests in
// offline-map.test.mjs fail only on an already affected worktree (Windows
// checkout with autocrlf); this check fails on any platform as soon as the
// .gitattributes rule is removed or narrowed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const spikeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(spikeRoot, '..', '..');
const lock = JSON.parse(readFileSync(path.join(spikeRoot, 'source', 'lock.json'), 'utf8'));
const fixturePaths = lock.files.map((entry) => `spikes/G00.02-offline-map/source/${entry.path}`);

test('the eol=lf attribute stays pinned for every hash-verified fixture asset', () => {
  const raw = execFileSync('git', ['check-attr', '-z', 'eol', '--', ...fixturePaths], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  // `git check-attr -z` emits <path> NUL <attribute> NUL <value> NUL per path.
  const fields = raw.split('\0');
  for (const fixturePath of fixturePaths) {
    const at = fields.indexOf(fixturePath);
    assert.ok(at !== -1, `git check-attr reported an entry for ${fixturePath}`);
    assert.equal(fields[at + 2], 'lf', `eol must stay lf for ${fixturePath}`);
  }
});
