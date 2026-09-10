import test from 'node:test';
import assert from 'node:assert/strict';

import { createSession } from '../src/session.mjs';

const points = [
  { id: 'crane', x: 0, y: 0, radiusM: 20 },
  { id: 'gate', x: 100, y: 0, radiusM: 20 },
  { id: 'fountain', x: 200, y: 0, radiusM: 20 },
];

test('only Start acquires the single location owner and End releases it', () => {
  const session = createSession(points);
  assert.equal(session.snapshot().locationOwner, null);
  session.start({ packageReady: true, version: 'demo-v1' });
  assert.equal(session.snapshot().locationOwner, 'guide-session');
  assert.throws(() => session.acquireLocation('nearby'), /already owned/);
  session.end();
  assert.equal(session.snapshot().locationOwner, null);
  assert.equal(session.snapshot().playing, null);
});

test('Pause releases GPS and neither a fix nor R07 silently resumes it', () => {
  const session = createSession(points);
  session.start({ packageReady: true, version: 'demo-v1' });
  session.pause();
  session.locationFix({ x: 0, y: 0, accuracyM: 3, ageMs: 0, nowMs: 0 });
  session.locationFix({ x: 0, y: 0, accuracyM: 3, ageMs: 0, nowMs: 7000 });
  session.r07Hint();
  assert.equal(session.snapshot().state, 'paused');
  assert.equal(session.snapshot().locationOwner, null);
  assert.equal(session.snapshot().playing, null);
  session.resume();
  assert.equal(session.snapshot().locationOwner, 'guide-session');
});

test('fresh dwell starts one selected-guide audio and never overlaps', () => {
  const session = createSession(points);
  session.start({ packageReady: true, version: 'demo-v1' });
  session.locationFix({ x: 0, y: 0, accuracyM: 3, ageMs: 0, nowMs: 0 });
  session.locationFix({ x: 0, y: 0, accuracyM: 3, ageMs: 0, nowMs: 6000 });
  assert.equal(session.snapshot().playing, 'crane');
  session.manualPlay('gate');
  assert.equal(session.snapshot().playing, 'gate');
  assert.equal(session.snapshot().playerCount, 1);
});

test('stale or inaccurate fixes never autoplay while manual Play stays available', () => {
  const session = createSession(points);
  session.start({ packageReady: true, version: 'demo-v1' });
  session.locationFix({ x: 0, y: 0, accuracyM: 41, ageMs: 0, nowMs: 0 });
  session.locationFix({ x: 0, y: 0, accuracyM: 3, ageMs: 15001, nowMs: 7000 });
  assert.equal(session.snapshot().playing, null);
  session.manualPlay('crane');
  assert.equal(session.snapshot().playing, 'crane');
});

test('permission denial releases the claimed GPS owner and keeps manual Play', () => {
  const session = createSession(points);
  session.start({ packageReady: true, version: 'demo-v1' });
  session.locationUnavailable('permission-denied');
  assert.equal(session.snapshot().state, 'active');
  assert.equal(session.snapshot().locationOwner, null);
  session.manualPlay('gate');
  assert.equal(session.snapshot().playing, 'gate');
});

test('interruption does not finish or resume audio without a person', () => {
  const session = createSession(points);
  session.start({ packageReady: true, version: 'demo-v1' });
  session.manualPlay('crane');
  session.interrupt();
  session.focusRegained();
  assert.equal(session.snapshot().playing, null);
  assert.equal(session.snapshot().autoplaySuspended, true);
  assert.deepEqual(session.snapshot().heard, []);
  session.manualPlay('crane');
  session.audioFinished();
  assert.deepEqual(session.snapshot().heard, ['crane']);
});

test('Start rejects incomplete content and pins version through Pause/Resume', () => {
  const session = createSession(points);
  assert.throws(() => session.start({ packageReady: false, version: 'demo-v1' }), /fully verified/);
  session.start({ packageReady: true, version: 'demo-v1' });
  session.pause();
  session.resume({ catalogVersion: 'demo-v2' });
  assert.equal(session.snapshot().version, 'demo-v1');
});

test('local progress is unchanged by analytics consent', () => {
  const session = createSession(points);
  session.start({ packageReady: true, version: 'demo-v1' });
  session.manualPlay('fountain');
  session.setAnalyticsConsent(false);
  session.audioFinished();
  assert.deepEqual(session.snapshot().heard, ['fountain']);
  assert.deepEqual(session.diagnostics().serverPayloads, []);
});
