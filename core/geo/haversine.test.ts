// G05.02.a — acceptance suite for core/geo (issue #210,
// docs/agent-tasks/run/G05.02.a.md). The distance function has no contract
// number of its own — the pipeline stages (pipeline.test.ts) consume it — so
// the suite pins the mathematical anchors instead: zero distance, symmetry,
// and two known arc lengths of the same radius constant the sibling validator
// uses.
// Proof: wronging the formula (dropping the cos(lat) factor) fails the
// equator-arc and symmetry tests.
import assert from 'node:assert/strict';
import test from 'node:test';

import { haversineMeters } from './haversine.ts';

test('haversine: identical points are zero meters apart', () => {
  assert.equal(haversineMeters(54.352, 18.646, 54.352, 18.646), 0);
});

test('haversine: the distance is symmetric in its arguments', () => {
  const ab = haversineMeters(54.352, 18.646, 53.028, 18.62);
  const ba = haversineMeters(53.028, 18.62, 54.352, 18.646);
  assert.equal(ab, ba);
});

test('haversine: one degree of longitude on the equator is ~111.195 km', () => {
  // 2πR/360 with R = 6371008.8 m — the same mean radius as the sibling
  // validator; a degree of longitude shrinks with the cos(lat) factor.
  const oneDegree = haversineMeters(0, 18, 0, 19);
  assert.ok(Math.abs(oneDegree - 111_195) < 5, `expected ~111195 m, got ${oneDegree}`);
});

test('haversine: a longitude degree shortens away from the equator (cos factor)', () => {
  const atEquator = haversineMeters(0, 18, 0, 19);
  const atGdansk = haversineMeters(54, 18, 54, 19);
  assert.ok(Math.abs(atEquator - 111_195) < 5);
  // cos(54°) ≈ 0.588 — the same longitude degree is well over half shorter.
  assert.ok(atGdansk > 0.55 * atEquator && atGdansk < 0.6 * atEquator, `expected ~59 %, got ${atGdansk / atEquator}`);
});
