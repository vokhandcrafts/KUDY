// G04.03 — acceptance suite for services/contentRepo (issue #60). Criteria:
// 1. start blocked for an incomplete selected package;
// 2. a free start requires no locked (extended) files;
// 3. a ready package evaluates ready purely locally, no network;
// 4. a media error makes the package unavailable and offers recovery;
// 5. the discovery cache is its own concern, separate from AccessReady —
//    a missing index never breaks the guide.
// Fixtures (synthetic package + store stubs) live in test-fixture.ts; the
// final test also walks the real content/author-template package (G02.05).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { evaluatePackage, createDiscoveryCache } from './contentRepo.ts';
import { storeAt, stubWithUnreadable, tempPackage } from './test-fixture.ts';

test('criterion 1: a missing structural file blocks start with a named reason', async () => {
  const { root, remove } = tempPackage();
  try {
    fs.rmSync(`${root}/route.json`);
    assert.equal((await evaluatePackage(storeAt(root), { locale: 'be', tier: 'base' })).status, 'incomplete');
  } finally {
    remove();
  }
});

test('criterion 1: every structural absence and broken reference is named, none crash', async () => {
  const { root, remove } = tempPackage();
  try {
    fs.rmSync(`${root}/be/base/stops.json`);
    fs.rmSync(`${root}/places.json`);
    fs.writeFileSync(`${root}/voices.json`, '{not json');
    const result = await evaluatePackage(storeAt(root), { locale: 'be', tier: 'base' });
    assert.equal(result.status, 'incomplete');
    if (result.status !== 'incomplete') return;
    assert.deepEqual(result.missing.sort(), [
      'be/base/stops.json#missing-file',
      'places.json#missing-file',
      'voices.json#invalid-json',
    ]);
  } finally {
    remove();
  }
});

test('criterion 1: route.json identity must match the selected package key', async () => {
  const { root, remove } = tempPackage();
  try {
    const result = await evaluatePackage(storeAt(root, { routeId: 'route-x', version: '2' }), { locale: 'be', tier: 'base' });
    assert.deepEqual(result, { status: 'incomplete', missing: ['route.json#identity-mismatch'] });
  } finally {
    remove();
  }
});

test('criterion 1: a story voice and a stop place must resolve inside the package', async () => {
  const { root, remove } = tempPackage();
  try {
    fs.writeFileSync(`${root}/be/base/stops.json`, JSON.stringify([{ story_id: 'story-b', place_id: 'place-1', voice_id: 'voice-404', tier: 'base', duration_s: 60, text: 'т', transcript: 'т', sources: ['с'] }]));
    fs.writeFileSync(`${root}/route.json`, JSON.stringify({
      route_id: 'route-x',
      version: '1',
      city_id: 'city-x',
      access: 'paid',
      stops: [
        { id: 'stop-1', position: 0, place_id: 'place-1', access_tier: 'base' },
        { id: 'stop-3', position: 2, place_id: 'place-404', access_tier: 'base' },
      ],
    }));
    const result = await evaluatePackage(storeAt(root), { locale: 'be', tier: 'base' });
    assert.equal(result.status, 'incomplete');
    if (result.status !== 'incomplete') return;
    assert.deepEqual(result.missing.sort(), [
      'places.json#unknown-ref:place-404',
      'voices.json#unknown-ref:voice-404',
    ]);
  } finally {
    remove();
  }
});

test('criterion 1: route.json without its schema-required stops array is not ready', async () => {
  const { root, remove } = tempPackage();
  try {
    fs.writeFileSync(`${root}/route.json`, JSON.stringify({ ...JSON.parse(fs.readFileSync(`${root}/route.json`, 'utf8')), stops: undefined }));
    const result = await evaluatePackage(storeAt(root), { locale: 'be', tier: 'base' });
    assert.deepEqual(result, { status: 'incomplete', missing: ['route.json#type'] });
  } finally {
    remove();
  }
});

test('criterion 1: a story_id carrying path separators is a packaging fault, not a lookup', async () => {
  const { root, remove } = tempPackage();
  try {
    fs.writeFileSync(`${root}/be/base/stops.json`, JSON.stringify([{ ...JSON.parse(fs.readFileSync(`${root}/be/base/stops.json`, 'utf8'))[0], story_id: '../evil' }]));
    const result = await evaluatePackage(storeAt(root), { locale: 'be', tier: 'base' });
    assert.deepEqual(result, { status: 'incomplete', missing: ['be/base/stops.json#unsafe-path:../evil'] });
  } finally {
    remove();
  }
});

test('criterion 2: with the whole extended layer gone, a base start is ready', async () => {
  const { root, remove } = tempPackage();
  try {
    fs.rmSync(`${root}/be/extended`, { recursive: true, force: true });
    const result = await evaluatePackage(storeAt(root), { locale: 'be', tier: 'base' });
    assert.deepEqual(result, {
      status: 'ready',
      routeId: 'route-x',
      version: '1',
      tier: 'base',
      tierAvailable: ['base'],
    });
  } finally {
    remove();
  }
});

test('criterion 3: evaluation stays pure-local — a ready package reads ready offline', async () => {
  const { root, remove } = tempPackage();
  try {
    const result = await evaluatePackage(storeAt(root), { locale: 'be', tier: 'base', grantedTiers: ['extended'] });
    assert.equal(result.status, 'ready');
  } finally {
    remove();
  }
});

test('criterion 4: missing, empty and unreadable media all ask for recovery by path', async () => {
  const { root, remove } = tempPackage();
  try {
    fs.rmSync(`${root}/be/base/audio/story-b.m4a`);
    assert.deepEqual(
      await evaluatePackage(storeAt(root), { locale: 'be', tier: 'base' }),
      { status: 'needs-recovery', media: ['be/base/audio/story-b.m4a'] },
    );
    fs.writeFileSync(`${root}/be/base/audio/story-b.m4a`, '');
    assert.equal((await evaluatePackage(storeAt(root), { locale: 'be', tier: 'base' })).status, 'needs-recovery');
    const stubbed = await evaluatePackage(
      stubWithUnreadable(storeAt(root), 'be/base/audio/story-b.m4a'),
      { locale: 'be', tier: 'base' },
    );
    assert.equal(stubbed.status, 'needs-recovery');
  } finally {
    remove();
  }
});

test('criterion 4 precedence: damaged media is reported before a missing purchase grant', async () => {
  const { root, remove } = tempPackage();
  try {
    fs.rmSync(`${root}/be/extended/audio/story-e.m4a`);
    const result = await evaluatePackage(storeAt(root), { locale: 'be', tier: 'extended', grantedTiers: [] });
    assert.deepEqual(result, { status: 'needs-recovery', media: ['be/extended/audio/story-e.m4a'] });
  } finally {
    remove();
  }
});

test('criterion 5: a missing discovery index neither blocks start nor fabricates offers', async () => {
  const { root, remove } = tempPackage();
  try {
    fs.rmSync(`${root}/discovery.json`);
    assert.equal((await evaluatePackage(storeAt(root), { locale: 'be', tier: 'base' })).status, 'ready');
    const lookup = await createDiscoveryCache().read(storeAt(root));
    assert.deepEqual(lookup, { revision: null, index: null, fromCache: false });
  } finally {
    remove();
  }
});

test('criterion 5: the discovery cache caches good reads and ignores access state', async () => {
  const { root, remove } = tempPackage();
  try {
    const cache = createDiscoveryCache();
    const first = await cache.read(storeAt(root));
    assert.equal(first.revision, 'r-1');
    assert.equal(first.fromCache, false);
    const second = await cache.read(storeAt(root));
    assert.equal(second.fromCache, true);
    // AccessReady state and the discovery cache are separate concerns: the
    // locked extended tier does not touch the cached index.
    const locked = await evaluatePackage(storeAt(root), { locale: 'be', tier: 'extended', grantedTiers: [] });
    assert.deepEqual(locked, { status: 'access-locked', tier: 'extended' });
    assert.deepEqual(await cache.read(storeAt(root)), { ...second, fromCache: true });
  } finally {
    remove();
  }
});

test('paid extended start: granted tier becomes ready with both layers available', async () => {
  const { root, remove } = tempPackage();
  try {
    const result = await evaluatePackage(storeAt(root), { locale: 'be', tier: 'extended', grantedTiers: ['extended'] });
    assert.deepEqual(result, {
      status: 'ready',
      routeId: 'route-x',
      version: '1',
      tier: 'extended',
      tierAvailable: ['base', 'extended'],
    });
  } finally {
    remove();
  }
});

test('text-only layers need no media; the real template package starts in be and en', async () => {
  const template = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'author-template');
  const be = await evaluatePackage(storeAt(template, { routeId: 'template-route-1', version: '1' }), { locale: 'be', tier: 'base' });
  assert.equal(be.status, 'ready');
  const en = await evaluatePackage(storeAt(template, { routeId: 'template-route-1', version: '1' }), { locale: 'en', tier: 'base' });
  assert.equal(en.status, 'ready');
  const locked = await evaluatePackage(storeAt(template, { routeId: 'template-route-1', version: '1' }), { locale: 'be', tier: 'extended', grantedTiers: [] });
  assert.deepEqual(locked, { status: 'access-locked', tier: 'extended' });
});
