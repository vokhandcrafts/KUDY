// G05.02.c AC1 — behavioral tests of the pure OS-fix mapping on synthetic
// inputs. Every corrupt shape is rejected with the pipeline's own named
// reason and never passed on; reverting the mapping to a pass-through (or
// mapping a missing accuracy to 0 — the task card's proof scenario) turns
// the negative tests red (implementation-rules 1).
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapOsLocationToFix, type OsLocationObject } from './fix-mapping.ts';

const osFix = (over: Partial<OsLocationObject> = {}): OsLocationObject => ({
  coords: { latitude: 54.4, longitude: 18.65, accuracy: 12 },
  timestamp: 1_000,
  ...over,
});

test('AC1: a well-formed OS location maps onto the port FixInput as is', () => {
  const result = mapOsLocationToFix(osFix());
  assert.deepEqual(result, { ok: true, fix: { lat: 54.4, lng: 18.65, accuracy: 12, at: 1_000 } });
});

test('AC1 proof: a missing accuracy is rejected missing-accuracy, never mapped to 0', () => {
  // Android batches report null accuracy — the shape check sees a non-number.
  const result = mapOsLocationToFix(osFix({ coords: { latitude: 54.4, longitude: 18.65, accuracy: null } }));
  assert.deepEqual(result, { ok: false, reason: 'missing-accuracy' });
});

test('AC1: a non-finite accuracy is rejected missing-accuracy', () => {
  const result = mapOsLocationToFix(osFix({ coords: { latitude: 54.4, longitude: 18.65, accuracy: Number.NaN } }));
  assert.deepEqual(result, { ok: false, reason: 'missing-accuracy' });
});

test('AC1: a negative accuracy is rejected negative-accuracy', () => {
  const result = mapOsLocationToFix(osFix({ coords: { latitude: 54.4, longitude: 18.65, accuracy: -1 } }));
  assert.deepEqual(result, { ok: false, reason: 'negative-accuracy' });
});

test('AC1: out-of-range latitudes are rejected latitude-out-of-range, both sides', () => {
  assert.deepEqual(mapOsLocationToFix(osFix({ coords: { latitude: 90.0001, longitude: 18.65, accuracy: 5 } })), {
    ok: false,
    reason: 'latitude-out-of-range',
  });
  assert.deepEqual(mapOsLocationToFix(osFix({ coords: { latitude: -90.0001, longitude: 18.65, accuracy: 5 } })), {
    ok: false,
    reason: 'latitude-out-of-range',
  });
});

test('AC1: the range bounds themselves stay accepted', () => {
  assert.deepEqual(mapOsLocationToFix(osFix({ coords: { latitude: 90, longitude: 18.65, accuracy: 5 } })).ok, true);
  assert.deepEqual(mapOsLocationToFix(osFix({ coords: { latitude: -90, longitude: 18.65, accuracy: 5 } })).ok, true);
});

test('AC1: non-finite coordinates are rejected non-finite-coordinate', () => {
  assert.deepEqual(mapOsLocationToFix(osFix({ coords: { latitude: Number.NaN, longitude: 18.65, accuracy: 5 } })), {
    ok: false,
    reason: 'non-finite-coordinate',
  });
  assert.deepEqual(mapOsLocationToFix(osFix({ coords: { latitude: 54.4, longitude: Number.POSITIVE_INFINITY, accuracy: 5 } })), {
    ok: false,
    reason: 'non-finite-coordinate',
  });
});

test('AC1: a non-finite timestamp is rejected non-finite-timestamp', () => {
  const result = mapOsLocationToFix(osFix({ timestamp: Number.NaN }));
  assert.deepEqual(result, { ok: false, reason: 'non-finite-timestamp' });
});

test('AC1: a rejected fix carries no fix field at all — nothing is passed on', () => {
  const result = mapOsLocationToFix(osFix({ coords: { latitude: 54.4, longitude: 18.65, accuracy: null } }));
  assert.equal('fix' in result, false);
});

test('AC1: an OS entry without readable coords answers with a named reason, never a throw', () => {
  // A batch entry the OS mangled: the mapping is the boundary and must not
  // throw into the TaskManager callback or the native watch emitter.
  assert.deepEqual(mapOsLocationToFix({ coords: null, timestamp: 1_000 } as unknown as OsLocationObject), {
    ok: false,
    reason: 'non-finite-coordinate',
  });
  assert.deepEqual(
    mapOsLocationToFix({ coords: { longitude: 18.65, accuracy: 5 }, timestamp: 1_000 } as unknown as OsLocationObject),
    { ok: false, reason: 'non-finite-coordinate' },
  );
});
