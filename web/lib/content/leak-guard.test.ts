// G10.01.a acceptance 3: the leak guard over the web content input — an
// extended path or a source map fails the scan with the build-bundle classes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../../../tools/build-bundle/build-bundle.mjs';
import { scanWebContentInput } from './leak-guard.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const AUTHOR_TREE = path.join(REPO_ROOT, 'fixtures', 'content', 'demo-route');

function copyTree(src: string, dest: string): void {
  fs.cpSync(src, dest, { recursive: true });
}

let cleanPublic = '';
let privateDir = '';
let poisoned = '';

test('demo bundle builds and the real public/private split passes the guard', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-web-guard-'));
  const buildRoot = path.join(tmp, 'build');
  await buildBundle({ inDir: AUTHOR_TREE, outDir: buildRoot });
  cleanPublic = path.join(buildRoot, 'public');
  privateDir = path.join(buildRoot, 'private');
  const res = scanWebContentInput({ publicDir: cleanPublic, privateDir });
  assert.deepEqual(res, { ok: true, violations: [] });
});

test('the guard is local: scanning without a private reference still passes clean input', () => {
  const res = scanWebContentInput({ publicDir: cleanPublic });
  assert.equal(res.ok, true);
});

function freshPoisonedCopy(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-web-guard-bad-'));
  poisoned = path.join(tmp, 'public');
  copyTree(cleanPublic, poisoned);
  return poisoned;
}

test('a source map in the public input fails with source-map-in-public', () => {
  const root = freshPoisonedCopy();
  fs.writeFileSync(path.join(root, 'bundle', 'demo-route-a1', 'sourcemap.map'), '{}');
  const res = scanWebContentInput({ publicDir: root, privateDir });
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === 'source-map-in-public' && v.path.endsWith('sourcemap.map')));
});

test('an extended path segment in the tree fails with private-path-in-public', () => {
  const root = freshPoisonedCopy();
  fs.mkdirSync(path.join(root, 'bundle', 'demo-route-a1', '1', 'be', 'extended'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bundle', 'demo-route-a1', '1', 'be', 'extended', 'stops.json'), '[]');
  const res = scanWebContentInput({ publicDir: root, privateDir });
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === 'private-path-in-public'));
});

test('a private segment inside a path-typed string fails with private-path-in-public', () => {
  const root = freshPoisonedCopy();
  const indexFile = path.join(root, 'discovery', 'demo-city', 'r-demo-1', 'index.json');
  const doc = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  doc.offers[0].detail_ref.path = 'private/bundle/demo-route-a1/1/be/extended/stops.json';
  fs.writeFileSync(indexFile, JSON.stringify(doc));
  const res = scanWebContentInput({ publicDir: root, privateDir });
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === 'private-path-in-public' && v.path.endsWith('index.json:path')));
});

test('an 8-word run of private narration in a public string fails with private-text-leak', () => {
  const root = freshPoisonedCopy();
  const privateStops = JSON.parse(
    fs.readFileSync(path.join(privateDir, 'bundle', 'demo-route-a1', '1', 'be', 'extended', 'stops.json'), 'utf8'),
  );
  const tokens = privateStops[0].text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  assert.ok(tokens.length >= 8, 'private demo narration must carry at least 8 tokens');
  const gram = tokens.slice(0, 8).join(' ');

  const previewsFile = path.join(root, 'bundle', 'demo-route-a1', '1', 'be', 'base', 'previews.json');
  const previews = JSON.parse(fs.readFileSync(previewsFile, 'utf8'));
  previews[0].announce.be = `${previews[0].announce.be} ${gram}`;
  fs.writeFileSync(previewsFile, JSON.stringify(previews));

  const res = scanWebContentInput({ publicDir: root, privateDir });
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === 'private-text-leak' && v.path.endsWith('previews.json')));
});

test('a corrupt public file cannot be verified and fails with invalid-json', () => {
  const root = freshPoisonedCopy();
  fs.writeFileSync(path.join(root, 'places', 'broken.json'), '{oops');
  const res = scanWebContentInput({ publicDir: root, privateDir });
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === 'invalid-json' && v.path.endsWith('broken.json')));
});
