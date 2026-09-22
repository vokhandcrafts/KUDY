// G10.01.c acceptance suite: the stop pages over the demo-route fixture.
// Data-level checks (node --test does not execute JSX) — the rendered output
// itself is proven by the build-time scan over the real export and the
// Showboat demo. The guards here fail when the manual/no-storage contract is
// reverted (implementation-rules 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SiteDataError, readSiteStopPage, stopStaticParams } from './site.ts';
import { buildDemoFixture } from './test-fixture.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const { publicRoot } = await buildDemoFixture();

test('the free stop page carries the transcript, per-locale audio by fact and display-order neighbors', () => {
  const page = readSiteStopPage(publicRoot, 'be', 'demo-route-a1', 'stop-1');
  assert.equal(page.locked, false);
  assert.equal(page.name, 'Двор сукнараў (дэма)');
  assert.equal(page.route_title, 'Дэма-гід: сукнаны двор');
  assert.equal(page.guide_href, '/guides/demo-route-a1');
  if (page.locked) throw new Error('stop-1 must be free');
  // The full spoken text of the base story, server-rendered (M3).
  const fixture = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'fixtures', 'content', 'demo-route', 'be', 'base', 'stops.json'), 'utf8'),
  );
  assert.equal(page.transcript, fixture[0].transcript);
  // Audio is offered per bundle locale whose base audio actually exists
  // (09 §8); uk is text-only and must not appear.
  assert.deepEqual(page.audio, [
    { locale: 'be', src: '/content/bundle/demo-route-a1/1/be/base/audio/story-1-base.m4a' },
    { locale: 'en', src: '/content/bundle/demo-route-a1/1/en/base/audio/story-1-base.m4a' },
  ]);
  // Display order only (09 §3): the first stop has no previous; the next one
  // is the locked stop with its preview name.
  assert.equal(page.prev, null);
  assert.deepEqual(page.next, {
    stop_id: 'stop-2',
    name: 'Млынавая калона (дэма)',
    href: '/guides/demo-route-a1/stops/stop-2',
  });
});

test('the en stop page renders the en transcript behind the locale-prefixed hrefs', () => {
  const page = readSiteStopPage(publicRoot, 'en', 'demo-route-a1', 'stop-1');
  assert.equal(page.name, "Cloth Merchants' Courtyard (demo)");
  if (page.locked) throw new Error('stop-1 must be free');
  const fixture = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'fixtures', 'content', 'demo-route', 'en', 'base', 'stops.json'), 'utf8'),
  );
  assert.equal(page.transcript, fixture[0].transcript);
  assert.equal(page.guide_href, '/en/guides/demo-route-a1');
  assert.equal(page.next?.href, '/en/guides/demo-route-a1/stops/stop-2');
});

test('the locked stop page data carries the preview only — no audio, no transcript field exists', () => {
  const page = readSiteStopPage(publicRoot, 'be', 'demo-route-a1', 'stop-2');
  assert.equal(page.locked, true);
  assert.deepEqual(Object.keys(page).sort(), [
    'announce',
    'guide_href',
    'locked',
    'name',
    'next',
    'prev',
    'route_id',
    'route_title',
    'stop_id',
  ]);
  assert.match(page.announce, /млына/);
  assert.equal(page.prev?.stop_id, 'stop-1');
  assert.equal(page.next, null);
});

test('unknown route or stop is a defined rejection; only catalog stops are prerendered', () => {
  assert.throws(
    () => readSiteStopPage(publicRoot, 'be', 'no-such-route', 'stop-1'),
    (err: unknown) => err instanceof SiteDataError && err.code === 'not-found',
  );
  assert.throws(
    () => readSiteStopPage(publicRoot, 'be', 'demo-route-a1', 'no-such-stop'),
    (err: unknown) => err instanceof SiteDataError && err.code === 'not-found',
  );
  assert.deepEqual(stopStaticParams(publicRoot), [
    { route_id: 'demo-route-a1', stop_id: 'stop-1' },
    { route_id: 'demo-route-a1', stop_id: 'stop-2' },
  ]);
});

test('a missing audio file is a user-visible failure state, not silence; the transcript stays readable', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-web-stop-'));
  fs.cpSync(publicRoot, copy, { recursive: true });
  const audioDir = path.join(copy, 'bundle', 'demo-route-a1', '1', 'be', 'base', 'audio');
  fs.rmSync(path.join(audioDir, 'story-1-base.m4a'));
  const page = readSiteStopPage(copy, 'be', 'demo-route-a1', 'stop-1');
  if (page.locked) throw new Error('stop-1 must be free');
  // be lost its file, en still carries one — availability by fact (09 §8).
  assert.deepEqual(page.audio.map((track) => track.locale), ['en']);
  assert.ok(page.transcript.length > 0);
  fs.rmSync(path.join(copy, 'bundle', 'demo-route-a1', '1', 'en', 'base', 'audio'), { recursive: true });
  const silent = readSiteStopPage(copy, 'be', 'demo-route-a1', 'stop-1');
  if (silent.locked) throw new Error('stop-1 must be free');
  assert.deepEqual(silent.audio, []);
  assert.ok(silent.transcript.length > 0, 'the failure state keeps the transcript readable');
});

test('the stop pages keep the stable URL scheme the future deep links mirror (09 §13 M7)', () => {
  const page = readSiteStopPage(publicRoot, 'be', 'demo-route-a1', 'stop-1');
  assert.match(page.guide_href, /^\/guides\/demo-route-a1$/);
  assert.match(page.next?.href ?? '', /^\/guides\/demo-route-a1\/stops\/stop-2$/);
});

test('the stop components stay server-rendered and manual — no client JS, no storage, no autoplay', () => {
  const sources = [
    'web/components/stop-page.tsx',
    'web/components/manual-audio-player.tsx',
    'web/app/not-found.tsx',
    'web/app/guides/[route_id]/stops/[stop_id]/page.tsx',
    'web/app/en/guides/[route_id]/stops/[stop_id]/page.tsx',
  ].map((rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
  assert.ok(sources.every((source) => source.length > 0));
  for (const source of sources) {
    assert.doesNotMatch(source, /["']use client["']/, 'the manual pages ship no client component');
    assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|navigator\.|fetch\(|gtag|analytics/i, 'nothing about the visitor is persisted or reported');
  }
  // The player stays the standard element with manual playback semantics
  // (task step 1): controls on, preload off, no autoplay attribute.
  const player = sources[1]!;
  assert.match(player, /audio controls preload="none"/);
  assert.doesNotMatch(player, /autoplay/);
});
