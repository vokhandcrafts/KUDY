// G05.06.b — the seeded trace builders (09 §11 «Генератары: чысты праход,
// стаянне на кожнай кропцы, хуткі праход, старт з сярэдзіны» plus the
// scenario fixtures of the 16 G05.06 row). Every builder is a pure function
// of named seed constants: the same seed reproduces the trace file byte for
// byte (traces.test.mjs pins the committed artifacts), so the set needs no
// hand-maintained JSON.
//
// Determinism guard: the determinism test greps this directory for wall-clock
// and randomness API calls and fails on a hit — the only randomness source
// here is the mulberry32 PRNG below, fully determined by its seed.
//
// Geometry: the synthetic M1 street of 09 §13 — five stops along one
// north-south line, ~199.8 m apart, 30 m trigger radius. Jitter (±2 m
// lateral, ±250 ms timing) keeps the walk realistic without ever moving a
// decision near the radius edge by more than the pinned outcome tolerates.

const LNG = 18.65;
const STOP_LAT_BASE = 54.4;
const STEP_DEG = 0.0018; // ~199.8 m between neighbouring stop centers
const RADIUS_M = 30;
const METERS_PER_DEG = 111000;

// The four generator walks and the five scenario fixtures, one entry per
// committed trace file. The seeds are part of the reproducibility contract:
// changing one changes the committed trace, and traces.test.mjs fails until
// the file is regenerated consciously.
export const TRACE_FILES = {
  'clean-walk.json': { generator: 'cleanWalk', seed: 202609261 },
  'standing-every-stop.json': { generator: 'standingEveryStop', seed: 202609262 },
  'fast-walk.json': { generator: 'fastWalk', seed: 202609263 },
  'mid-route-start.json': { generator: 'midRouteStart', seed: 202609264 },
  'reverse-order.json': { generator: 'reverseOrder', seed: 202609265 },
  'replay-heard-stop.json': { generator: 'replayHeardStop', seed: 202609266 },
  'gps-gap.json': { generator: 'gpsGap', seed: 202609267 },
  'focus-loss.json': { generator: 'focusLoss', seed: 202609268 },
  'locked-unlock.json': { generator: 'lockedUnlock', seed: 202609269 },
};

// The scenario fixtures of the 16 G05.06 row / acceptance criterion 2, as
// trace-file names. traces.test.mjs pins this list so a renamed scenario
// fails the suite instead of silently shrinking the coverage.
export const SCENARIO_TRACES = [
  'replay-heard-stop.json',
  'mid-route-start.json',
  'reverse-order.json',
  'gps-gap.json',
  'focus-loss.json',
  'locked-unlock.json',
];

/** mulberry32: 32-bit state, ~2^30 period — ample for a few hundred draws. */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const stopLat = (k) => STOP_LAT_BASE + k * STEP_DEG;
const metersToDeg = (m) => m / METERS_PER_DEG;

function streetStops() {
  return [0, 1, 2, 3, 4].map((k) => ({
    stopId: `stop-${String(k + 1)}`,
    lat: stopLat(k),
    lng: LNG,
    radius: RADIUS_M,
    storyBaseId: `story-${String(k + 1)}`,
  }));
}

// The paid-extension variant for the locked-unlock scenario: stop-3 sells
// only its extended story, so with the verified tiers ['base'] the stop stays
// locked until an AccessReady widens the tier (ADR G01.03 §3.5).
function streetWithExtensionStop() {
  return streetStops().map((stop) =>
    stop.stopId === 'stop-3'
      ? { stopId: 'stop-3', lat: stop.lat, lng: LNG, radius: RADIUS_M, storyExtendedId: 'story-3-ext' }
      : stop,
  );
}

/**
 * Walking fixes along the street with seeded jitter. Positions stay within
 * ±jitterM of the center line, fix spacing is stepMs ± jitterMs; the first
 * fix carries no timing jitter so chained segments stay monotonic.
 */
function walkSegment({ fromLat, toLat, startAtMs, prng, speedMps = 1.4, stepMs = 5000, jitterM = 2, jitterMs = 250 }) {
  const events = [];
  const stepM = speedMps * (stepMs / 1000);
  const distanceM = Math.abs(toLat - fromLat) * METERS_PER_DEG;
  const count = Math.max(1, Math.round(distanceM / stepM));
  const direction = toLat >= fromLat ? 1 : -1;
  let at = startAtMs;
  for (let i = 0; i <= count; i++) {
    const alongJitter = i === 0 ? 0 : (prng() * 2 - 1) * jitterM;
    const lateral = (prng() * 2 - 1) * jitterM;
    const atJitter = i === 0 ? 0 : Math.round((prng() * 2 - 1) * jitterMs);
    events.push({
      type: 'GpsFix',
      at: at + atJitter,
      lat: fromLat + direction * metersToDeg(stepM * i + alongJitter),
      lng: LNG + metersToDeg(lateral),
      accuracy: 5,
    });
    at += stepMs;
  }
  const last = events[events.length - 1];
  return { events, lastAtMs: last.at };
}

/** Fixes standing at one latitude: the dwell-and-listen profile. */
function standSegment({ lat, startAtMs, durationMs, prng, stepMs = 4000, jitterM = 1.5 }) {
  const events = [];
  let at = startAtMs;
  while (at <= startAtMs + durationMs) {
    events.push({
      type: 'GpsFix',
      at,
      lat: lat + metersToDeg((prng() * 2 - 1) * jitterM),
      lng: LNG + metersToDeg((prng() * 2 - 1) * jitterM),
      accuracy: 5,
    });
    at += stepMs;
  }
  const last = events[events.length - 1];
  return { events, lastAtMs: last.at };
}

function traceDoc({ stops, events, audio = { defaultDurationMs: 20000 } }) {
  return {
    route: { routeId: 'sim-street-five', version: '1.0.0', locale: 'be', tier: ['base'] },
    stops,
    config: { dwellMs: 6000, audio },
    events,
  };
}

function startCommand(events) {
  events.push({ type: 'UserCommand', at: 0, command: { action: 'Start' } });
  return 5000; // the first fix lands 5 s after Start
}

function endCommand(events, afterAtMs) {
  events.push({ type: 'UserCommand', at: afterAtMs, command: { action: 'End' } });
}

const southApproach = () => stopLat(0) - metersToDeg(55);

/** The whole street south → north with an explicit End: every stop fires. */
export function cleanWalkTrace() {
  const prng = mulberry32(TRACE_FILES['clean-walk.json'].seed);
  const events = [];
  const startAt = startCommand(events);
  const walk = walkSegment({ fromLat: southApproach(), toLat: stopLat(4) + metersToDeg(44), startAtMs: startAt, prng });
  events.push(...walk.events);
  endCommand(events, walk.lastAtMs + 25000);
  return traceDoc({ stops: streetStops(), events });
}

/** Stop at every center and outlast its story: the dwell-and-listen walk. */
export function standingEveryStopTrace() {
  const prng = mulberry32(TRACE_FILES['standing-every-stop.json'].seed);
  const events = [];
  let at = startCommand(events);
  let lat = southApproach();
  for (let k = 0; k < 5; k++) {
    const walk = walkSegment({ fromLat: lat, toLat: stopLat(k), startAtMs: at, prng });
    events.push(...walk.events);
    // The story lasts 20 s; standing 30 s outlasts both the launch latency
    // and the audio, so the next departure never overlaps the player.
    const stand = standSegment({ lat: stopLat(k), startAtMs: walk.lastAtMs + 5000, durationMs: 30000, prng });
    events.push(...stand.events);
    at = stand.lastAtMs + 5000;
    lat = stopLat(k);
  }
  return traceDoc({ stops: streetStops(), events });
}

/** ~7.9 km/h with a fix every ~25 s: dwell decisions and queueing under speed. */
export function fastWalkTrace() {
  const prng = mulberry32(TRACE_FILES['fast-walk.json'].seed);
  const events = [];
  const startAt = startCommand(events);
  const walk = walkSegment({
    fromLat: southApproach(),
    toLat: stopLat(4) + metersToDeg(44),
    startAtMs: startAt,
    prng,
    speedMps: 2.2,
    stepMs: 25000,
    jitterMs: 1000,
  });
  events.push(...walk.events);
  endCommand(events, walk.lastAtMs + 30000);
  return traceDoc({ stops: streetStops(), events });
}

/** Start already south of stop-3: a partial walk whose own expectation lists 3 of 5. */
export function midRouteStartTrace() {
  const prng = mulberry32(TRACE_FILES['mid-route-start.json'].seed);
  const events = [];
  const startAt = startCommand(events);
  const walk = walkSegment({ fromLat: stopLat(2) - metersToDeg(55), toLat: stopLat(4) + metersToDeg(44), startAtMs: startAt, prng });
  events.push(...walk.events);
  // No End: the criterion pins that a trace without one finishes Active.
  return traceDoc({ stops: streetStops(), events });
}

/** The same street walked north → south: C31 — the order is the walker's. */
export function reverseOrderTrace() {
  const prng = mulberry32(TRACE_FILES['reverse-order.json'].seed);
  const events = [];
  const startAt = startCommand(events);
  const walk = walkSegment({ fromLat: stopLat(4) + metersToDeg(55), toLat: stopLat(0) - metersToDeg(44), startAtMs: startAt, prng });
  events.push(...walk.events);
  endCommand(events, walk.lastAtMs + 25000);
  return traceDoc({ stops: streetStops(), events });
}

/** Into stop-1, out, back in: a heard stop never auto-replays (11 C12). */
export function replayHeardStopTrace() {
  const prng = mulberry32(TRACE_FILES['replay-heard-stop.json'].seed);
  const events = [];
  const startAt = startCommand(events);
  // North into stop-1's radius and up to 44 m short of stop-2's.
  const out = walkSegment({ fromLat: southApproach(), toLat: stopLat(1) - metersToDeg(44), startAtMs: startAt, prng });
  events.push(...out.events);
  // Back south, re-entering stop-1's radius and leaving it behind.
  const back = walkSegment({ fromLat: stopLat(1) - metersToDeg(44), toLat: stopLat(0) - metersToDeg(80), startAtMs: out.lastAtMs + 5000, prng });
  events.push(...back.events);
  endCommand(events, back.lastAtMs + 25000);
  return traceDoc({ stops: streetStops(), events });
}

/** A 20 s outage straddling stop-2's entry: the dwell restarts after recovery. */
export function gpsGapTrace() {
  const prng = mulberry32(TRACE_FILES['gps-gap.json'].seed);
  const events = [];
  const startAt = startCommand(events);
  const walk = walkSegment({ fromLat: southApproach(), toLat: stopLat(1) + metersToDeg(44), startAtMs: startAt, prng });
  events.push(...walk.events);
  // On this street and speed stop-2's radius entry lands ~170 s in; the gap
  // covers the fixes that would have completed its first dwell.
  events.push({ type: 'SignalGap', at: 170000, untilAt: 190000 });
  events.sort((a, b) => a.at - b.at);
  endCommand(events, walk.lastAtMs + 25000);
  return traceDoc({ stops: streetStops(), events });
}

/** A call 45 s into stop-1's 60 s story: FocusLoss is a pause, never a finish. */
export function focusLossTrace() {
  const prng = mulberry32(TRACE_FILES['focus-loss.json'].seed);
  const events = [];
  const startAt = startCommand(events);
  const walk = walkSegment({ fromLat: southApproach(), toLat: stopLat(1) + metersToDeg(44), startAtMs: startAt, prng });
  events.push(...walk.events);
  // stop-1 fires ~35 s in; the call arrives 45 s into the 60 s story, the
  // call ends inside the 10-minute focus window, and the explicit ResumeAudio
  // continues the SAME launch (11 §FocusLoss — nothing resumes by itself).
  events.push({ type: 'IncomingCall', at: 80000 });
  events.push({ type: 'CallEnded', at: 110000 });
  events.push({ type: 'UserCommand', at: 112000, command: { action: 'ResumeAudio' } });
  events.sort((a, b) => a.at - b.at);
  endCommand(events, walk.lastAtMs + 30000);
  return traceDoc({ stops: streetStops(), events, audio: { defaultDurationMs: 60000 } });
}

/** Through the locked stop, unlock, back in: only the unlock opens the story. */
export function lockedUnlockTrace() {
  const prng = mulberry32(TRACE_FILES['locked-unlock.json'].seed);
  const events = [];
  const startAt = startCommand(events);
  // North past stop-3: stop-1 and stop-2 fire on the way, locked stop-3 stays
  // silent, and the walk leaves its radius by ~80 m.
  const out = walkSegment({ fromLat: southApproach(), toLat: stopLat(2) + metersToDeg(80), startAtMs: startAt, prng });
  events.push(...out.events);
  // The entitlement unlock arrives mid-walk; it plays nothing by itself.
  events.push({ type: 'AccessReady', at: out.lastAtMs + 5000, tier: 'extended', stopIds: ['stop-3'] });
  // Back south into stop-3: the dwell now completes on the extended story.
  const back = walkSegment({ fromLat: stopLat(2) + metersToDeg(80), toLat: stopLat(2) - metersToDeg(55), startAtMs: out.lastAtMs + 10000, prng });
  events.push(...back.events);
  endCommand(events, back.lastAtMs + 25000);
  return traceDoc({ stops: streetWithExtensionStop(), events });
}

/** The builders by generator name — the capture step and the tests share it. */
const BUILDERS = {
  cleanWalk: cleanWalkTrace,
  standingEveryStop: standingEveryStopTrace,
  fastWalk: fastWalkTrace,
  midRouteStart: midRouteStartTrace,
  reverseOrder: reverseOrderTrace,
  replayHeardStop: replayHeardStopTrace,
  gpsGap: gpsGapTrace,
  focusLoss: focusLossTrace,
  lockedUnlock: lockedUnlockTrace,
};

export function buildTrace(fileName) {
  const entry = TRACE_FILES[fileName];
  if (entry === undefined) throw new RangeError(`unknown trace file '${String(fileName)}'`);
  return BUILDERS[entry.generator]();
}

/** The byte form of a committed trace artifact. */
export function serializeTrace(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
