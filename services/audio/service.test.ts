// G05.03.a — behavioral tests for the audio service over the fake port. Each
// acceptance criterion of docs/agent-tasks/run/G05.03.a.md has a suite here;
// reverting the stop-before-play command, the source-key attribution, the
// alive-flag dispose guard or the snapshot validation makes them fail
// (implementation-rules 1). The tests import nothing from core/engine — the
// whole services/audio module stays outside the engine zone (criterion 6,
// tripwired in the boundary suite below).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FakeAudioPlayerPort } from './fake-port.ts';
import { AudioService } from './service.ts';
import type { AudioServiceEvent, PlayToken } from './types.ts';

// Synthetic fixtures (09 §6.1 / ADR G01.02 §3.2 shapes; criterion 6 keeps the
// engine's own types out of this module).
const guideToken = (seq: number): PlayToken => ({ kind: 'guide', ref: 'session-1', seq });
const momentToken = (seq: number): PlayToken => ({ kind: 'moment', ref: 'moment-9', seq });

function makeService() {
  const ports: FakeAudioPlayerPort[] = [];
  const events: AudioServiceEvent[] = [];
  const service = new AudioService({
    createPort: () => {
      const port = new FakeAudioPlayerPort();
      ports.push(port);
      return port;
    },
  });
  service.onEvent((event) => events.push(event));
  const lastPort = () => ports[ports.length - 1];
  return { service, ports, events, lastPort };
}

test('criterion 1: a second play stops the first by command before starting', async () => {
  const { service, ports, lastPort } = makeService();
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  await service.play({ token: momentToken(1), path: 'b.mp3' });
  assert.deepEqual(lastPort().commands, ['play 1:a.mp3', 'stop', 'play 2:b.mp3']);
  for (const port of ports) assert.deepEqual(port.violations, []);
});

test('criterion 1: rapid play and stop commands end in the state of the last command', async () => {
  const { service, lastPort } = makeService();
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  await service.play({ token: guideToken(2), path: 'b.mp3' });
  service.stop();
  await service.play({ token: momentToken(3), path: 'c.mp3' });
  assert.deepEqual(lastPort().commands, [
    'play 1:a.mp3',
    'stop',
    'play 2:b.mp3',
    'stop',
    'play 3:c.mp3',
  ]);
  assert.deepEqual(lastPort().violations, []);
  lastPort().snapshotValue = { state: 'playing', positionMs: 5, durationMs: 100 };
  assert.deepEqual(service.playbackState(), {
    kind: 'playing',
    token: momentToken(3),
    positionMs: 5,
    durationMs: 100,
  });
  service.stop();
  lastPort().snapshotValue = { state: 'idle', positionMs: 0, durationMs: 0 };
  assert.deepEqual(service.playbackState(), { kind: 'idle' });
});

test('criterion 1: after rapid commands only the last source can still finish', async () => {
  const { service, events, lastPort } = makeService();
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  await service.play({ token: guideToken(2), path: 'b.mp3' });
  service.stop();
  await service.play({ token: momentToken(3), path: 'c.mp3' });
  lastPort().finish(1);
  lastPort().finish(2);
  assert.deepEqual(events, []);
  lastPort().finish(3);
  assert.deepEqual(events, [{ type: 'finished', token: momentToken(3) }]);
});

test('criterion 2: every callback carries the exact token of its play command', async () => {
  const { service, events, lastPort } = makeService();
  await service.play({ token: guideToken(7), path: 'a.mp3' });
  lastPort().finish(1);
  await service.play({ token: momentToken(8), path: 'b.mp3' });
  lastPort().fail(2, 'decoder stopped');
  await service.play({ token: guideToken(9), path: 'c.mp3' });
  lastPort().reportPaused(3);
  assert.equal(service.resume(guideToken(9)), true);
  lastPort().reportResumed(3);
  assert.deepEqual(events, [
    { type: 'finished', token: guideToken(7) },
    { type: 'story_play_failed', token: momentToken(8), reason: 'decoder stopped' },
    { type: 'paused', token: guideToken(9) },
    { type: 'resumed', token: guideToken(9) },
  ]);
});

test('criterion 2 proof: a late finish of play A after play B started is ignored, not credited to B', async () => {
  const { service, events, lastPort } = makeService();
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  await service.play({ token: momentToken(2), path: 'b.mp3' });
  // The physical race: the port reports A's natural end after B already plays.
  lastPort().finish(1);
  assert.deepEqual(events, []);
  lastPort().finish(2);
  assert.deepEqual(events, [{ type: 'finished', token: momentToken(2) }]);
});

test('criterion 2: a stale failed event of a stopped launch is ignored', async () => {
  const { service, events, lastPort } = makeService();
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  service.stop();
  lastPort().fail(1, 'too late');
  lastPort().finish(1);
  assert.deepEqual(events, []);
});

test('criterion 2: resume with a stale or foreign token is a command refusal', async () => {
  const { service, lastPort } = makeService();
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  lastPort().reportPaused(1);
  assert.equal(service.resume(momentToken(1)), false);
  assert.equal(service.resume(guideToken(2)), false);
  assert.equal(lastPort().commands.includes('resume'), false);
  assert.equal(service.resume(guideToken(1)), true);
  assert.equal(lastPort().commands.includes('resume'), true);
});

test('criterion 2 + 5: after dispose and re-creation the old instance is not forwarded', async () => {
  const { service, events, ports, lastPort } = makeService();
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  const oldPort = ports[0];
  service.dispose();
  // The disposed instance reports a late finish before anything re-creates.
  oldPort.finish(1);
  assert.deepEqual(events, []);
  await service.play({ token: momentToken(2), path: 'b.mp3' });
  oldPort.finish(1);
  oldPort.focusLoss();
  assert.deepEqual(events, []);
  lastPort().finish(2);
  assert.deepEqual(events, [{ type: 'finished', token: momentToken(2) }]);
});

test('criterion 3: a call during a guide play is FocusLoss/FocusRegain, never finished', async () => {
  const { service, events, lastPort } = makeService();
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  lastPort().focusLoss();
  lastPort().focusRegain();
  lastPort().finish(1);
  assert.deepEqual(events, [
    { type: 'FocusLoss' },
    { type: 'FocusRegain' },
    { type: 'finished', token: guideToken(1) },
  ]);
});

test('criterion 3: a call during a moment play is FocusLoss/FocusRegain, never finished', async () => {
  const { service, events, lastPort } = makeService();
  await service.play({ token: momentToken(1), path: 'teaser.mp3' });
  lastPort().focusLoss();
  lastPort().focusRegain();
  lastPort().finish(1);
  assert.deepEqual(events, [
    { type: 'FocusLoss' },
    { type: 'FocusRegain' },
    { type: 'finished', token: momentToken(1) },
  ]);
});

test('criterion 4: playback state is computed from the port on every read', async () => {
  const { service, lastPort } = makeService();
  assert.deepEqual(service.playbackState(), { kind: 'idle' });
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  lastPort().snapshotValue = { state: 'playing', positionMs: 1000, durationMs: 60000 };
  assert.deepEqual(service.playbackState(), {
    kind: 'playing',
    token: guideToken(1),
    positionMs: 1000,
    durationMs: 60000,
  });
  // No service call in between: only the port's physical fact changed.
  lastPort().snapshotValue = { state: 'paused', positionMs: 2000, durationMs: 60000 };
  assert.deepEqual(service.playbackState(), {
    kind: 'paused',
    token: guideToken(1),
    positionMs: 2000,
    durationMs: 60000,
  });
});

test('criterion 4: position and duration are milliseconds, never a ratio', async () => {
  const { service, lastPort } = makeService();
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  lastPort().snapshotValue = { state: 'playing', positionMs: 61000, durationMs: 125000 };
  const state = service.playbackState();
  assert.equal(state.kind, 'playing');
  if (state.kind !== 'playing') return;
  assert.equal(state.positionMs, 61000);
  assert.equal(state.durationMs, 125000);
});

test('criterion 4: NaN, infinite and negative port numbers become a failure, not a number', async () => {
  const { service, lastPort } = makeService();
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  for (const snapshot of [
    { state: 'playing', positionMs: 1000, durationMs: Number.NaN },
    { state: 'playing', positionMs: 1000, durationMs: -1 },
    { state: 'playing', positionMs: Number.NaN, durationMs: 60000 },
    { state: 'paused', positionMs: 0, durationMs: Number.POSITIVE_INFINITY },
  ] as const) {
    lastPort().snapshotValue = snapshot;
    const state = service.playbackState();
    assert.equal(state.kind, 'failed');
    if (state.kind !== 'failed') return;
    assert.deepEqual(state.token, guideToken(1));
    assert.ok(state.reason.length > 0);
    assert.equal('positionMs' in state, false);
    assert.equal('durationMs' in state, false);
  }
});

test('criterion 4: a port playing without a launch is a diagnostic, not playback', async () => {
  const { service, lastPort } = makeService();
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  lastPort().snapshotValue = { state: 'playing', positionMs: 10, durationMs: 20 };
  service.stop();
  const state = service.playbackState();
  assert.equal(state.kind, 'failed');
  if (state.kind !== 'failed') return;
  assert.equal(state.token, null);
  assert.match(state.reason, /without a launch/);
});

test('criterion 5: the player is created on the first play and re-created after dispose', async () => {
  const { service, ports, lastPort } = makeService();
  assert.equal(ports.length, 0);
  await service.play({ token: guideToken(1), path: 'a.mp3' });
  assert.equal(ports.length, 1);
  service.dispose();
  assert.equal(ports[0].disposed, true);
  await service.play({ token: momentToken(2), path: 'b.mp3' });
  assert.equal(ports.length, 2);
  // The disposed instance is never reset or reused: it receives nothing more.
  assert.deepEqual(ports[0].commands.slice(-1), ['dispose']);
  assert.deepEqual(lastPort().commands, ['play 2:b.mp3']);
  lastPort().finish(2);
  assert.deepEqual(service.playbackState(), { kind: 'idle' });
});

test('criterion 5: dispose with no player and a second dispose are no-ops', () => {
  const { service, ports } = makeService();
  service.dispose();
  service.dispose();
  assert.equal(ports.length, 0);
});

test('criterion 6: the services/audio sources import nothing from core/engine', async () => {
  for (const file of ['types.ts', 'service.ts', 'fake-port.ts', 'service.test.ts']) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    // Import syntax only: prose may name the boundary it guards.
    for (const quote of ['"', "'"]) {
      const importPattern = new RegExp(`from ${quote}[^${quote}]*core/engine`);
      assert.equal(importPattern.test(source), false, `${file} imports core/engine`);
    }
  }
});
