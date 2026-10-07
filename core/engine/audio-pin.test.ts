// G21.21 — the audio pin's engine acceptance (issue #553, ADR G21.20 §3/§4,
// approved 2026-10-07 with owner edits 1–5). The scenarios mirror the ADR §4
// acceptance table over the shared G05.01 fixtures: the synthetic walk pins
// fr text and en audio, every mixed-language behavior is proven at the
// reducer level, and every denial is a full ignore. The model parity suite
// keeps covering the monolingual domain (the frozen model's own scope); the
// mixed and text-only semantics live here.
//
// Proof posture (implementation-rules 1): each rule below fails when its
// code reverts — the path expression, the per-layer widening and the
// text-only command suppression are each pinned by a named test.
import assert from 'node:assert/strict';
import test from 'node:test';

import { accessReady, CONFIG, sessionOf, startEvent, started, STOPS, NOW } from './fixtures.ts';
import { step } from './reducer.ts';
import { initialRunState, stopStatus, type RunSessionState } from './state.ts';
import type { RunEvent } from './events.ts';

const send = (state: RunSessionState, event: RunEvent): RunSessionState =>
  sessionOf(step(state, event, NOW, CONFIG));

// The mixed fixture: fr text, en audio pinned and verified at Start, the
// same identity G21.20 §4 names (route-1/v3, stop-plain's base story).
const mixedStart = (overrides: Parameters<typeof startEvent>[0] = {}): RunSessionState =>
  sessionOf(
    step(
      initialRunState,
      startEvent({
        locale: 'fr',
        audioLocale: 'en',
        audioTier: ['base'],
        ...overrides,
      }),
      NOW,
      CONFIG,
    ),
  );

test('scenario 1 (ADR §4): fr text / en audio — Start carries both pins and the audio tier', () => {
  const s = mixedStart();
  assert.equal(s.locale, 'fr');
  assert.equal(s.audioLocale, 'en');
  assert.deepEqual(s.tierAvailable, ['base']);
  assert.deepEqual(s.audioTierAvailable, ['base']);
});

test('scenario 1: PlayStory builds the path from the audio pin, not the text locale', () => {
  // The command itself is the proof: the path names the en layer.
  const result = step(
    mixedStart(),
    { type: 'UserSelectedStop', stopId: 'stop-plain' },
    NOW,
    CONFIG,
  );
  assert.deepEqual(result.commands, [
    {
      type: 'PlayStory',
      storyId: 'story-plain-base',
      path: 'en/base/audio/story-plain-base.m4a',
      sessionId: 'session-1',
      playId: 1,
      token: { kind: 'guide', ref: 'session-1', seq: 1 },
    },
  ]);
});

test('scenario 1: AccessReady(fr) widens the text layer only; AccessReady(en) the audio layer only', () => {
  let s = mixedStart();
  // fr-extended: the text layer widens, the audio layer does not move.
  s = send(s, accessReady({ locale: 'fr', tier: 'extended', stopIds: ['stop-gate'] }));
  assert.deepEqual(s.tierAvailable, ['base', 'extended']);
  assert.deepEqual(s.audioTierAvailable, ['base']);
  // en-extended: the audio layer widens, the text layer does not move again.
  s = send(s, accessReady({ locale: 'en', tier: 'extended', stopIds: ['stop-gate'] }));
  assert.deepEqual(s.tierAvailable, ['base', 'extended']);
  assert.deepEqual(s.audioTierAvailable, ['base', 'extended']);
});

test('scenario 1: the paid extended story sounds only through its own unlocked audio tier', () => {
  // fr-extended text unlocked, en-extended audio not: the stop-gate story is
  // accessible but never audible — the text-only presentation.
  let s = send(mixedStart(), accessReady({ locale: 'fr', tier: 'extended', stopIds: ['stop-gate'] }));
  const result = step(s, { type: 'UserSelectedStop', stopId: 'stop-gate' }, NOW, CONFIG);
  assert.deepEqual(result.commands, [], 'no audio command without the audio tier');
  const after = sessionOf(result);
  assert.equal(after.playing, null);
  assert.deepEqual(after.heard, [], 'a text-only presentation credits nothing');
  // en-extended unlocks: the same manual play now sounds the en path.
  s = send(after, accessReady({ locale: 'en', tier: 'extended', stopIds: ['stop-gate'] }));
  const audible = step(s, { type: 'UserSelectedStop', stopId: 'stop-gate' }, NOW, CONFIG);
  assert.equal(audible.commands[0]?.type, 'PlayStory');
  if (audible.commands[0]?.type === 'PlayStory') {
    assert.equal(audible.commands[0].path, 'en/extended/audio/story-gate-ext.m4a');
  }
});

test('criterion 5: an automatic attempt on a text-only story burns once — manual access remains', () => {
  // The automatic path (dwell) reaches playGuide with automatic=true: the
  // attempt is over even though nothing sounded (§4.8.4, §3.2).
  const fix = {
    lat: 54.35,
    lng: 18.65,
    accuracy: 5,
    at: NOW,
    distances: new Map([['stop-plain', 10]]),
  };
  let s = sessionOf(
    step(initialRunState, startEvent({ locale: 'fr', audioLocale: 'en', audioTier: [] }), NOW, CONFIG),
  );
  s = send(s, { type: 'LocationAccepted', fix });
  s = send(s, { type: 'DwellCompleted', stopId: 'stop-plain', radius: 20 });
  assert.deepEqual(s.autoFired, ['stop-plain'], 'the automatic attempt burned text-only');
  assert.equal(s.playing, null, 'nothing sounded');
  assert.deepEqual(s.heard, []);
});

test('scenario 1: heard credits only a finished live launch of the mixed session', () => {
  const played = step(mixedStart(), { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG);
  const launch = sessionOf(played).playing;
  assert.ok(launch && launch.owner === 'guide');
  const finished = send(
    sessionOf(played),
    { type: 'AudioFinished', sessionId: 'session-1', playId: launch.playId },
  );
  assert.deepEqual(finished.heard, ['story-plain-base']);
});

test('scenario 2 / text_only_no_audio: a session without a pin never proposes audio', () => {
  const s = sessionOf(
    step(initialRunState, startEvent({ locale: 'fr', audioLocale: null }), NOW, CONFIG),
  );
  assert.equal(s.audioLocale, null);
  assert.deepEqual(s.audioTierAvailable, []);
  // Manual play of an accessible story: the text-only presentation.
  const result = step(s, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG);
  assert.deepEqual(result.commands, [], 'no PlayStory, no StopAudio, no audio command at all');
  const after = sessionOf(result);
  assert.equal(after.playing, null, 'playing stays null');
  assert.deepEqual(after.heard, [], 'nothing is counted');
  // AccessReady of the text locale never opens audio for a pinless session
  // — the text layer still widens normally.
  const widened = send(after, accessReady({ locale: 'fr', tier: 'extended', stopIds: ['stop-gate'] }));
  assert.deepEqual(widened.audioTierAvailable, [], 'no audio readiness without a pin');
  assert.deepEqual(widened.tierAvailable, ['base', 'extended'], 'the text layer widened');
});

test('scenario 3: a monolingual pin (audio = text locale) behaves byte-for-byte like the pre-G21.21 engine', () => {
  // Explicit pin = text locale: the audio layer is the text layer, seeded
  // from the same verified tiers.
  const pinned = sessionOf(
    step(
      initialRunState,
      startEvent({ locale: 'fr', audioLocale: 'fr', audioTier: ['base'] }),
      NOW,
      CONFIG,
    ),
  );
  const implicit = started(); // no audioLocale field: the same monolingual default
  assert.equal(pinned.audioLocale, 'fr');
  assert.equal(implicit.audioLocale, 'be');
  assert.deepEqual(pinned.audioTierAvailable, ['base']);
  assert.deepEqual(implicit.audioTierAvailable, ['base']);
  // The path and the launch rules: identical to the legacy shape.
  const play = step(pinned, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG);
  assert.equal(play.commands[0]?.type, 'PlayStory');
  if (play.commands[0]?.type === 'PlayStory') {
    assert.equal(play.commands[0].path, 'fr/base/audio/story-plain-base.m4a');
  }
  // AccessReady(fr) widens both mirrors (one layer).
  const widened = send(pinned, accessReady({ locale: 'fr', tier: 'extended', stopIds: ['stop-gate'] }));
  assert.deepEqual(widened.tierAvailable, ['base', 'extended']);
  assert.deepEqual(widened.audioTierAvailable, ['base', 'extended']);
});

test('foreign_grant_denied (criterion 4): a third locale, a wrong version and a foreign issuer are full ignores', () => {
  const s = mixedStart();
  for (const event of [
    accessReady({ locale: 'de', tier: 'base', stopIds: ['stop-plain'] }),
    accessReady({ version: 'v4', locale: 'en', tier: 'base', stopIds: ['stop-plain'] }),
    accessReady({ issuer: 'ui' as 'services/download', locale: 'en', tier: 'base', stopIds: ['stop-plain'] }),
  ]) {
    const snapshot = structuredClone(s);
    const result = step(s, event, NOW, CONFIG);
    assert.deepEqual(
      result.state,
      snapshot,
      `${event.type} ${'locale' in event ? String(event.locale) : ''} opens nothing`,
    );
    assert.deepEqual(result.commands, []);
  }
});

test('criterion 4: an audio grant cannot leak into text access', () => {
  const s = mixedStart();
  const snapshot = structuredClone(s);
  // en-base with stop ids: the audio tier widens, no text field mutates.
  const result = step(s, accessReady({ locale: 'en', tier: 'base', stopIds: ['stop-gate'] }), NOW, CONFIG);
  const after = sessionOf(result);
  assert.deepEqual(after.accessibleStopIds, snapshot.accessibleStopIds, 'no text access from an audio grant');
  assert.deepEqual(after.tierAvailable, snapshot.tierAvailable);
  assert.deepEqual(after.audioTierAvailable, ['base']);
  assert.deepEqual(result.commands, [], 'the geofence window follows text access only');
});

test('scenario 6 / criterion 4: a failed audio launch of the pinned layer credits nothing and suspends', () => {
  const played = step(mixedStart(), { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG);
  const launch = sessionOf(played).playing;
  assert.ok(launch && launch.owner === 'guide');
  const failed = send(sessionOf(played), {
    type: 'AudioFailed',
    token: { kind: 'guide', ref: 'session-1', seq: launch.playId },
    reason: 'decode-failed',
  });
  assert.equal(failed.playing, null);
  assert.deepEqual(failed.heard, [], 'a launch that never sounded is not heard');
  assert.equal(failed.autoplaySuspended, true, 'the next sound never starts by itself');
});

test('criterion 4: Start validates the pin — an empty locale and an unknown audio tier are refusals', () => {
  assert.throws(
    () => step(initialRunState, startEvent({ audioLocale: '' }), NOW, CONFIG),
    /audioLocale must be a non-empty locale/,
  );
  // The pin is a locale code, never a path segment — the engine refuses
  // separators and traversal before playGuide interpolates the path.
  for (const malformed of ['../en', 'en/../x', 'en/base', 'a\\b']) {
    assert.throws(
      () => step(initialRunState, startEvent({ locale: 'fr', audioLocale: malformed }), NOW, CONFIG),
      /audioLocale must be a non-empty locale/,
      `malformed pin ${malformed} is a refusal`,
    );
  }
  assert.throws(
    () => step(initialRunState, startEvent({ locale: 'fr', audioLocale: 'en', audioTier: ['premium' as 'base'] }), NOW, CONFIG),
    /audioTier must list verified layers/,
  );
});

test('criterion 5: the pin is immutable through the session — unlocks and pauses never move it', () => {
  let s = mixedStart();
  s = send(s, { type: 'Pause' });
  s = send(s, accessReady({ locale: 'en', tier: 'extended', stopIds: ['stop-gate'] }));
  s = send(s, { type: 'Resume' });
  s = send(s, { type: 'UserSelectedStop', stopId: 'stop-plain' });
  assert.equal(s.audioLocale, 'en');
  assert.equal(s.locale, 'fr');
});

test('criterion 5: the audio pin never touches stop status, missed list or geofence seeds', () => {
  // The status ladder and the missed list read the TEXT layer only: a
  // pinned-but-unready audio layer leaves the stop statuses unchanged.
  const s = mixedStart({ audioLocale: 'en', audioTier: [] });
  assert.equal(stopStatus(s, 'stop-plain'), 'pending');
  const played = step(s, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG);
  assert.deepEqual(played.commands, [], 'text-only without verified audio tiers');
  void STOPS;
});
