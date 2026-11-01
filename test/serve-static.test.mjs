import test from 'node:test';
import assert from 'node:assert/strict';
import { join, parse, resolve, sep } from 'node:path';
import { resolveStaticFile } from '../tools/serve-static.mjs';

test('static resolver accepts a root ending with a separator', () => {
  const base = resolve('fixture-public');
  assert.equal(resolveStaticFile(base + sep, '/index.html'), join(base, 'index.html'));
});

test('static resolver makes relative roots absolute before checking containment', () => {
  const base = resolve('fixture-public');
  assert.equal(resolveStaticFile('fixture-public', '/assets/map.json'), join(base, 'assets', 'map.json'));
});

test('static resolver serves inside the filesystem root', () => {
  const base = parse(process.cwd()).root;
  assert.equal(resolveStaticFile(base, '/index.html'), join(base, 'index.html'));
});

test('static resolver still denies traversal and sibling-prefix escapes', () => {
  const base = resolve('fixture-public');
  for (const root of [base, base + sep, 'fixture-public']) {
    assert.equal(resolveStaticFile(root, '/%2e%2e/secret.json'), null);
    assert.equal(resolveStaticFile(root, '/%2e%2e/fixture-public-copy/index.html'), null);
  }
});
