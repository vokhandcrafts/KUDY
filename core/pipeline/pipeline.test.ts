// G05.02.a — acceptance suite for the location pipeline (issue #210,
// docs/agent-tasks/run/G05.02.a.md).
// Criteria:
// 1. Fixed stage order; every rejection happens before any state mutation —
//    one deep-equal test per rejecting stage, plus two order-pinning tests
//    (a fix that fails two stages at once is rejected by the earlier one).
// 2. Accuracy gate 40 m and spike rejection (12 km/h on increasing time,
//    5 m displacement on non-increasing time) — bounds tested on both sides;
//    the canon numbers are pinned here, not imported from the module.
// 3. Smoothing is the plain mean of the last 3 accepted coordinates and
//    never leaves their bounding box (seeded property test).
// 4. Dwell accumulates on the smoothed point, resets when the stop leaves
//    the radius, emits DwellCompleted once per continuous dwell; dwell_ms
//    comes from PipelineConfig.
// 5. Distances for all passed-in stops; simultaneous completions ordered by
//    distance, then stop_id; shuffled candidate maps give identical output
//    (seeded property test).
// 6. Corrupt input rejected with named reasons, never thrown — one isolated
//    test per reason (implementation-rules 14).
// 7. core/ import boundary — machine-checked by `npm run arch:check` in the
//    pre-push gate; no clock, network, disk or RN import exists here.
// Proof: moving the accuracy gate after smoothing fails «criterion 1: an
// accuracy-gate rejection leaves the window and dwell accumulators
// deep-equal» (the window would already carry the bad fix).
import assert from 'node:assert/strict';
import test from 'node:test';

import { haversineMeters } from '../geo/haversine.ts';
import { acceptFix, defaultPipelineConfig } from './pipeline.ts';
import {
  initialPipelineState,
  type AcceptResult,
  type FixInput,
  type PipelineCandidate,
  type PipelineState,
} from './types.ts';

const NOW = 1_000_000;
// Meters per degree of latitude under the sibling radius constant — see
// haversine.test.ts. Used only to place fixtures; the code under test
// measures with haversineMeters.
const M_PER_DEG = 111_195;
const BASE = { lat: 54.35, lng: 18.65 };

const north = (p: { lat: number; lng: number }, meters: number) => ({
  lat: p.lat + meters / M_PER_DEG,
  lng: p.lng,
});
const south = (p: { lat: number; lng: number }, meters: number) => ({
  lat: p.lat - meters / M_PER_DEG,
  lng: p.lng,
});

const fix = (overrides: Partial<FixInput> = {}): FixInput => ({
  lat: BASE.lat,
  lng: BASE.lng,
  accuracy: 5,
  at: NOW,
  ...overrides,
});

const candidate = (stopId: string, p: { lat: number; lng: number }, radius = 50): [string, PipelineCandidate] => [
  stopId,
  { lat: p.lat, lng: p.lng, radius },
];

const accept = (
  state: PipelineState,
  f: FixInput,
  candidates: ReadonlyMap<string, PipelineCandidate> = new Map(),
  config = defaultPipelineConfig,
): AcceptResult => acceptFix(state, f, candidates, Number.MAX_SAFE_INTEGER, config);

// Runs the fixes in order through acceptFix, threading the returned state.
const walk = (
  fixes: FixInput[],
  candidates: ReadonlyMap<string, PipelineCandidate> = new Map(),
  config = defaultPipelineConfig,
): AcceptResult[] => {
  const results: AcceptResult[] = [];
  for (const f of fixes) {
    const previous = results[results.length - 1]?.state ?? initialPipelineState;
    results.push(accept(previous, f, candidates, config));
  }
  return results;
};

const mulberry32 = (seed: number): (() => number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const shuffled = <T,>(items: T[], rng: () => number): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// A state with a two-fix window at BASE and stop-a dwelling at 1000 ms —
// every rejection test starts here so the deep-equal claim covers both owned
// structures (the window and a non-empty accumulator).
const seededState = (config = defaultPipelineConfig): PipelineState => {
  const results = walk([fix({ at: NOW }), fix({ at: NOW + 1000 })], new Map([candidate('stop-a', BASE)]), config);
  const last = results[results.length - 1];
  assert.ok(last.accepted);
  return last.state;
};

test('criterion 1: a corrupt fix leaves the window and dwell accumulators deep-equal', () => {
  const state = seededState();
  const result = accept(state, fix({ lat: Number.NaN }));
  assert.equal(result.accepted, false);
  assert.deepEqual(result, { accepted: false, reason: 'non-finite-coordinate', state });
  assert.deepEqual(result.state, state);
});

test('criterion 1: an accuracy-gate rejection leaves the window and dwell accumulators deep-equal', () => {
  const state = seededState();
  const result = accept(state, fix({ accuracy: 40.01 }));
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'accuracy');
  assert.deepEqual(result.state, state);
});

test('criterion 1: a spike-speed rejection leaves the window and dwell accumulators deep-equal', () => {
  const state = seededState();
  const result = accept(state, fix({ ...north(BASE, 100), at: NOW + 1001 }));
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'spike-speed');
  assert.deepEqual(result.state, state);
});

test('criterion 1: a spike-displacement rejection leaves the window and dwell accumulators deep-equal', () => {
  const state = seededState();
  const result = accept(state, fix({ ...north(BASE, 5.01), at: NOW + 1000 }));
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'spike-displacement');
  assert.deepEqual(result.state, state);
});

test('criterion 1: the corrupt-input check runs before the accuracy gate', () => {
  const result = accept(initialPipelineState, fix({ lat: Number.NaN, accuracy: 100 }));
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'non-finite-coordinate');
});

test('criterion 1: the accuracy gate runs before spike rejection', () => {
  const state = seededState();
  // 100 m in 1 ms is a hopeless spike, but the claimed 50 m precision fails
  // at the earlier stage.
  const result = accept(state, fix({ ...north(BASE, 100), accuracy: 50, at: NOW + 1001 }));
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'accuracy');
});

test('criterion 2: accuracy of exactly 40 m is accepted, just above is rejected', () => {
  const accepted = accept(initialPipelineState, fix({ accuracy: 40 }));
  assert.ok(accepted.accepted);
  const rejected = accept(initialPipelineState, fix({ accuracy: 40.01 }));
  assert.deepEqual(rejected, { accepted: false, reason: 'accuracy', state: initialPipelineState });
});

test('criterion 2: implied speed just above 12 km/h is rejected, just below accepted', () => {
  // The spike stage compares against the previous accepted fix, so the walk
  // starts with one accepted fix at BASE. ~100 m along a meridian; the exact
  // arc comes from the same haversine the pipeline uses, and the ±1 % time
  // margin keeps the case off float dust.
  const start = accept(initialPipelineState, fix({ at: NOW }));
  assert.ok(start.accepted);
  const to = north(BASE, 100);
  const d = haversineMeters(BASE.lat, BASE.lng, to.lat, to.lng);
  const boundaryMs = (d / (12 / 3.6)) * 1000;

  const tooFast = accept(start.state, fix({ ...to, at: NOW + boundaryMs * 0.99 }));
  assert.equal(tooFast.accepted, false);
  assert.equal(tooFast.reason, 'spike-speed');

  const walking = accept(start.state, fix({ ...to, at: NOW + boundaryMs * 1.01 }));
  assert.ok(walking.accepted);
});

test('criterion 2: displacement just above 5 m at non-increasing time is rejected, just below accepted', () => {
  const start = accept(initialPipelineState, fix({ at: NOW }));
  assert.ok(start.accepted);
  const sameTime = { at: NOW }; // non-increasing → displacement branch

  const close = accept(start.state, fix({ ...north(BASE, 4.99), ...sameTime }));
  assert.ok(close.accepted);

  const far = accept(start.state, fix({ ...north(BASE, 5.01), ...sameTime }));
  assert.equal(far.accepted, false);
  assert.equal(far.reason, 'spike-displacement');
});

test('criterion 3: smoothing is the plain mean of the accepted window, oldest fix dropped after three', () => {
  const lats = [BASE.lat, north(BASE, 4).lat, north(BASE, 8).lat, north(BASE, 12).lat];
  // Same timestamp on every fix: each 4 m step passes the displacement gate,
  // and the dwell side stays inert so the test isolates smoothing.
  const results = walk([
    fix({ lat: lats[0], at: NOW }),
    fix({ lat: lats[1], at: NOW }),
    fix({ lat: lats[2], at: NOW }),
    fix({ lat: lats[3], at: NOW }),
  ]);
  const accepted = results.map((r) => {
    assert.ok(r.accepted);
    return r.fix;
  });
  assert.equal(accepted[0].lat, lats[0]);
  assert.equal(accepted[1].lat, (lats[0] + lats[1]) / 2);
  assert.equal(accepted[2].lat, (lats[0] + lats[1] + lats[2]) / 3);
  assert.equal(accepted[3].lat, (lats[1] + lats[2] + lats[3]) / 3);

  const last = results[results.length - 1];
  assert.ok(last.accepted);
  assert.deepEqual(
    last.state.window.map((f) => f.lat),
    [lats[1], lats[2], lats[3]],
  );
});

test('criterion 3: property — the smoothed point is the window mean and never leaves its bounding box', () => {
  const rng = mulberry32(20260924);
  let state = initialPipelineState;
  let lat = BASE.lat;
  let at = NOW;
  for (let i = 0; i < 300; i += 1) {
    // Independent ±4 m steps: worst-case diagonal ~5.7 m per 60 s — far
    // below the 12 km/h gate on increasing time. Longitude degrees at this
    // latitude are shorter, so the real step is even smaller.
    lat += (rng() - 0.5) * 2 * (4 / M_PER_DEG);
    at += 60_000;
    const f = fix({ lat, lng: 0.5 + (rng() - 0.5) * 2 * (4 / M_PER_DEG), at });
    const result = accept(state, f);
    assert.ok(result.accepted, `step ${i} unexpectedly rejected: ${JSON.stringify(result)}`);
    const window = result.state.window;
    assert.ok(window.length <= 3);
    const lats = window.map((w) => w.lat);
    const lngs = window.map((w) => w.lng);
    assert.equal(result.fix.lat, window.reduce((s, w) => s + w.lat, 0) / window.length);
    assert.equal(result.fix.lng, window.reduce((s, w) => s + w.lng, 0) / window.length);
    assert.ok(result.fix.lat >= Math.min(...lats) && result.fix.lat <= Math.max(...lats));
    assert.ok(result.fix.lng >= Math.min(...lngs) && result.fix.lng <= Math.max(...lngs));
    state = result.state;
  }
});

test('criterion 4: dwell completes once per continuous dwell at dwell_ms and never re-fires while staying', () => {
  const candidates = new Map([candidate('stop-a', BASE)]);
  const config = { dwellMs: 3000 };
  const results = walk(
    [
      fix({ at: NOW }),
      fix({ at: NOW + 1000 }),
      fix({ at: NOW + 2000 }),
      fix({ at: NOW + 3000 }),
      fix({ at: NOW + 4000 }),
      fix({ at: NOW + 5000 }),
    ],
    candidates,
    config,
  );
  const completions = results.flatMap((r) => (r.accepted ? r.events.filter((e) => e.type === 'DwellCompleted') : []));
  assert.deepEqual(
    completions,
    [{ type: 'DwellCompleted', stopId: 'stop-a', radius: 50 }],
    'exactly one completion, on the fix where the accumulator reaches dwell_ms',
  );
  const completing = results[3];
  assert.ok(completing.accepted);
  assert.deepEqual(completing.events, [
    { type: 'LocationAccepted', fix: completing.fix },
    { type: 'DwellCompleted', stopId: 'stop-a', radius: 50 },
  ]);
});

test('criterion 4: the accumulator resets when the stop leaves the radius and restarts from zero', () => {
  // Geometry accounts for both smoothing and the 12 km/h gate: the smoothed
  // point trails the raw walk, so leaving takes the mean of 40/50/65 = 51.7 m
  // (radius 50), and every step stays at a walking pace. dwell_ms 25 000 is
  // higher than any accumulator value the exit walk can reach (22 000 before
  // the reset fix), so a KEPT accumulator would fire on the reset fix itself
  // (22 000 + the 5 000 ms exit step); the restarted one — crediting nothing
  // on entry (implementation-rules review fix: entry credits no dt) — needs
  // twenty-five full 1 000 ms steps after re-entry.
  const candidates = new Map([candidate('stop-a', BASE)]);
  const config = { dwellMs: 25_000 };
  const T = NOW;
  const fixes: FixInput[] = [
    fix({ at: T }), // inside; fresh accumulator: 0 (dt 0 anyway)
    fix({ at: T + 1000 }), // 1000
    fix({ at: T + 2000 }), // 2000
    fix({ ...north(BASE, 10), at: T + 6000 }), // smoothed 3.3 → inside; 6000
    fix({ ...north(BASE, 20), at: T + 10_000 }), // 10 → inside; 10 000
    fix({ ...north(BASE, 30), at: T + 14_000 }), // 20 → inside; 14 000
    fix({ ...north(BASE, 40), at: T + 18_000 }), // 30 → inside; 18 000
    fix({ ...north(BASE, 50), at: T + 22_000 }), // 40 → inside; 22 000
    fix({ ...north(BASE, 65), at: T + 27_000 }), // 51.7 → OUTSIDE → reset
    fix({ ...north(BASE, 65), at: T + 28_000 }), // 60 → outside
    fix({ ...north(BASE, 15), at: T + 44_000 }), // 48.3 → inside; entry credits 0
  ];
  for (let i = 0; i < 25; i += 1) {
    fixes.push(fix({ ...north(BASE, 15), at: T + 45_000 + i * 1000 })); // 1000 … 25 000
  }
  const results = walk(fixes, candidates, config);
  const fires = results
    .map((r, i) => (r.accepted && r.events.some((e) => e.type === 'DwellCompleted') ? i : -1))
    .filter((i) => i >= 0);
  assert.deepEqual(fires, [35], 'a kept accumulator would fire on the reset fix itself (index 8)');
});

test('criterion 4: the fix that (re-)enters a radius credits no dwell time', () => {
  // The stop was never dwelling: the smoothed point sits at 100 m, then
  // 80 m — outside the 50 m radius. The entry fix lands after a 25 s legal
  // step (11.5 km/h) and its dt spans that outside time — a code path
  // crediting dt to a fresh accumulator (the review's dwell-entry-credit
  // finding) would complete the dwell on entry itself. With the fix the
  // accumulator starts at 0 and completes six steps later; reverting the
  // fix moves the fire to the entry fix (index 2).
  const candidates = new Map([candidate('stop-a', BASE)]);
  const config = { dwellMs: 6000 };
  const results = walk(
    [
      fix({ ...north(BASE, 100), at: NOW }), // smoothed 100 → outside
      fix({ ...north(BASE, 60), at: NOW + 31_000 }), // 40 m in 31 s; smoothed 80 → outside
      fix({ ...south(BASE, 20), at: NOW + 56_000 }), // 80 m in 25 s = 11.5 km/h;
      // window mean (100+60−20)/3 = 46.7 → INSIDE; entry credits none of the 25 000 ms
      fix({ ...south(BASE, 20), at: NOW + 57_000 }),
      fix({ ...south(BASE, 20), at: NOW + 58_000 }),
      fix({ ...south(BASE, 20), at: NOW + 59_000 }),
      fix({ ...south(BASE, 20), at: NOW + 60_000 }),
      fix({ ...south(BASE, 20), at: NOW + 61_000 }),
      fix({ ...south(BASE, 20), at: NOW + 62_000 }), // 6000 accumulated after entry → fires
    ],
    candidates,
    config,
  );
  const fires = results
    .map((r, i) => (r.accepted && r.events.some((e) => e.type === 'DwellCompleted') ? i : -1))
    .filter((i) => i >= 0);
  assert.deepEqual(fires, [8], 'the entry fix (index 2) must not complete the dwell with its 25 000 ms dt');
});

test('criterion 4: dwell judges the smoothed point, not the raw fix', () => {
  const stop = candidate('stop-a', BASE, 10);
  const config = { dwellMs: 1000 };
  const results = walk(
    [
      fix({ ...north(BASE, 2), at: NOW }), // inside, dt 0
      fix({ ...north(BASE, 14), at: NOW + 4000 }), // raw 14 m is outside, smoothed (2+14)/2 = 8 m inside
    ],
    new Map([stop]),
    config,
  );
  const second = results[1];
  assert.ok(second.accepted);
  assert.ok(
    second.events.some((e) => e.type === 'DwellCompleted' && e.stopId === 'stop-a'),
    'the accumulator must grow on the smoothed point even when the raw fix sits outside the radius',
  );
});

test('criterion 4: dwell_ms comes from PipelineConfig, not a literal', () => {
  const candidates = new Map([candidate('stop-a', BASE)]);
  const results = walk([fix({ at: NOW }), fix({ at: NOW + 1000 }), fix({ at: NOW + 2000 })], candidates, {
    dwellMs: 2000,
  });
  const third = results[2];
  assert.ok(third.accepted);
  assert.ok(third.events.some((e) => e.type === 'DwellCompleted'));
  assert.equal(defaultPipelineConfig.dwellMs, 6000);
});

test('criterion 5: distances cover every passed-in stop, dwelling or not', () => {
  const candidates = new Map([
    candidate('stop-near', BASE, 50),
    candidate('stop-far', north(BASE, 200), 50),
  ]);
  const result = accept(initialPipelineState, fix({ at: NOW }), candidates);
  assert.ok(result.accepted);
  assert.equal(result.fix.distances.size, 2);
  const far = result.fix.distances.get('stop-far');
  assert.ok(far !== undefined && far > 50, 'the far stop is reported though it never dwells');
  assert.ok(result.fix.distances.get('stop-near') !== undefined);
});

test('criterion 5: simultaneous completions are ordered by distance, then stop_id', () => {
  // Distance order c (0 m) → b/t1/t2 (20 m tie, id order) → a (40 m);
  // alphabetical order would give a, b, c — the test fails if the tiebreak
  // ever sorts by id first.
  const candidates = new Map([
    candidate('stop-a', north(BASE, 40)),
    candidate('stop-b', north(BASE, 20)),
    candidate('stop-c', BASE),
    candidate('stop-t1', south(BASE, 20)),
    candidate('stop-t2', north(BASE, 20)),
  ]);
  const results = walk([fix({ at: NOW }), fix({ at: NOW + 6000 })], candidates);
  const second = results[1];
  assert.ok(second.accepted);
  assert.deepEqual(
    second.events.filter((e) => e.type === 'DwellCompleted'),
    [
      { type: 'DwellCompleted', stopId: 'stop-c', radius: 50 },
      { type: 'DwellCompleted', stopId: 'stop-b', radius: 50 },
      { type: 'DwellCompleted', stopId: 'stop-t1', radius: 50 },
      { type: 'DwellCompleted', stopId: 'stop-t2', radius: 50 },
      { type: 'DwellCompleted', stopId: 'stop-a', radius: 50 },
    ],
  );
});

test('criterion 5: property — shuffled candidate maps give the identical fix and events', () => {
  const rng = mulberry32(210);
  const entries = [
    candidate('stop-a', north(BASE, 40)),
    candidate('stop-b', north(BASE, 20)),
    candidate('stop-c', BASE),
    candidate('stop-t1', south(BASE, 20)),
    candidate('stop-t2', north(BASE, 20)),
  ];
  const baseline = walk([fix({ at: NOW }), fix({ at: NOW + 6000 })], new Map(entries));
  for (let i = 0; i < 10; i += 1) {
    const permuted = new Map(shuffled(entries, rng));
    const results = walk([fix({ at: NOW }), fix({ at: NOW + 6000 })], permuted);
    assert.deepEqual(results, baseline);
  }
});

test('criterion 6: NaN or Infinity coordinates are rejected as non-finite-coordinate', () => {
  for (const patch of [{ lat: Number.NaN }, { lng: Number.NaN }, { lat: Number.POSITIVE_INFINITY }, { lng: Number.NEGATIVE_INFINITY }]) {
    const result = accept(initialPipelineState, fix(patch));
    assert.deepEqual(result, { accepted: false, reason: 'non-finite-coordinate', state: initialPipelineState }, JSON.stringify(patch));
  }
});

test('criterion 6: latitude outside ±90 is rejected; the poles themselves are accepted', () => {
  for (const lat of [90.01, -90.01, 91, -91]) {
    const result = accept(initialPipelineState, fix({ lat }));
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'latitude-out-of-range', String(lat));
  }
  for (const lat of [90, -90]) {
    const result = accept(initialPipelineState, fix({ lat }));
    assert.ok(result.accepted, String(lat));
  }
});

test('criterion 6: negative or missing accuracy is rejected with its own reason', () => {
  const negative = accept(initialPipelineState, fix({ accuracy: -0.5 }));
  assert.deepEqual(negative, { accepted: false, reason: 'negative-accuracy', state: initialPipelineState });

  for (const accuracy of [undefined, Number.NaN, Number.POSITIVE_INFINITY] as Array<number | undefined>) {
    const result = accept(initialPipelineState, fix({ accuracy } as Partial<FixInput>));
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'missing-accuracy', String(accuracy));
  }
});

test('criterion 6: a timestamp after now is rejected; now itself is accepted', () => {
  const future = acceptFix(initialPipelineState, fix({ at: NOW + 1 }), new Map(), NOW, defaultPipelineConfig);
  assert.deepEqual(future, { accepted: false, reason: 'future-timestamp', state: initialPipelineState });

  const punctual = acceptFix(initialPipelineState, fix({ at: NOW }), new Map(), NOW, defaultPipelineConfig);
  assert.ok(punctual.accepted);
});

test('criterion 6: a non-finite timestamp is rejected as non-finite-timestamp', () => {
  for (const at of [Number.NaN, Number.POSITIVE_INFINITY, undefined] as Array<number | undefined>) {
    const result = accept(initialPipelineState, fix({ at } as Partial<FixInput>));
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'non-finite-timestamp', String(at));
  }
});
