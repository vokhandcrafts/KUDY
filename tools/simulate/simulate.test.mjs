// Simulator suites (G05.06.a). The AC numbering follows the issue's five
// acceptance criteria; every scenario replays a synthetic trace through the
// production stack (real LocationService/AudioService over deterministic
// ports, real RunOrchestrator → acceptFix → step) — the same composition the
// CLI runs. The proof of AC1 is identity: run.mjs's re-exports ARE the
// production functions; the Showboat demo additionally mutates the pipeline
// dwell requirement and watches the M1 expectation fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DeterministicClock } from './clock.mjs';
import { acceptFix as importedAcceptFix, step as importedStep, simulate } from './run.mjs';
import { acceptFix as productionAcceptFix } from '../../core/pipeline/pipeline.ts';
import { step as productionStep, defaultEngineConfig } from '../../core/engine/reducer.ts';
import { parseTrace } from './trace-schema.mjs';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));

// The synthetic M1 route (09 §13): five stops along a north-south street,
// 199.8 m apart (0.0018° latitude), 30 m trigger radius, one base story each.
const M1_STOPS = [0, 1, 2, 3, 4].map((k) => ({
  stopId: `stop-${String(k + 1)}`,
  lat: 54.4 + k * 0.0018,
  lng: 18.65,
  radius: 30,
  storyBaseId: `story-${String(k + 1)}`,
}));

// Walking fixes along the stop line at 1.4 m/s (below the pipeline's 12 km/h
// spike gate), one fix every 5 s. Positions only need to be self-consistent:
// distances come from the production haversine on these coordinates.
function walkFixes({ fromLat, toLat, startAtMs = 0, stepMs = 5000, speedMps = 1.4 }) {
  const events = [];
  const metersPerDeg = 111000;
  const stepM = speedMps * (stepMs / 1000);
  const count = Math.floor((Math.abs(toLat - fromLat) * metersPerDeg) / stepM);
  const direction = toLat >= fromLat ? 1 : -1;
  for (let i = 0; i <= count; i++) {
    events.push({
      type: 'GpsFix',
      at: startAtMs + i * stepMs,
      lat: fromLat + (direction * stepM * i) / metersPerDeg,
      lng: 18.65,
      accuracy: 5,
    });
  }
  return events;
}

// Injectors and commands must stand at their chronological position: a trace
// event may never sit behind an event with a later `at` (non-monotonic time
// is a diagnostic). Splices the event before the first same-or-later `at`, so
// an injector covers the fix reported at its own moment too.
function insertAt(events, event) {
  const index = events.findIndex((existing) => existing.at >= event.at);
  if (index === -1) events.push(event);
  else events.splice(index, 0, event);
  return events;
}

// The M1 acceptance trace: Start, a walk from 55 m south of stop-1 to ~44 m
// past stop-5, a stroll back over the whole route (nothing may fire twice),
// then an explicit End. Story audio lasts 20 s — less than the walk between
// stops, so the happy path never touches the one-cell queue.
function m1Trace({ withEnd = true } = {}) {
  const northEnd = 54.4 + 4 * 0.0018 + 0.0004;
  const events = [
    { type: 'UserCommand', at: 0, command: { action: 'Start' } },
    ...walkFixes({ fromLat: 54.4 - 0.0005, toLat: northEnd }),
  ];
  const lastAt = events[events.length - 1].at;
  events.push(...walkFixes({ fromLat: northEnd, toLat: 54.4 - 0.0005, startAtMs: lastAt + 5000 }));
  const tailAt = events[events.length - 1].at;
  events.push({ type: 'UserCommand', at: tailAt + 25000, command: { action: 'End' } });
  if (!withEnd) events.pop();
  return {
    route: { routeId: 'm1-five-stops', version: '1.0.0', locale: 'be', tier: ['base'] },
    stops: M1_STOPS,
    config: { dwellMs: 6000, audio: { defaultDurationMs: 20000 } },
    events,
  };
}

function baseDoc(stops, events, overrides = {}) {
  return {
    route: { routeId: 'sim-route', version: '1.0.0', locale: 'be', tier: ['base'] },
    stops,
    config: { dwellMs: 6000, audio: { defaultDurationMs: 20000 }, ...overrides },
    events,
  };
}

test('AC1: the simulator runs the production acceptFix and step — the re-exports are identity', () => {
  assert.equal(importedAcceptFix, productionAcceptFix, 'acceptFix must be the production pipeline function');
  assert.equal(importedStep, productionStep, 'step must be the production reducer function');
  // The engine config the replay uses is the canon one (09 invariants 5/8).
  assert.equal(defaultEngineConfig.fixFreshnessMs, 30000);
});

test('AC1: the arch rules behind the simulate exemption are present and pinned', () => {
  const config = fs.readFileSync(path.resolve(path.dirname(CLI), '..', '..', '.dependency-cruiser.cjs'), 'utf8');
  assert.match(config, /name: 'simulate-no-run-model'/, 'the frozen model is not importable');
  assert.match(config, /name: 'simulate-no-npm'/);
  assert.match(config, /name: 'simulate-no-other-zones'/);
  assert.match(config, /name: 'simulate-run-controllers-only'/);
  assert.match(config, /tools-zone-closed[\s\S]*pathNot: '\^tools\/simulate\/'/, 'the carve-out itself');
});

test('AC2: no wall clock and no randomness anywhere in tools/simulate', () => {
  const dir = path.dirname(CLI);
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.mjs'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(source, /Date\.now|Math\.random|new Date\(/, `${file} must stay deterministic`);
  }
});

test('AC2: the same trace run twice gives byte-identical reports', () => {
  const doc = m1Trace();
  const first = simulate(doc, { name: 'm1.json' });
  const second = simulate(doc, { name: 'm1.json' });
  assert.equal(first.report, second.report);
  assert.equal(first.exit, 0);
});

test('AC2: the deferred queue orders by due time, then insertion order', () => {
  const clock = new DeterministicClock(0);
  const fired = [];
  clock.schedule(100, () => fired.push('late-a'), 'late-a');
  clock.schedule(50, () => fired.push('early'), 'early');
  clock.schedule(100, () => fired.push('late-b'), 'late-b');
  clock.drainUntil(1000);
  assert.deepEqual(fired, ['early', 'late-a', 'late-b'], 'due time first, insertion order as the tie-break');
  assert.deepEqual(clock.pending(), []);

  const cancellations = new DeterministicClock(0);
  const cancel = cancellations.schedule(10, () => {}, 'cancelled');
  cancel();
  cancellations.drainUntil(100);
  assert.deepEqual(cancellations.pending(), [], 'a cancelled entry neither runs nor reports');
});

test('AC3: a corrupt trace yields named diagnostics, not a crash', () => {
  const parsed = parseTrace({
    route: { routeId: 'r', version: '1', locale: 'be', tier: ['base'] },
    stops: M1_STOPS.slice(0, 1),
    events: [
      { type: 'GpsFix', at: 0, lat: 54.4, lng: 18.65, accuracy: 5 },
      { type: 'quake', at: 1000 },
      { type: 'GpsFix', at: 2000, lat: 54.4, lng: 18.65 },
      { type: 'GpsFix', at: 1500, lat: 54.4, lng: 18.65, accuracy: 5 },
      { type: 'UserCommand', at: 3000, command: { action: 'Teleport' } },
      { type: 'UserCommand', at: 4000, command: null },
      { type: 'UserCommand', at: 5000, command: 42 },
    ],
  });
  assert.equal(parsed.ok, false);
  const codes = parsed.diagnostics.map((d) => d.code);
  assert.ok(codes.includes('unknown-event'), 'unknown event type');
  assert.ok(codes.includes('missing-field'), 'missing accuracy');
  assert.ok(codes.includes('non-monotonic-time'), 'time goes backwards');
  assert.ok(codes.includes('unknown-action'), 'unknown user command');
  assert.equal(parsed.diagnostics.filter((d) => d.code === 'bad-value').length, 2, 'null and non-object command payloads');
  assert.equal(parsed.diagnostics.filter((d) => d.code === 'non-monotonic-time').length, 1);
});

test('AC3: the CLI reports a corrupt trace with exit 2 and names the diagnostics', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-corrupt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'trace.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      route: { routeId: 'r', version: '1', locale: 'be', tier: ['base'] },
      stops: M1_STOPS.slice(0, 1),
      events: [{ type: 'GpsFix', at: 0, lat: 54.4, lng: 18.65, accuracy: 5 }, { type: 'quake', at: 1000 }],
    }),
    'utf8',
  );
  const run = spawnSync(process.execPath, [CLI, '--trace', file], { encoding: 'utf8' });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /unknown-event/);
  assert.match(run.stderr, /simulate: the trace is corrupt/);
  assert.doesNotMatch(run.stderr, /thrown|at file:/, 'a diagnostic, not a stack trace');
});

test('AC3: accuracy degradation over the whole stay keeps the stop silent', () => {
  const events = [
    { type: 'UserCommand', at: 0, command: { action: 'Start' } },
    ...walkFixes({ fromLat: 54.4 - 0.0005, toLat: 54.4 + 0.0018 + 0.0004 }),
  ];
  // The street-canyon window covers every fix from before stop-1's radius
  // until well past it: the accuracy gate (40 m canon) rejects them all, so
  // no dwell ever accumulates for stop-1; stop-2, entered after the window,
  // fires normally.
  insertAt(events, { type: 'AccuracyDegradation', at: 15000, untilAt: 130000, accuracy: 55 });
  const clean = simulate(baseDoc(M1_STOPS.slice(0, 2), events.filter((e) => e.type !== 'AccuracyDegradation')), {
    name: 'clean.json',
  });
  const degraded = simulate(baseDoc(M1_STOPS.slice(0, 2), events), { name: 'degraded.json' });
  const cleanReport = JSON.parse(clean.report);
  const degradedReport = JSON.parse(degraded.report);
  assert.deepEqual(cleanReport.firedStops.map((s) => s.stopId), ['stop-1', 'stop-2'], 'without the injector both fire');
  assert.deepEqual(degradedReport.firedStops.map((s) => s.stopId), ['stop-2'], 'the degraded window keeps stop-1 silent');
});

test('AC3: a timestamp jump forward rejects every later fix as future-dated', () => {
  const events = [
    { type: 'UserCommand', at: 0, command: { action: 'Start' } },
    ...walkFixes({ fromLat: 54.4 - 0.0005, toLat: 54.4 + 0.0018 + 0.0004 }),
  ];
  insertAt(events, { type: 'TimestampJump', at: 15000, deltaMs: 3600000 });
  const run = simulate(baseDoc(M1_STOPS.slice(0, 2), events), { name: 'jump.json' });
  const report = JSON.parse(run.report);
  assert.ok(report.counters.fixesDelivered > 0, 'the fixes before the jump were delivered');
  assert.equal(report.firedStops.length, 0, 'no trigger after the jump: shifted fixes are future-dated');
  assert.equal(report.session.finalPhase, 'Active', 'the session lives on — the pipeline just rejects the fixes');
});

test('AC3: a signal gap suspends delivery, the watchdog recovers, the walk continues', () => {
  const events = [
    { type: 'UserCommand', at: 0, command: { action: 'Start' } },
    ...walkFixes({ fromLat: 54.4 - 0.0005, toLat: 54.4 + 0.0018 + 0.0004 }),
  ];
  // A 20 s outage straddling stop-2's dwell: the gap watch fires (15 s
  // threshold), the bounded resubscribe backoff runs on the shared queue, and
  // the fixes after the gap return the stream to live. Stop-2 fires late —
  // its dwell restarted — and stop-1 is untouched.
  insertAt(events, { type: 'SignalGap', at: 170000, untilAt: 190000 });
  const clean = simulate(baseDoc(M1_STOPS.slice(0, 2), events.filter((e) => e.type !== 'SignalGap')), {
    name: 'clean.json',
  });
  const gapped = simulate(baseDoc(M1_STOPS.slice(0, 2), events), { name: 'gap.json' });
  const cleanReport = JSON.parse(clean.report);
  const gapReport = JSON.parse(gapped.report);
  assert.equal(cleanReport.counters.fixesDroppedBySignalGap, 0);
  assert.ok(gapReport.counters.fixesDroppedBySignalGap >= 4, 'the outage swallowed the fixes inside the window');
  const cleanStop2 = cleanReport.firedStops.find((s) => s.stopId === 'stop-2');
  const gappedStop2 = gapReport.firedStops.find((s) => s.stopId === 'stop-2');
  assert.ok(gappedStop2, 'stop-2 still fires after the recovery');
  assert.ok(gappedStop2.at > cleanStop2.at, '…later: the dwell restarted after the gap');
  assert.equal(gapReport.session.finalPhase, 'Active');
});

test('AC3: an incoming call is a live pause; a resume within the window continues the launch', () => {
  const events = [
    { type: 'UserCommand', at: 0, command: { action: 'Start' } },
    ...walkFixes({ fromLat: 54.4 - 0.0005, toLat: 54.4 + 0.0025 }),
  ];
  // stop-1 fires at ~35 s; the call arrives 45 s into the 60 s story: a live
  // pause (same token survives), the call ends within the 10-minute focus
  // window, and the explicit ResumeAudio continues the SAME launch — its
  // finish credits heard exactly once.
  insertAt(events, { type: 'IncomingCall', at: 80000 });
  insertAt(events, { type: 'CallEnded', at: 110000 });
  insertAt(events, { type: 'UserCommand', at: 112000, command: { action: 'ResumeAudio' } });
  const run = simulate(baseDoc(M1_STOPS.slice(0, 1), events, { audio: { defaultDurationMs: 60000 } }), {
    name: 'call.json',
  });
  const report = JSON.parse(run.report);
  assert.equal(run.exit, 0, 'the resumed story finishes inside the trace');
  assert.deepEqual(report.session.heard, ['story-1'], 'the same launch continued and was credited once');
  assert.equal(report.stuckPlaying, null);
});

test('AC4: the report lists the trigger latency, timers never fired and stuck_playing', () => {
  // The trace ends while story-1 still sounds: stuck_playing with exit 1, and
  // its audio completion is a queued action that never fired.
  const events = [
    { type: 'UserCommand', at: 0, command: { action: 'Start' } },
    ...walkFixes({ fromLat: 54.4 - 0.0005, toLat: 54.4 + 0.001 }),
  ];
  const run = simulate(baseDoc(M1_STOPS.slice(0, 1), events, { audio: { defaultDurationMs: 600000 } }), {
    name: 'stuck.json',
  });
  const report = JSON.parse(run.report);
  assert.equal(run.exit, 1, 'stuck_playing is the one error exit of a completed replay');
  assert.equal(report.stuckPlaying.owner, 'guide');
  assert.equal(report.stuckPlaying.storyId, 'story-1');
  const audioTimer = report.timersNeverFired.find((timer) => timer.id.startsWith('audio.finished'));
  assert.ok(audioTimer, 'the audio completion never fired');
  assert.ok(audioTimer.dueMs > report.trace.lastAtMs);
  assert.ok(report.timersNeverFired.some((timer) => timer.id !== audioTimer.id), 'the watchdog gap watch is pending too');

  const [stop1] = report.firedStops;
  assert.equal(stop1.origin, 'auto');
  assert.ok(stop1.latencyMs >= 6000, 'the latency covers at least the dwell window');
  assert.ok(stop1.latencyMs <= 6000 + 2 * 5000, 'and not much more: two fixes of dwell plus the entry fix');
});

test('AC3: the CLI refuses malformed arguments and a non-JSON trace with exit 2, never a crash', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // `--out` without a value: a usage diagnostic, not a TypeError.
  const noValue = spawnSync(process.execPath, [CLI, '--trace', 'x.json', '--out'], { encoding: 'utf8' });
  assert.equal(noValue.status, 2, noValue.stderr);
  assert.match(noValue.stderr, /usage:/);
  assert.doesNotMatch(noValue.stderr, /TypeError|thrown|at file:/);
  // A trace file that is not JSON at all: the read/parse failure is a named
  // diagnostic through the production CLI path.
  const file = path.join(dir, 'broken.json');
  fs.writeFileSync(file, '{"route": {', 'utf8');
  const bad = spawnSync(process.execPath, [CLI, '--trace', file], { encoding: 'utf8' });
  assert.equal(bad.status, 2, bad.stderr);
  assert.match(bad.stderr, /cannot read the trace file/);
  assert.doesNotMatch(bad.stderr, /SyntaxError: Unexpected token.*\n\s+at /, 'no raw stack trace');
});

test('AC4: the CLI surfaces the library outcomes — exit 1 on stuck_playing, 0 on a partial walk', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const walk = walkFixes({ fromLat: 54.4 - 0.0005, toLat: 54.4 + 0.001 });
  const stuckDoc = baseDoc(M1_STOPS.slice(0, 1), [
    { type: 'UserCommand', at: 0, command: { action: 'Start' } },
    ...walk,
  ], { audio: { defaultDurationMs: 600000 } });
  const stuckFile = path.join(dir, 'stuck.json');
  fs.writeFileSync(stuckFile, JSON.stringify(stuckDoc), 'utf8');
  const stuck = spawnSync(process.execPath, [CLI, '--trace', stuckFile], { encoding: 'utf8' });
  assert.equal(stuck.status, 1, 'a segment still playing at the end is the error exit');
  assert.match(stuck.stdout, /"stuckPlaying": \{/);

  const full = m1Trace();
  const partialFile = path.join(dir, 'partial.json');
  fs.writeFileSync(partialFile, JSON.stringify({ ...full, events: full.events.slice(0, 60) }), 'utf8');
  const partial = spawnSync(process.execPath, [CLI, '--trace', partialFile], { encoding: 'utf8' });
  assert.equal(partial.status, 0, 'a partial walk is not a failure');
  assert.match(partial.stdout, /"finalPhase": "Active"/);
});

test('AC5: the M1 five-stop walk passes — all fire, none twice, nothing hangs, Ended only after End', () => {
  const run = simulate(m1Trace(), { name: 'm1.json' });
  const report = JSON.parse(run.report);
  assert.equal(run.exit, 0, run.report);
  assert.deepEqual(
    report.firedStops.map((stop) => stop.stopId),
    ['stop-1', 'stop-2', 'stop-3', 'stop-4', 'stop-5'],
    'every stop fired, in route order',
  );
  assert.equal(new Set(report.firedStops.map((stop) => stop.stopId)).size, 5, 'the walk back fired nothing twice');
  assert.deepEqual(report.session.autoFired, ['stop-1', 'stop-2', 'stop-3', 'stop-4', 'stop-5']);
  assert.deepEqual(report.session.heard, ['story-1', 'story-2', 'story-3', 'story-4', 'story-5']);
  assert.equal(report.stuckPlaying, null, 'nothing hangs');
  assert.equal(report.session.finalPhase, 'Ended', 'Ended appears after the explicit End');
  assert.ok(report.session.endedAtMs !== null);
  for (const stop of report.firedStops) {
    assert.equal(stop.origin, 'auto');
    assert.ok(stop.latencyMs >= 6000, `${stop.stopId}: latency covers the dwell window`);
  }
});

test('AC5: a partial walk is not a failure and never reaches Ended without End', () => {
  const full = m1Trace();
  const partial = { ...full, events: full.events.slice(0, 60) };
  const run = simulate(partial, { name: 'partial.json' });
  const report = JSON.parse(run.report);
  assert.equal(run.exit, 0, 'a partial walk exits 0');
  assert.ok(report.firedStops.length > 0 && report.firedStops.length < 5, 'some stops fired, the rest did not');
  assert.notEqual(report.session.finalPhase, 'Ended', 'no explicit End, no Ended');
  assert.equal(report.session.endedAtMs, null);
});

test('AC5: a manual play is reported as a manual play, not as an auto fire', () => {
  const events = [
    { type: 'UserCommand', at: 0, command: { action: 'Start' } },
    ...walkFixes({ fromLat: 54.4 - 0.0005, toLat: 54.4 + 0.0014 }),
  ];
  insertAt(events, { type: 'UserCommand', at: 10000, command: { action: 'PlayStop', stopId: 'stop-2' } });
  const run = simulate(baseDoc(M1_STOPS.slice(0, 2), events), { name: 'manual.json' });
  const report = JSON.parse(run.report);
  assert.equal(run.exit, 0, run.report);
  assert.equal(report.manualPlays.length, 1);
  assert.equal(report.manualPlays[0].stopId, 'stop-2');
  assert.deepEqual(
    report.firedStops.map((stop) => stop.stopId),
    ['stop-1'],
    'the manual tap is not an auto fire',
  );
  assert.ok(report.commandStream.some((entry) => entry.action === 'PlayStop' && entry.outcome === 'applied'));
  // The tapped story was heard by hand — the autotrigger for it stays silent
  // (11 C12: a story listened to by hand never auto-replays).
  assert.ok(!report.firedStops.some((stop) => stop.storyId === 'story-2'));
});
