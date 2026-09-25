// G05.01.d — model parity and invariant properties
// (docs/agent-tasks/run/G05.01.d.md, issue #201).
//
// Every scenario of the frozen documentation model
// (docs/run-model/run-model.test.mjs) runs here
// against the production step() through the one name adapter below — the
// transfer the model README asks for («Як перанесці ў дадатак»: a small
// field-name adapter, never a second implementation of the rules). The
// scenario titles are the model's own, so a parity failure names the model
// scenario it contradicts.
//
// The adapter boundary, declared once: the model's start() arguments pack
// into the engine's Start event; fix distances arrive as a Map; the model's
// AccessReady vocabulary (stopIds and/or tiers, plus the synthetic
// PurchaseSucceeded) maps onto the engine's single-layer grant; stopStatus()
// and missedStories() are the engine spellings of the model's status()/missed().
// The step result's commands ride on the state like the model's do.
//
// Three command-level differences are canon-anchored, not hidden: the engine
// emits only ClearGeofences on Pause/End (09 §6.1 Commands; ADR G01.03 §3 —
// wakelock and location unsubscription are controller effects of the phase
// change), an accepted AccessReady rebuilds the geofence window as a
// SetGeofenceWindow command (ADR G01.03 §3), and the PlayMoment command
// carries (moment_id, token) without story_id (09 §6.1). The ported
// scenarios assert the canon outcome and cite the line.
//
// run-model files are frozen (19 §7.2): they are read here, never edited.
// The count comparison against the model suite lives in
// tools/engine-regressions/parity-count.mjs — the engine zone stays pure and
// spawns no processes.
import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultEngineConfig, step, type EngineConfig, type StepResult } from './reducer.ts';
import type { RunCommand } from './commands.ts';
import {
  initialRunState,
  missedStories,
  stopStatus,
  type AcceptedFix,
  type MomentId,
  type PackageStop,
  type PlayToken,
  type RunSessionState,
  type StoryId,
  type StopId,
  type Tier,
} from './state.ts';
import type { RunEvent } from './events.ts';

const CONFIG: EngineConfig = defaultEngineConfig;
const NOW = 100_000;

// The model's state view over the production session state: the step result's
// commands ride on the state like the model's do. step() clones its input and
// never reads `commands`, so the added field passes through the clone
// untouched and the view always overwrites it with the real result.
type View = RunSessionState & { commands: RunCommand[] };

const viewOf = (result: StepResult): View => {
  if (result.state.phase === 'Idle') throw new Error('no live session after the event');
  return { ...result.state, commands: result.commands };
};

// The state without the per-step command output — for comparisons whose claim
// is about the state itself (the model carries commands on the state, the
// engine returns them per step).
const stateOf = (v: View): Omit<View, 'commands'> => {
  const { commands: _commands, ...state } = structuredClone(v);
  return state;
};

// Start — the model's start(sessionId, routeStops, opts): the adapter packs
// the same arguments into the engine's Start event. The defaults are the
// model's own fixture convenience (run-model README §межы), not app rules.
type BeginOptions = {
  routeId?: string;
  version?: string;
  locale?: string;
  accessibleStopIds?: string[];
  tierAvailable?: Tier[];
  playingNow?: { momentId: string; storyId: string; seq: number };
};

type ModelStop = { id: string; storyBaseId?: string; storyExtendedId?: string };

const toStop = (spec: string | ModelStop): PackageStop =>
  typeof spec === 'string'
    ? { stopId: spec, storyBaseId: spec }
    : { stopId: spec.id, storyBaseId: spec.storyBaseId, storyExtendedId: spec.storyExtendedId };

const begin = (sessionId: string, routeStops: (string | ModelStop)[], options: BeginOptions = {}): View => {
  const stops = routeStops.map(toStop);
  const event: RunEvent = {
    type: 'Start',
    sessionId,
    routeId: options.routeId ?? 'route-1',
    version: options.version ?? 'v1',
    locale: options.locale ?? 'be',
    tier: options.tierAvailable ?? ['base'],
    accessibleStopIds: options.accessibleStopIds ?? stops.map((stop) => stop.stopId),
    stops,
    ...(options.playingNow ? { playingNow: options.playingNow } : {}),
  };
  return viewOf(step(initialRunState, event, NOW, CONFIG));
};

// The model's AccessReady vocabulary: stopIds and/or tiers, defaults per the
// model's access() builder (spread semantics included: an explicit undefined
// override replaces the default). The engine grant carries exactly one tier,
// so send() resolves the vocabulary per grant kind.
type ModelAccessReady = {
  type: 'AccessReady';
  routeId?: string;
  version?: string;
  locale?: string;
  issuer?: string;
  stopIds?: string[];
  tiers?: string[];
  tier?: string;
};

type ModelEvent =
  | RunEvent
  | ModelAccessReady
  | { type: 'PurchaseSucceeded'; stopIds?: string[] }
  | { type: 'MomentFinished'; token: PlayToken }
  | { type: 'AudioFailed'; token: PlayToken };

const arrive = (stopId: string): RunEvent => ({ type: 'DwellCompleted', stopId, radius: 20 });
const pick = (stopId: string): RunEvent => ({ type: 'UserSelectedStop', stopId });
const pickStory = (stopId: string, storyId: string): RunEvent => ({
  type: 'UserSelectedStory',
  stopId,
  storyId,
});
const finishAudio = (s: View): RunEvent => ({
  type: 'AudioFinished',
  sessionId: s.sessionId,
  playId: guideOf(s).playId,
});
const momentPlay = (seq = 1): RunEvent => ({
  type: 'PlayMoment',
  momentId: 'moment-9',
  storyId: 'story-m9',
  token: { kind: 'moment', ref: 'moment-9', seq },
});
const momentToken = (s: View): PlayToken => {
  const launch = momentOf(s);
  return { kind: 'moment', ref: launch.momentId, seq: launch.seq };
};
const guideToken = (s: View): PlayToken => ({
  kind: 'guide',
  ref: s.sessionId,
  seq: guideOf(s).playId,
});
const currentTokenOf = (s: View): PlayToken => {
  if (!s.playing) return { kind: 'moment', ref: 'moment-9', seq: 0 };
  return s.playing.owner === 'guide'
    ? { kind: 'guide', ref: s.sessionId, seq: s.playing.playId }
    : { kind: 'moment', ref: s.playing.momentId, seq: s.playing.seq };
};

// The launch-field reads of the port: the engine's owner union narrows here.
// guideOf/momentOf state the owner the scenario means — a launch of the other
// owner fails the scenario at the read. currentPlayId/playingStopOf read the
// guide-only fields with the model's missing-key semantics (undefined).
const guideOf = (s: View) => {
  assert.ok(s.playing && s.playing.owner === 'guide', 'the model means a guide launch');
  return s.playing;
};
const momentOf = (s: View) => {
  assert.ok(s.playing && s.playing.owner === 'moment', 'the model means a moment launch');
  return s.playing;
};
const currentPlayId = (s: View): number | undefined =>
  s.playing && s.playing.owner === 'guide' ? s.playing.playId : undefined;
const playingStopOf = (s: View): StopId | undefined =>
  s.playing && s.playing.owner === 'guide' ? s.playing.stopId : undefined;
const access = (overrides: Omit<ModelAccessReady, 'type'> = {}): ModelAccessReady => ({
  type: 'AccessReady',
  routeId: 'route-1',
  version: 'v1',
  locale: 'be',
  issuer: 'services/download',
  ...overrides,
});
const atFix = (overrides: { at?: number; accuracy?: number; distances?: Record<string, number> } = {}): AcceptedFix => ({
  lat: 0,
  lng: 0,
  at: overrides.at ?? NOW,
  accuracy: overrides.accuracy ?? 5,
  distances: new Map(
    Object.entries(
      overrides.distances ?? { a: 0, b: 0, c: 0, 'stop-crane': 0, 'stop-gate': 0 },
    ),
  ),
});
const located = (overrides?: { at?: number; accuracy?: number; distances?: Record<string, number> }): RunEvent => ({
  type: 'LocationAccepted',
  fix: atFix(overrides),
});
const acceptFix = (fix: AcceptedFix): RunEvent => ({ type: 'LocationAccepted', fix });

// The engine spellings of the model's status()/missed().
const status = (s: View, id: string) => stopStatus(s, id);
const missed = (s: View) => missedStories(s);

// AccessReady tier vocabulary. The engine grant names exactly one layer (09
// §6.1); the model names stopIds and tiers. A single valid layer maps to that
// layer. A stop-only grant (no layer named) re-affirms an already-available
// layer — widening a present layer is a no-op for tier_available, the exact
// engine reading of «no layer named». Any other mixture (an unknown value,
// several layers) has no single-layer representation: the value goes through
// as-is and the engine's identity check refuses the grant entirely — the
// model's own atomic refusal for an unknown value (run-model README §межы).
// The suite exercises the single-layer and unknown-value cases; a grant of
// several valid layers is not representable and not exercised.
function engineTier(grant: ModelAccessReady, s: View): string {
  if (grant.tiers !== undefined) {
    if (grant.tiers.length === 0) return s.tierAvailable[0];
    if (grant.tiers.length === 1 && (grant.tiers[0] === 'base' || grant.tiers[0] === 'extended')) {
      return grant.tiers[0];
    }
    return grant.tiers as unknown as string;
  }
  return grant.tier ?? s.tierAvailable[0];
}

// The one name adapter: every event the model's scenarios use maps onto the
// engine's event union here — nothing else in this file translates shapes.
function toEngine(event: ModelEvent, s: View): RunEvent {
  if (event.type === 'PurchaseSucceeded') {
    // No engine event exists for purchases — they reach the engine only as
    // AccessReady of the download identity. The model's switch ignores the
    // synthetic event entirely; the unglobbed Timer is the same no-op.
    return { type: 'Timer', id: 'purchase' };
  }
  if (event.type === 'AccessReady') {
    const grant = event as ModelAccessReady;
    return {
      type: 'AccessReady',
      routeId: grant.routeId,
      version: grant.version,
      locale: grant.locale,
      issuer: grant.issuer,
      tier: engineTier(grant, s),
      stopIds: grant.stopIds ?? [],
      // Deliberately invalid grants (a foreign issuer, a bogus layer) are
      // runtime rejections of 09 §6.1, not type errors — the cast carries
      // them to the boundary check.
    } as unknown as RunEvent;
  }
  if (event.type === 'MomentFinished' && !('momentId' in event)) {
    // The model sends the tag only; the engine event also carries the moment
    // identity, which the rejection rule never reads.
    return {
      type: 'MomentFinished',
      token: event.token,
      momentId: s.playing?.owner === 'moment' ? s.playing.momentId : String(event.token.ref),
      storyId: s.playing ? s.playing.storyId : '',
    };
  }
  if (event.type === 'AudioFailed' && !('reason' in event)) {
    return { type: 'AudioFailed', token: event.token, reason: 'synthetic' };
  }
  return event;
}

const send = (s: View, event: ModelEvent, at = NOW): View =>
  viewOf(step(s, toEngine(event, s), at, CONFIG));

// Fixtures of the model suite, in its own shapes.
const STOPS = ['a', 'b', 'c'];
const CRANE = [
  { id: 'stop-crane', storyBaseId: 'story-crane-base', storyExtendedId: 'story-crane-ext' },
  { id: 'stop-gate', storyExtendedId: 'story-gate-ext' },
];
const fixture = (): View => send(begin('walk-1', STOPS), located());
const craneFixture = (
  { accessibleStopIds = ['stop-crane'], tierAvailable = ['base'] as Tier[] } = {},
): View => send(begin('session-1', CRANE, { version: 'v3', accessibleStopIds, tierAvailable }), located());
const lockedFixture = (): View =>
  send(begin('walk-1', STOPS, { version: 'v1', accessibleStopIds: ['a', 'c'] }), located());

// The invariant bundle the exhaustive walk checks per transition — the
// model's exploration assertions plus the 09 §6.1 numbers they implement.
function checkParityInvariants(prev: View, next: View, event: ModelEvent, context: string): void {
  // 1: the monotonic sets only grow and never repeat an entry.
  assert.ok(prev.heard.every((id) => next.heard.includes(id)), context);
  assert.ok(prev.autoFired.every((id) => next.autoFired.includes(id)), context);
  assert.equal(new Set(next.heard).size, next.heard.length, context);
  assert.equal(new Set(next.autoFired).size, next.autoFired.length, context);
  // 2: at most one narration — one launch, at most one play command per step.
  assert.ok(next.commands.filter((c) => c.type === 'PlayStory').length <= 1, context);
  assert.ok(next.commands.filter((c) => c.type === 'PlayMoment').length <= 1, context);
  // 3: an automatic narration starts only from a dwell (or its deferred play
  // after a finish); a moment command only from an explicit Play Moment.
  for (const command of next.commands) {
    if (command.type === 'PlayStory') {
      assert.ok(
        ['DwellCompleted', 'AudioFinished', 'UserSelectedStop', 'UserSelectedStory'].includes(event.type),
        context,
      );
    }
    if (command.type === 'PlayMoment') assert.equal(event.type, 'PlayMoment', context);
  }
  // 7: a sounding guide launch requires a live, unsuspended, unpaused
  // session; a moment mirror may exist in any session state.
  assert.ok(
    !next.playing || next.playing.owner === 'moment' || next.playing.paused
      || (next.phase === 'Active' && !next.autoplaySuspended),
    context,
  );
  // 9: Ended never returns to Active; a live Pause and End clear the queue
  // and release the geofences (on Ended the event is ignored entirely).
  if (prev.phase === 'Ended') assert.equal(next.phase, 'Ended', context);
  if ((event.type === 'Pause' || event.type === 'End') && prev.phase !== 'Ended') {
    assert.equal(next.queued, null, context);
    assert.ok(next.commands.some((c) => c.type === 'ClearGeofences'), context);
  }
  // ADR G01.02 §3.5: a moment launch never credits guide history.
  if (next.playing?.owner === 'moment') {
    assert.deepEqual(next.heard.filter((id) => !prev.heard.includes(id)), [], context);
  }
}

// The ported scenarios, one entry per model test registration (the two
// loop registrations of the model file are expanded). Titles are the model's.
type Scenario = { title: string; run: () => void };

const livePausePair = (): Scenario[] =>
  (['UserPausedAudio', 'FocusLoss'] as const).map((event) => ({
    title: `C18/C19/C20: ${event} is a live pause that blocks arrivals until explicit Play`,
    run: () => {
      let s = send(fixture(), arrive('a'));
      const token = guideToken(s);
      s = send(s, { type: event });
      assert.equal(playingStopOf(s), 'a');
      assert.equal(s.playing?.paused, true);
      assert.deepEqual(s.commands, []); // the player keeps the offset, no stop command
      s = send(s, arrive('b'));
      assert.equal(playingStopOf(s), 'a');
      assert.equal(s.playing?.paused, true);
      assert.equal(status(s, 'b'), 'available');
      assert.deepEqual(s.autoFired, ['a', 'b']);
      s = send(s, { type: 'ResumeAudio', token });
      assert.equal(s.playing?.paused, false);
      assert.equal(currentPlayId(s), token.seq); // same launch, same token
      assert.equal(s.autoplaySuspended, false);
      assert.deepEqual(s.commands, [{ type: 'ResumeAudio', token }]);
    },
  }));

const positionQuartet = (): Scenario[] =>
  (
    [
      ['missing', null],
      ['stale', { at: NOW - 30_001 }],
      ['inaccurate', { accuracy: 21 }],
      ['too far', { distances: { a: 0, b: 41, c: 0 } }],
    ] as const
  ).map(([label, overrides]) => ({
    title: `C22: ${label} position retires queue without playback`,
    run: () => {
      let s = send(send(fixture(), arrive('a')), arrive('b'));
      s = send(
        s,
        overrides === null
          ? { type: 'LocationAccepted', fix: null as unknown as AcceptedFix }
          : located(overrides),
      );
      s = send(s, finishAudio(s));
      assert.equal(s.playing, null);
      assert.equal(status(s, 'b'), 'available');
      assert.deepEqual(s.heard, ['a']);
    },
  }));

const scenarios: Scenario[] = [
  {
    title: 'C2: accepted arrival starts audio and spends automatic attempt',
    run: () => {
      const s = send(fixture(), arrive('a'));
      assert.equal(playingStopOf(s), 'a');
      assert.equal(s.playing?.storyId, 'a');
      assert.deepEqual(s.autoFired, ['a']);
      assert.equal(s.commands[0]?.type, 'PlayStory');
    },
  },
  {
    title: 'C6: completed automatic stop never autoplays twice; manual replay works',
    run: () => {
      let s = send(fixture(), arrive('a'));
      s = send(s, finishAudio(s));
      s = send(s, arrive('a'));
      assert.equal(s.playing, null);
      s = send(s, pick('a'));
      assert.equal(playingStopOf(s), 'a');
      assert.equal(currentPlayId(s), 2);
    },
  },
  {
    title: 'C7/C11: interrupted replay preserves heard and finish summary',
    run: () => {
      let s = send(fixture(), arrive('a'));
      s = send(s, finishAudio(s));
      s = send(s, pick('a'));
      s = send(s, { type: 'UserPausedAudio' });
      assert.equal(status(s, 'a'), 'played');
      s = send(s, { type: 'End' });
      assert.deepEqual(missed(s), ['b', 'c']);
    },
  },
  {
    title: 'G01.01.b: base heard stays heard after same-version unlock; no new Play',
    run: () => {
      let s = craneFixture();
      s = send(s, pick('stop-crane'));
      assert.equal(s.playing?.storyId, 'story-crane-base');
      s = send(s, finishAudio(s));
      assert.deepEqual(s.heard, ['story-crane-base']);
      s = send(s, access({ version: 'v3', tiers: ['extended'] }));
      // Acceptance rebuilds the geofence window (ADR G01.03 §3, 09 §6.1);
      // the model's applyAccess records no command — the port asserts the
      // canon shape. No Play, heard untouched.
      assert.deepEqual(s.commands, [{ type: 'SetGeofenceWindow', stopIds: ['stop-crane'] }]);
      assert.equal(s.playing, null);
      assert.deepEqual(s.heard, ['story-crane-base']);
      assert.equal(status(s, 'stop-crane'), 'played');
      assert.deepEqual(missed(s), ['story-crane-ext']);
      s = send(s, arrive('stop-crane'));
      assert.equal(s.playing, null);
      s = send(s, pickStory('stop-crane', 'story-crane-ext'));
      assert.equal(s.playing?.storyId, 'story-crane-ext');
    },
  },
  {
    title: 'G01.01.b: extended is credited only by its own finished playback',
    run: () => {
      let s = craneFixture({ tierAvailable: ['base', 'extended'] });
      s = send(s, pick('stop-crane'));
      s = send(s, finishAudio(s));
      assert.deepEqual(s.heard, ['story-crane-base']);
      const first = send(s, pickStory('stop-crane', 'story-crane-ext'));
      assert.equal(currentPlayId(first), 2);
      s = send(first, { type: 'UserPausedAudio' });
      assert.deepEqual(s.heard, ['story-crane-base']);
      assert.equal(status(s, 'stop-crane'), 'played');
      s = send(s, pickStory('stop-crane', 'story-crane-ext'));
      assert.equal(currentPlayId(s), 3);
      s = send(s, finishAudio(s));
      assert.deepEqual(s.heard, ['story-crane-base', 'story-crane-ext']);
      assert.equal(status(s, 'stop-crane'), 'played');
    },
  },
  {
    title: 'G01.01.b: paid-only stop stays locked until same-version unlock, then is a normal stop',
    run: () => {
      let s = craneFixture();
      assert.equal(status(s, 'stop-gate'), 'locked');
      s = send(s, arrive('stop-gate'));
      assert.equal(s.playing, null);
      assert.deepEqual(s.autoFired, []);
      s = send(s, { type: 'PurchaseSucceeded', stopIds: ['stop-gate'] });
      s = send(s, pickStory('stop-gate', 'story-gate-ext'));
      assert.equal(s.playing, null);
      s = send(s, access({ version: 'v3', stopIds: ['stop-gate'], tiers: ['extended'] }));
      assert.equal(status(s, 'stop-gate'), 'pending');
      assert.equal(s.playing, null);
      s = send(s, arrive('stop-gate'));
      assert.equal(s.playing?.storyId, 'story-gate-ext');
    },
  },
  {
    title: 'G01.01.b: manual primary before approach never autoplays again',
    run: () => {
      let s = craneFixture();
      s = send(s, pick('stop-crane'));
      s = send(s, finishAudio(s));
      assert.deepEqual(s.autoFired, []);
      s = send(s, arrive('stop-crane'));
      assert.equal(s.playing, null);
      assert.deepEqual(s.autoFired, []);
    },
  },
  {
    title: 'G01.01.b: queue does not replay a primary heard manually meanwhile',
    run: () => {
      let s = send(send(fixture(), arrive('a')), arrive('b'));
      assert.equal(s.queued?.stopId, 'b');
      s = send(s, pick('b'));
      s = send(s, finishAudio(s));
      assert.deepEqual(s.heard, ['b']);
      assert.equal(s.queued, null);
      assert.deepEqual(s.autoFired, ['a', 'b']);
      assert.equal(s.playing, null);
      assert.equal(s.commands.some((c) => c.type === 'PlayStory'), false);
    },
  },
  {
    title: 'G01.01.b: completion callback naming a foreign story is ignored',
    run: () => {
      let s = craneFixture({ tierAvailable: ['base', 'extended'] });
      s = send(s, pickStory('stop-crane', 'story-crane-ext'));
      s = send(s, {
        type: 'AudioFinished',
        sessionId: s.sessionId,
        playId: guideOf(s).playId,
        storyId: 'story-crane-base',
      });
      assert.deepEqual(s.heard, []);
      assert.equal(s.playing?.storyId, 'story-crane-ext');
      s = send(s, finishAudio(s));
      assert.deepEqual(s.heard, ['story-crane-ext']);
    },
  },
  {
    title: 'G01.01.b: completion with present-but-empty or null story id is ignored',
    run: () => {
      for (const bad of ['', null]) {
        let s = craneFixture();
        s = send(s, pick('stop-crane'));
        // The empty and null story ids are runtime rejections of the
        // completion rule (09 invariant 4), not type errors.
        const badFinish = {
          type: 'AudioFinished',
          sessionId: s.sessionId,
          playId: guideOf(s).playId,
          storyId: bad,
        } as unknown as RunEvent;
        s = send(s, badFinish);
        assert.deepEqual(s.heard, [], `storyId=${JSON.stringify(bad)}`);
        assert.equal(s.playing?.storyId, 'story-crane-base');
        s = send(s, finishAudio(s));
        assert.deepEqual(s.heard, ['story-crane-base']);
      }
    },
  },
  {
    title: 'G01.01.b: markers are stop-level from the primary; additional unheard stays out of pending',
    run: () => {
      let s = craneFixture({ tierAvailable: ['base', 'extended'] });
      assert.equal(status(s, 'stop-crane'), 'pending');
      s = send(s, pickStory('stop-crane', 'story-crane-ext'));
      assert.equal(status(s, 'stop-crane'), 'playing');
      s = send(s, finishAudio(s));
      assert.equal(status(s, 'stop-crane'), 'pending');
      s = send(s, pick('stop-crane'));
      s = send(s, finishAudio(s));
      assert.equal(status(s, 'stop-crane'), 'played');
      assert.deepEqual(missed(s), []);
    },
  },
  {
    title: 'G01.01.b: unlock never rewrites the primary of a paid-only stop',
    run: () => {
      let s = craneFixture();
      s = send(s, access({ version: 'v3', stopIds: ['stop-gate'], tiers: ['extended'] }));
      s = send(s, arrive('stop-gate'));
      const first = s.playing?.storyId;
      assert.equal(first, 'story-gate-ext');
      s = send(s, finishAudio(s));
      s = send(s, pick('stop-gate'));
      assert.equal(s.playing?.storyId, 'story-gate-ext');
    },
  },
  {
    title: 'C8: queued stop remains eligible and plays after current audio',
    run: () => {
      let s = send(send(fixture(), arrive('a')), arrive('b'));
      assert.equal(s.queued?.stopId, 'b');
      assert.equal(status(s, 'b'), 'pending');
      assert.deepEqual(s.autoFired, ['a']);
      s = send(s, finishAudio(s));
      assert.equal(playingStopOf(s), 'b');
      assert.deepEqual(s.autoFired, ['a', 'b']);
    },
  },
  {
    title: 'C9/C13/C14: paused session ignores arrivals; explicit resume restores eligibility',
    run: () => {
      let s = send(fixture(), { type: 'Pause' });
      assert.equal(s.phase, 'Paused');
      assert.ok(s.commands.some((c) => c.type === 'ClearGeofences'));
      s = send(s, arrive('b'));
      assert.deepEqual(s.autoFired, []);
      s = send(s, { type: 'Resume' });
      s = send(s, arrive('b'));
      assert.equal(playingStopOf(s), 'b');
    },
  },
  {
    title: 'C10: old completion cannot finish a replay of the same story',
    run: () => {
      let s = send(fixture(), pick('a'));
      const old = guideOf(s).playId;
      s = send(s, pick('a'));
      s = send(s, { type: 'AudioFinished', sessionId: s.sessionId, playId: old });
      assert.equal(currentPlayId(s), old + 1);
      assert.deepEqual(s.heard, []);
    },
  },
  {
    title: 'C10: equal play numbers from different sessions do not collide',
    run: () => {
      const old = send(fixture(), pick('a'));
      let s = send(begin('walk-2', STOPS), pick('b'));
      assert.equal(currentPlayId(old), currentPlayId(s));
      s = send(s, { type: 'AudioFinished', sessionId: old.sessionId, playId: guideOf(old).playId });
      assert.equal(playingStopOf(s), 'b');
      assert.deepEqual(s.heard, []);
    },
  },
  {
    title: 'C12: manually completed stop does not autoplay on later arrival',
    run: () => {
      let s = send(fixture(), pick('a'));
      s = send(s, finishAudio(s));
      assert.deepEqual(s.autoFired, []);
      s = send(s, arrive('a'));
      assert.equal(s.playing, null);
    },
  },
  {
    title: 'C13: session pause retires queued attempt and stops playback',
    run: () => {
      let s = send(send(fixture(), arrive('a')), arrive('b'));
      s = send(s, { type: 'Pause' });
      assert.equal(s.playing, null);
      assert.equal(s.queued, null);
      assert.equal(status(s, 'b'), 'available');
      assert.ok(s.commands.some((c) => c.type === 'StopAudio'));
    },
  },
  {
    title: 'C16: ended session cannot resume or accept manual playback',
    run: () => {
      let s = send(fixture(), { type: 'End' });
      s = send(s, { type: 'Resume' });
      s = send(s, pick('a'));
      assert.equal(s.phase, 'Ended');
      assert.equal(s.playing, null);
      const next = begin('walk-2', STOPS);
      assert.notEqual(next.sessionId, s.sessionId);
      assert.deepEqual(next.heard, []);
    },
  },
  ...livePausePair(),
  {
    title: 'G01.02.b: start injects a sounding moment and refuses any other playingNow',
    run: () => {
      assert.throws(
        () =>
          begin('walk-9', STOPS, {
            playingNow: { stopId: 'a', storyId: 'a', playId: 1 } as unknown as {
              momentId: string;
              storyId: string;
              seq: number;
            },
          }),
        RangeError,
      );
      assert.throws(
        () => begin('walk-9', STOPS, { playingNow: { momentId: 'moment-9', storyId: 'story-m9', seq: 0 } }),
        RangeError,
      );
      const s = begin('walk-1', STOPS, { playingNow: { momentId: 'moment-9', storyId: 'story-m9', seq: 7 } });
      assert.deepEqual(s.playing, {
        owner: 'moment',
        momentId: 'moment-9',
        storyId: 'story-m9',
        seq: 7,
        paused: false,
      });
      assert.equal(s.playSeq, 0); // moment tokens never touch the session counter
      assert.equal(s.autoplaySuspended, false); // Start turns automation on, not the player
    },
  },
  {
    title: 'G01.02.b (§4.2): explicit Play Moment takes the player; guide is stopped by command, not heard',
    run: () => {
      let s = send(send(fixture(), arrive('a')), arrive('b'));
      s = send(s, momentPlay());
      assert.deepEqual(s.commands, [
        { type: 'StopAudio', token: { kind: 'guide', ref: 'walk-1', seq: 1 } },
        // The engine command names the moment and its token (09 §6.1:
        // PlayMoment(moment_id, path, play_token)); the model adds story_id.
        { type: 'PlayMoment', momentId: 'moment-9', token: { kind: 'moment', ref: 'moment-9', seq: 1 } },
      ]);
      assert.deepEqual(s.playing, {
        owner: 'moment',
        momentId: 'moment-9',
        storyId: 'story-m9',
        seq: 1,
        paused: false,
      });
      assert.deepEqual(s.heard, []);
      assert.equal(status(s, 'a'), 'available');
      assert.equal(s.queued, null);
      assert.deepEqual(s.autoFired, ['a', 'b']); // the queue retired to auto_fired
      assert.equal(s.autoplaySuspended, true);
    },
  },
  {
    title: 'G01.02.b (§4.3): moment finished frees the player without crediting history or automation',
    run: () => {
      let s = send(send(fixture(), arrive('a')), momentPlay());
      s = send(s, { type: 'MomentFinished', token: momentToken(s) });
      assert.equal(s.playing, null);
      assert.deepEqual(s.heard, []);
      assert.equal(s.autoplaySuspended, true);
      assert.equal(s.commands.some((c) => c.type === 'PlayStory'), false);
      assert.equal(status(s, 'a'), 'available');
    },
  },
  {
    title: 'G01.02.b (§4.4): a failed moment launch suspends automation and credits nothing',
    run: () => {
      let s = send(send(fixture(), arrive('a')), momentPlay());
      s = send(s, { type: 'AudioFailed', token: momentToken(s) });
      assert.equal(s.playing, null);
      assert.deepEqual(s.heard, []);
      assert.equal(s.autoplaySuspended, true);
      assert.equal(s.commands.some((c) => c.type === 'PlayStory'), false);
    },
  },
  {
    title: 'G01.02.b (§4.5): «Працягнуць гід» restores automation; the stale completion is ignored entirely',
    run: () => {
      let s = send(send(send(fixture(), arrive('a')), arrive('b')), momentPlay());
      s = send(s, { type: 'MomentFinished', token: momentToken(s) });
      s = send(s, { type: 'GuideResume' });
      assert.equal(s.autoplaySuspended, false);
      assert.equal(s.playing, null); // nothing sounds by itself after the return
      s = send(s, { type: 'AudioFinished', sessionId: 'walk-1', playId: 1 });
      assert.equal(s.playing, null);
      assert.deepEqual(s.heard, []);
      s = send(s, arrive('c'));
      assert.equal(playingStopOf(s), 'c'); // the next trigger runs the general conditions
    },
  },
  {
    title: 'G01.02.b (§4.6): focus loss during a moment is a live pause; resume continues the same token',
    run: () => {
      let s = send(fixture(), momentPlay());
      s = send(s, { type: 'FocusLoss' });
      assert.equal(s.playing?.paused, true);
      assert.equal(momentOf(s).seq, 1);
      assert.equal(s.focusLostAt, NOW);
      s = send(s, { type: 'FocusRegain' });
      assert.equal(s.playing?.paused, true);
      assert.equal(momentOf(s).seq, 1);
      s = send(s, { type: 'ResumeAudio', token: momentToken(s) });
      assert.equal(s.playing?.paused, false);
      assert.equal(momentOf(s).seq, 1);
      assert.equal(s.autoplaySuspended, true); // a moment resume never clears Play Moment's suspension
      assert.deepEqual(s.commands, [
        { type: 'ResumeAudio', token: { kind: 'moment', ref: 'moment-9', seq: 1 } },
      ]);
    },
  },
  {
    title: 'G01.02.b (§4.7): focus regain past 10 minutes closes the launch; the old token is refused',
    run: () => {
      let s = send(fixture(), momentPlay());
      s = send(s, { type: 'FocusLoss' });
      s = send(s, { type: 'FocusRegain' }, NOW + 600_001);
      assert.equal(s.playing, null);
      assert.equal(s.focusLostAt, null);
      s = send(s, { type: 'ResumeAudio', token: { kind: 'moment', ref: 'moment-9', seq: 1 } });
      assert.equal(s.playing, null);
      assert.deepEqual(s.commands, []);
      s = send(s, momentPlay(2));
      assert.equal(momentOf(s).seq, 2); // a repeat is always a fresh launch
    },
  },
  {
    title: 'G01.02.b (§4.8): End during a moment keeps it sounding; late guide completions are rejected',
    run: () => {
      let s = send(send(fixture(), arrive('a')), momentPlay());
      s = send(s, { type: 'End' });
      assert.equal(s.phase, 'Ended');
      assert.equal(s.playing?.owner, 'moment'); // manual content is not session property
      assert.deepEqual(s.heard, []);
      // Wakelock and location unsubscription are controller effects of the
      // phase change (ADR G01.03 §3); the engine command is ClearGeofences
      // (09 §6.1 Commands) — the model records them as extra synthetic rows.
      assert.ok(s.commands.some((c) => c.type === 'ClearGeofences'));
      assert.equal(s.commands.some((c) => c.type === 'StopAudio'), false);
      s = send(s, { type: 'AudioFinished', sessionId: 'walk-1', playId: 1 });
      assert.equal(s.playing?.owner, 'moment');
      assert.deepEqual(s.heard, []);
      s = send(s, { type: 'FocusLoss' });
      s = send(s, { type: 'ResumeAudio', token: momentToken(s) });
      assert.equal(s.playing?.paused, false);
      assert.equal(s.phase, 'Ended'); // a moment resume never restores the session
    },
  },
  {
    title: 'G01.02.b (§4.9): a session pause touches only the walk; a moment keeps sounding',
    run: () => {
      let s = begin('walk-1', STOPS, { playingNow: { momentId: 'moment-9', storyId: 'story-m9', seq: 3 } });
      s = send(s, located());
      s = send(s, { type: 'Pause' });
      assert.equal(s.phase, 'Paused');
      assert.deepEqual(s.playing, {
        owner: 'moment',
        momentId: 'moment-9',
        storyId: 'story-m9',
        seq: 3,
        paused: false,
      });
      assert.equal(s.commands.some((c) => c.type === 'StopAudio'), false);
      assert.ok(s.commands.some((c) => c.type === 'ClearGeofences')); // canon-anchored: see §4.8
      s = send(s, { type: 'ResumeAudio', token: momentToken(s) }); // not paused — refused
      assert.deepEqual(s.commands, []);
      s = send(s, momentPlay(4)); // an explicit Play Moment works in a paused session
      assert.equal(s.phase, 'Paused');
      assert.equal(momentOf(s).seq, 4);
      s = send(s, { type: 'Resume' });
      assert.equal(s.phase, 'Active');
      assert.equal(s.playing?.owner, 'moment');
      s = send(s, arrive('a'));
      assert.equal(s.queued?.stopId, 'a'); // autoplay waits for the occupied player
      assert.equal(s.playing?.owner, 'moment');
    },
  },
  {
    title: 'G01.02.b (§4.10): a new session sees the occupied player and waits for it',
    run: () => {
      send(
        begin('walk-1', STOPS, { playingNow: { momentId: 'moment-9', storyId: 'story-m9', seq: 5 } }),
        { type: 'End' },
      );
      let s = begin('walk-2', STOPS, { playingNow: { momentId: 'moment-9', storyId: 'story-m9', seq: 5 } });
      s = send(s, located());
      assert.equal(s.playing?.owner, 'moment');
      s = send(s, arrive('a'));
      assert.equal(s.queued?.stopId, 'a');
      assert.equal(s.playing?.owner, 'moment');
      s = send(s, { type: 'MomentFinished', token: momentToken(s) });
      assert.equal(s.playing, null);
      assert.equal(s.queued?.stopId, 'a'); // the queue waits; a finish never starts it
      assert.equal(s.commands.some((c) => c.type === 'PlayStory'), false);
    },
  },
  {
    title: 'G01.02.b (§4.12): moment → moment leaves one sound; the old token is ignored entirely',
    run: () => {
      let s = send(fixture(), momentPlay(1));
      s = send(s, momentPlay(2));
      assert.deepEqual(s.commands, [
        { type: 'StopAudio', token: { kind: 'moment', ref: 'moment-9', seq: 1 } },
        { type: 'PlayMoment', momentId: 'moment-9', token: { kind: 'moment', ref: 'moment-9', seq: 2 } },
      ]);
      s = send(s, { type: 'ResumeAudio', token: { kind: 'moment', ref: 'moment-9', seq: 1 } });
      assert.equal(momentOf(s).seq, 2);
      assert.deepEqual(s.commands, []); // a stale resume is a refused command
      s = send(s, { type: 'MomentFinished', token: { kind: 'moment', ref: 'moment-9', seq: 1 } });
      assert.equal(momentOf(s).seq, 2); // the stale completion changed nothing
      s = send(s, { type: 'MomentFinished', token: { kind: 'moment', ref: 'moment-9', seq: 2 } });
      assert.equal(s.playing, null);
    },
  },
  {
    title: 'G01.02.b (§4.12): moment → guide hands the player over; the moment token dies',
    run: () => {
      let s = send(fixture(), momentPlay(4));
      s = send(s, pick('a'));
      assert.deepEqual(s.commands.map((c) => c.type), ['StopAudio', 'PlayStory']);
      // The type-sequence assertion above pins commands[0] as the StopAudio.
      const stopCommand = s.commands[0] as Extract<RunCommand, { type: 'StopAudio' }>;
      assert.deepEqual(stopCommand.token, { kind: 'moment', ref: 'moment-9', seq: 4 });
      assert.equal(s.autoplaySuspended, false); // an explicit guide play is an explicit return
      s = send(s, { type: 'MomentFinished', token: { kind: 'moment', ref: 'moment-9', seq: 4 } });
      assert.equal(s.playing?.owner, 'guide');
      assert.deepEqual(s.heard, []);
      s = send(s, { type: 'AudioFinished', sessionId: 'walk-1', playId: guideOf(s).playId });
      assert.deepEqual(s.heard, ['a']);
    },
  },
  {
    title: 'G01.02.b (§4.15): a failed guide launch is not heard; «Працягнуць гід» re-arms the next trigger',
    run: () => {
      let s = send(fixture(), pick('a'));
      s = send(s, { type: 'AudioFailed', token: guideToken(s) });
      assert.equal(s.playing, null);
      assert.deepEqual(s.heard, []);
      assert.equal(s.autoplaySuspended, true);
      s = send(s, arrive('b'));
      assert.equal(s.playing, null); // suspended — a failure never starts the next sound
      assert.deepEqual(s.autoFired, ['b']);
      s = send(s, { type: 'GuideResume' });
      s = send(s, arrive('c'));
      assert.equal(playingStopOf(s), 'c');
    },
  },
  {
    title: 'G01.02.b (§3.4): a manual audio stop closes the launch and suspends automation',
    run: () => {
      let s = send(fixture(), arrive('a'));
      s = send(s, { type: 'UserStoppedAudio' });
      assert.equal(s.playing, null);
      assert.deepEqual(s.heard, []);
      assert.equal(status(s, 'a'), 'available');
      assert.equal(s.autoplaySuspended, true);
      assert.deepEqual(s.commands, [{ type: 'StopAudio', token: { kind: 'guide', ref: 'walk-1', seq: 1 } }]);
    },
  },
  {
    title: 'G01.02.b (§3.4): focus regain past 10 minutes closes a guide launch without crediting it',
    run: () => {
      let s = send(fixture(), arrive('a'));
      s = send(s, { type: 'FocusLoss' });
      s = send(s, { type: 'FocusRegain' }, NOW + 600_001);
      assert.equal(s.playing, null);
      assert.deepEqual(s.heard, []);
      assert.equal(status(s, 'a'), 'available');
      assert.equal(s.autoplaySuspended, true);
    },
  },
  {
    title: 'G01.02.b (§3.7): a manual pause has no 10-minute threshold',
    run: () => {
      let s = send(fixture(), pick('a'));
      const token = guideToken(s);
      s = send(s, { type: 'UserPausedAudio' });
      s = send(s, { type: 'FocusRegain' }, NOW + 900_000);
      assert.equal(s.playing?.paused, true); // no focus_lost_at was armed
      s = send(s, { type: 'ResumeAudio', token });
      assert.equal(s.playing?.paused, false);
      assert.equal(currentPlayId(s), token.seq);
    },
  },
  {
    title: 'C5/C21: newest queued stop replaces previous without marking it heard',
    run: () => {
      let s = send(send(send(fixture(), arrive('a')), arrive('b')), arrive('c'));
      assert.equal(status(s, 'b'), 'available');
      assert.equal(s.heard.includes('b'), false);
      s = send(s, finishAudio(s));
      assert.equal(playingStopOf(s), 'c');
    },
  },
  ...positionQuartet(),
  {
    title: 'C22: exact freshness, accuracy and queued distance boundaries are accepted',
    run: () => {
      let s = send(send(fixture(), arrive('a')), arrive('b'));
      s = send(s, located({ at: NOW - 30_000, accuracy: 20, distances: { b: 40 } }));
      assert.equal(playingStopOf(send(s, finishAudio(s))), 'b');
    },
  },
  {
    title: 'C24: selecting another stop stops first before playing second',
    run: () => {
      const s = send(send(fixture(), arrive('a')), pick('b'));
      assert.equal(status(s, 'a'), 'available');
      assert.equal(playingStopOf(s), 'b');
      assert.deepEqual(s.commands.map((c) => c.type), ['StopAudio', 'PlayStory']);
    },
  },
  {
    title: 'boundary: inactive state takes precedence over suspended autoplay',
    run: () => {
      let s = send(fixture(), { type: 'Pause' });
      s = send(s, arrive('a'));
      assert.equal(status(s, 'a'), 'pending');
      assert.equal(s.queued, null);
    },
  },
  {
    title: 'boundary: stale immediate trigger spends no attempt; fresh retry succeeds',
    run: () => {
      let s = send(fixture(), located({ at: 0 }));
      s = send(s, arrive('a'));
      assert.deepEqual(s.autoFired, []);
      s = send(s, located());
      assert.equal(playingStopOf(send(s, arrive('a'))), 'a');
    },
  },
  {
    title: 'boundary: replayed queue notification cannot evict itself',
    run: () => {
      let s = send(send(fixture(), arrive('a')), arrive('b'));
      s = send(s, arrive('b'));
      assert.equal(status(s, 'b'), 'pending');
      assert.equal(playingStopOf(send(s, finishAudio(s))), 'b');
    },
  },
  {
    title: 'boundary: unknown stop and future timestamp cannot trigger playback',
    run: () => {
      let s = send(fixture(), arrive('unknown'));
      assert.equal(s.playing, null);
      s = send(s, located({ at: NOW + 1 }));
      s = send(s, arrive('a'));
      assert.equal(s.playing, null);
      assert.deepEqual(s.autoFired, []);
    },
  },
  {
    title: 'boundary: unknown story and cross-stop story selection are rejected',
    run: () => {
      let s = send(fixture(), pickStory('a', 'nonexistent'));
      assert.equal(s.playing, null);
      s = send(s, pickStory('a', 'b'));
      assert.equal(s.playing, null);
      s = send(s, pickStory('a', 'a'));
      assert.equal(s.playing?.storyId, 'a');
    },
  },
  {
    title: 'reducer does not mutate input state or event',
    run: () => {
      const s = fixture();
      const event = arrive('a');
      const original = structuredClone({ s, event });
      send(s, event);
      assert.deepEqual({ s, event }, original);
    },
  },
  {
    title: 'C31: every permutation of stop visits works without following suggested order',
    run: () => {
      for (const order of [
        ['a', 'b', 'c'],
        ['a', 'c', 'b'],
        ['b', 'a', 'c'],
        ['b', 'c', 'a'],
        ['c', 'a', 'b'],
        ['c', 'b', 'a'],
      ]) {
        let s = fixture();
        for (const id of order) {
          s = send(s, arrive(id));
          assert.equal(playingStopOf(s), id);
          s = send(s, finishAudio(s));
        }
        assert.deepEqual([...s.heard].sort(), STOPS);
        assert.equal(s.phase, 'Active');
      }
    },
  },
  {
    title: 'C32: ending after one freely selected stop is a normal session end',
    run: () => {
      let s = send(fixture(), arrive('c'));
      s = send(s, finishAudio(s));
      s = send(s, { type: 'End' });
      assert.equal(s.phase, 'Ended');
      assert.deepEqual(missed(s), ['a', 'b']);
      assert.equal(s.commands.some((c) => /fail|incomplete/i.test(c.type)), false);
    },
  },
  {
    title: 'C33: locked preview is excluded from manual and automatic playback and remaining list',
    run: () => {
      let s = lockedFixture();
      assert.equal(status(s, 'b'), 'locked');
      s = send(send(s, arrive('b')), pick('b'));
      assert.equal(s.playing, null);
      assert.deepEqual(s.autoFired, []);
      assert.deepEqual(missed(s), ['a', 'c']);
    },
  },
  {
    title: 'C34: verified downloaded access unlocks any nearby stop without restarting progress',
    run: () => {
      let s = send(lockedFixture(), arrive('c'));
      s = send(s, finishAudio(s));
      s = send(s, access({ stopIds: ['b'] }));
      assert.equal(status(s, 'b'), 'pending');
      assert.equal(s.playing, null);
      assert.deepEqual(s.heard, ['c']);
      s = send(s, arrive('b'));
      assert.equal(playingStopOf(s), 'b');
      assert.equal(s.sessionId, 'walk-1');
    },
  },
  {
    title: 'C35: catalog version change cannot unlock or replace active session content',
    run: () => {
      let s = lockedFixture();
      s = send(s, access({ version: 'v2', stopIds: ['b'] }));
      assert.equal(s.version, 'v1');
      assert.equal(status(s, 'b'), 'locked');
      assert.deepEqual(s.tierAvailable, ['base']);
    },
  },
  {
    title: 'C33: purchase notification alone is not playable access',
    run: () => {
      let s = lockedFixture();
      s = send(s, { type: 'PurchaseSucceeded', stopIds: ['b'] });
      s = send(s, pick('b'));
      assert.equal(s.playing, null);
      assert.equal(status(s, 'b'), 'locked');
    },
  },
  {
    title: 'boundary: access update is atomic and rejects unknown stops and tiers',
    run: () => {
      let s = send(lockedFixture(), access({ stopIds: ['b', 'unknown'] }));
      assert.equal(status(s, 'b'), 'locked');
      s = send(lockedFixture(), access({ tiers: ['extended', 'bogus'] }));
      assert.equal(status(s, 'b'), 'locked');
      assert.deepEqual(s.tierAvailable, ['base']);
    },
  },
  {
    title: 'G01.03.b: grant for another route is ignored entirely',
    run: () => {
      let s = lockedFixture();
      const before = structuredClone(s);
      before.commands = [];
      s = send(s, access({ routeId: 'route-2', stopIds: ['b'] }));
      assert.deepEqual(s, before);
    },
  },
  {
    title: 'G01.03.b: grant for another locale is ignored entirely',
    run: () => {
      let s = lockedFixture();
      const before = structuredClone(s);
      before.commands = [];
      s = send(s, access({ locale: 'en', stopIds: ['b'] }));
      assert.deepEqual(s, before);
    },
  },
  {
    title: 'G01.03.b: grant from a non-download issuer is ignored entirely',
    run: () => {
      for (const issuer of ['purchase-flow', undefined]) {
        const s = lockedFixture();
        const after = send(s, access({ issuer, stopIds: ['b'] }));
        assert.deepEqual(stateOf(after), stateOf(s), `issuer=${String(issuer)}`);
        assert.deepEqual(after.commands, [], `issuer=${String(issuer)}`);
      }
    },
  },
  {
    title: 'G01.03.b: repeated identical AccessReady is a no-op',
    run: () => {
      const event = access({ stopIds: ['b'], tiers: ['extended'] });
      let s = lockedFixture();
      s = send(s, event);
      // The model keeps its step commands on the state, so its no-op
      // comparison covers them; the engine returns commands per step, and the
      // repeat's claim is about the state — the comparison strips the
      // per-step output, which the assertion below checks separately.
      const onceState = stateOf(s);
      s = send(s, event);
      assert.deepEqual(stateOf(s), onceState);
      assert.deepEqual(s.commands, []);
      assert.equal(status(s, 'b'), 'pending');
    },
  },
  {
    title: 'G01.03.b: late grant after End mutates nothing; a session pinning that version still receives it',
    run: () => {
      let ended = send(fixture(), { type: 'End' });
      const before = structuredClone(ended);
      before.commands = [];
      ended = send(ended, access({ stopIds: ['b'] }));
      assert.deepEqual(ended, before);
      let fresh = begin('walk-2', STOPS, { version: 'v1' });
      fresh = send(fresh, access({ stopIds: ['b'] }));
      assert.equal(status(fresh, 'b'), 'pending');
      assert.equal(fresh.version, 'v1');
    },
  },
  {
    title: 'G01.03.b: version stays pinned across pause, resume and a foreign-version grant',
    run: () => {
      let s = send(lockedFixture(), { type: 'Pause' });
      s = send(s, access({ version: 'v2', stopIds: ['b'] }));
      assert.equal(status(s, 'b'), 'locked'); // a foreign-version grant changes nothing live
      s = send(s, { type: 'Resume' });
      assert.equal(s.version, 'v1');
      assert.deepEqual(s.tierAvailable, ['base']);
      assert.equal(status(s, 'b'), 'locked');
    },
  },
  {
    title: 'G01.03.b: playSeq is a write-through counter; an old playSeq cannot credit a newer play',
    run: () => {
      let s = fixture();
      s = send(s, pick('a'));
      const firstPlaySeq = s.playSeq;
      assert.equal(guideOf(s).playId, firstPlaySeq);
      s = send(s, pick('b'));
      assert.equal(s.playSeq, firstPlaySeq + 1);
      s = send(s, { type: 'AudioFinished', sessionId: s.sessionId, playId: firstPlaySeq });
      assert.deepEqual(s.heard, []);
      assert.equal(playingStopOf(s), 'b');
    },
  },
  {
    title: 'G01.03.b: start refuses a package claiming no verified layer or an unknown layer',
    run: () => {
      assert.throws(() => begin('walk-9', STOPS, { tierAvailable: [] }), RangeError);
      assert.throws(
        () => begin('walk-9', STOPS, { tierAvailable: ['premium'] as unknown as Tier[] }),
        RangeError,
      );
    },
  },
  {
    title: 'G01.03.b: start refuses accessibleStopIds naming stops outside the pinned package',
    run: () => {
      assert.throws(() => begin('walk-9', STOPS, { accessibleStopIds: ['a', 'ghost'] }), RangeError);
    },
  },
  {
    title: 'bounded exploration: invariants across all 4-event sequences (16 choices per step)',
    run: () => {
      let transitions = 0;
      const explore = (s: View, depth: number): void => {
        if (!depth) return;
        const current = currentTokenOf(s);
        const events: ModelEvent[] = [
          arrive('a'),
          arrive('b'),
          pick('a'),
          pickStory('a', 'a'),
          { type: 'AudioFinished', sessionId: s.sessionId, playId: currentPlayId(s) ?? -1 },
          momentPlay(1),
          { type: 'MomentFinished', token: current },
          { type: 'AudioFailed', token: current },
          { type: 'ResumeAudio', token: current },
          { type: 'UserPausedAudio' },
          { type: 'UserStoppedAudio' },
          { type: 'GuideResume' },
          { type: 'FocusLoss' },
          { type: 'FocusRegain' },
          { type: 'Pause' },
          { type: 'End' },
        ];
        for (const event of events) {
          const snapshot = structuredClone(s);
          const next = send(s, event);
          const context = JSON.stringify({ phase: s.phase, event: event.type });
          assert.deepEqual(s, snapshot, context);
          checkParityInvariants(s, next, event, context);
          transitions++;
          explore(next, depth - 1);
        }
      };
      explore(fixture(), 4);
      assert.equal(transitions, 69_904);
    },
  },
];

for (const scenario of scenarios) {
  test(scenario.title, scenario.run);
}

// Invariant properties (09 §6.1: «кожны — property-тэст»). Seeded and
// deterministic: the walks use a fixed-seed PRNG, so every run explores the
// same transitions.
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

function pickWalkEvent(random: () => number, s: View): ModelEvent {
  const current = currentTokenOf(s);
  const generators: ((state: View) => ModelEvent)[] = [
    () => arrive('a'),
    () => arrive('b'),
    () => arrive('c'),
    () => pick('a'),
    () => pick('b'),
    () => pickStory('a', 'a'),
    () => pickStory('b', 'b'),
    (state) => ({ type: 'AudioFinished', sessionId: state.sessionId, playId: currentPlayId(state) ?? -1 }),
    () => momentPlay(1),
    () => ({ type: 'MomentFinished', token: current }),
    () => ({ type: 'AudioFailed', token: current }),
    () => ({ type: 'ResumeAudio', token: current }),
    () => ({ type: 'UserPausedAudio' }),
    () => ({ type: 'UserStoppedAudio' }),
    () => ({ type: 'GuideResume' }),
    () => ({ type: 'FocusLoss' }),
    () => ({ type: 'FocusRegain' }),
    () => ({ type: 'Pause' }),
    () => ({ type: 'End' }),
    () =>
      located({
        at: NOW - Math.floor(random() * 40_000),
        accuracy: Math.floor(random() * 30),
        distances: {
          a: Math.floor(random() * 60),
          b: Math.floor(random() * 60),
          c: Math.floor(random() * 60),
          'stop-crane': 0,
          'stop-gate': 0,
        },
      }),
    () => access({ stopIds: ['a'] }),
    () => access({ tiers: ['extended'] }),
  ];
  return generators[Math.floor(random() * generators.length)](s);
}

for (const seed of [11, 23, 47]) {
  test(`invariants 1, 2, 3, 7, 9 hold across a seeded walk (seed ${seed})`, () => {
    const random = mulberry32(seed);
    let s = fixture();
    for (let i = 0; i < 400; i++) {
      const event = pickWalkEvent(random, s);
      const snapshot = structuredClone(s);
      const next = send(s, event);
      const context = `seed ${seed} step ${i}: ${event.type}`;
      assert.deepEqual(s, snapshot, context);
      checkParityInvariants(s, next, event, context);
      s = next;
    }
  });
}

for (const seed of [5, 29]) {
  test(`invariant 4: a stale callback never credits, stops or starts the queue (seed ${seed})`, () => {
    const random = mulberry32(seed);
    let s = fixture();
    for (let i = 0; i < 150; i++) {
      s = send(s, pickWalkEvent(random, s));
      const probe = (stale: RunEvent, kind: string): void => {
        const before = structuredClone(s);
        const after = send(s, stale);
        const label = `seed ${seed} step ${i}: ${kind}`;
        assert.deepEqual(
          { heard: after.heard, playing: after.playing, queued: after.queued, autoFired: after.autoFired },
          { heard: s.heard, playing: s.playing, queued: s.queued, autoFired: s.autoFired },
          label,
        );
        assert.deepEqual(after.commands, [], label);
        assert.deepEqual(s, before, label);
      };
      // Another session, an earlier launch, a foreign story.
      probe({ type: 'AudioFinished', sessionId: 'other-session', playId: s.playSeq }, 'other session');
      probe({ type: 'AudioFinished', sessionId: s.sessionId, playId: s.playSeq + 5 }, 'earlier launch');
      probe(
        {
          type: 'AudioFinished',
          sessionId: s.sessionId,
          playId: currentPlayId(s) ?? -1,
          storyId: 'not-this-story' as StoryId,
        },
        'foreign story',
      );
    }
  });
}

test('invariant 5: past 10 minutes FocusRegain closes any launch; a manual pause has no threshold', () => {
  for (const owner of ['guide', 'moment'] as const) {
    let s = owner === 'guide' ? send(fixture(), pick('a')) : send(fixture(), momentPlay(3));
    s = send(s, { type: 'FocusLoss' }, NOW);
    s = send(s, { type: 'FocusRegain' }, NOW + 600_000);
    assert.equal(s.playing?.paused, true); // the threshold bound is inclusive — still a live pause
    s = send(s, { type: 'FocusLoss' }, NOW + 1_000_000);
    s = send(s, { type: 'FocusRegain' }, NOW + 1_000_000 + 600_001);
    assert.equal(s.playing, null); // one millisecond past the threshold closes the launch
  }
  let s = send(fixture(), pick('a'));
  const token = guideToken(s);
  s = send(s, { type: 'UserPausedAudio' });
  s = send(s, { type: 'FocusRegain' }, NOW + 900_000);
  assert.equal(s.playing?.paused, true); // a manual pause armed no focus_lost_at
  s = send(s, { type: 'ResumeAudio', token });
  assert.equal(currentPlayId(s), token.seq);
});

test('invariant 6: FocusLoss never finishes a launch (seeded)', () => {
  const random = mulberry32(101);
  let s = fixture();
  for (let i = 0; i < 300; i++) {
    const event = pickWalkEvent(random, s);
    const next = send(s, event);
    if (event.type === 'FocusLoss') {
      const context = `step ${i}`;
      assert.deepEqual(next.heard, s.heard, context);
      if (s.playing) {
        assert.ok(next.playing, context);
        assert.deepEqual(currentTokenOf(next), currentTokenOf(s), context); // same launch, same token
        assert.equal(next.playing.paused, true, context);
      }
      assert.equal(next.autoplaySuspended, true, context);
    }
    s = next;
  }
});

test('invariant 8: an unusable position never auto-plays, immediately or deferred', () => {
  const random = mulberry32(77);
  for (let i = 0; i < 50; i++) {
    const cases = [
      { kind: 'stale', overrides: { at: NOW - 30_001 - Math.floor(random() * 10_000) } },
      { kind: 'inaccurate', overrides: { accuracy: 21 + Math.floor(random() * 100) } },
      { kind: 'too far', overrides: { distances: { a: 41 + Math.floor(random() * 100), b: 41 + Math.floor(random() * 100), c: 0 } } },
    ];
    for (const { kind, overrides } of cases) {
      // Immediate: a free player and a bad fix — the trigger is ignored
      // entirely and spends no attempt.
      let free = send(fixture(), acceptFix(atFix(overrides)));
      free = send(free, arrive('a'));
      assert.equal(free.playing, null, `${kind} (iteration ${i})`);
      assert.deepEqual(free.autoFired, []);
      // Deferred: a queued trigger re-checks the position against the current
      // fix at 2 × radius before it plays.
      let queued = send(send(fixture(), arrive('a')), arrive('b'));
      queued = send(queued, acceptFix(atFix(overrides)));
      const after = send(queued, finishAudio(queued));
      assert.equal(after.playing, null, `${kind} (iteration ${i})`);
      assert.deepEqual(after.heard, ['a']);
      assert.equal(status(after, 'b'), 'available');
    }
  }
});

test('invariant 9: Pause and End clear the queue and release geofences; Ended never revives', () => {
  for (const event of ['Pause', 'End'] as const) {
    let s = send(send(fixture(), arrive('a')), arrive('b'));
    s = send(s, { type: event });
    assert.equal(s.queued, null);
    assert.equal(s.playing, null); // the guide launch stops by command
    assert.equal(s.commands.filter((c) => c.type === 'StopAudio').length, 1);
    assert.ok(s.commands.some((c) => c.type === 'ClearGeofences'));
  }
  let ended = send(fixture(), { type: 'End' });
  const revival: ModelEvent[] = [
    { type: 'Resume' },
    pick('a'),
    arrive('b'),
    { type: 'GuideResume' },
    access({ stopIds: ['a'] }),
  ];
  for (const event of revival) {
    ended = send(ended, event);
    assert.equal(ended.phase, 'Ended', event.type);
    assert.equal(ended.playing, null, event.type);
  }
});
