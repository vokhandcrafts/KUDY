import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activate, verify } from '../lib/package.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let sandbox;
beforeEach(async () => { sandbox = await mkdtemp(path.join(os.tmpdir(), 'kudy-map-')); });
afterEach(async () => rm(sandbox, { recursive: true, force: true }));

async function fixture() { const source = path.join(sandbox, 'source'); await cp(path.join(project, 'source'), source, { recursive: true }); return source; }

test('complete local package activates and survives reload verification', async () => {
  const source = await fixture(), runtime = path.join(sandbox, 'runtime');
  const lock = await activate({ source, runtime });
  assert.equal((await verify(path.join(runtime, 'active'))).version, lock.version);
  const html = await readFile(path.join(runtime, 'active/index.html'), 'utf8');
  assert.match(html, /OpenStreetMap contributors/);
  assert.match(await readFile(path.join(runtime, 'active/map.svg'), 'utf8'), /Długa/);
  assert.equal(JSON.parse(await readFile(path.join(runtime, 'active/markers.json'))).length, 3);
});

test('interruption and insufficient space never replace a ready package', async () => {
  const source = await fixture(), runtime = path.join(sandbox, 'runtime');
  await activate({ source, runtime });
  const original = await readFile(path.join(runtime, 'active/lock.json'), 'utf8');
  await assert.rejects(activate({ source, runtime, interruptAfter: 2 }), /interrupted/);
  await assert.rejects(activate({ source, runtime, capacity: 1 }), /insufficient space/);
  assert.equal(await readFile(path.join(runtime, 'active/lock.json'), 'utf8'), original);
});

test('missing style and tampered assets cannot become ready', async () => {
  const source = await fixture(), runtime = path.join(sandbox, 'runtime');
  await unlink(path.join(source, 'style.json'));
  await assert.rejects(activate({ source, runtime }), /ENOENT/);
  const restored = await fixture();
  await writeFile(path.join(restored, 'map.svg'), '<svg/>');
  await assert.rejects(activate({ source: restored, runtime }), /integrity mismatch/);
});

test('UI declares local assets, zoom bounds, pan, markers, attribution and honest bounds error', async () => {
  const source = await fixture();
  const app = await readFile(path.join(source, 'app.js'), 'utf8');
  const html = await readFile(path.join(source, 'index.html'), 'utf8');
  const style = JSON.parse(await readFile(path.join(source, 'style.json')));
  assert.deepEqual(style.sprite, './sprite');
  assert.equal(style.glyphs, './glyphs/{range}.json');
  assert.doesNotMatch(app, /https?:\/\//);
  assert.match(app, /Math\.min\(16/);
  assert.match(app, /Math\.max\(14/);
  assert.match(app, /onpointermove/);
  assert.match(html, /Outside downloaded region/);
});
