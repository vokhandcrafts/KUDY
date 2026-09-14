import test from 'node:test';
import assert from 'node:assert/strict';
import { start, step, status, missed } from './run-model.mjs';

const stops = ['a', 'b', 'c'];
const now = 100_000;
const fix = (overrides = {}) => ({ at: now, accuracy: 5,
  distances: { a: 0, b: 0, c: 0, 'stop-crane': 0, 'stop-gate': 0 }, ...overrides });
const trigger = id => ({ type: 'DwellCompleted', stopId: id, radius: 20 });
const play = id => ({ type: 'UserSelectedStop', stopId: id });
const playStory = (stopId, storyId) => ({ type: 'UserSelectedStory', stopId, storyId });
function fixture() {
  return step(start('walk-1', stops), { type: 'LocationAccepted', fix: fix() }, now);
}
const send = (s, e) => step(s, e, now);
const finishAudio = s => send(s, { type: 'AudioFinished',
  sessionId: s.sessionId, playId: s.playing.playId });
// G01.03 §3.5: the trusted AccessReady identity — issuer, route, version,
// locale; stopIds/tiers are granted per event. Events never carry defaults.
const access = (overrides = {}) => ({ type: 'AccessReady', routeId: 'route-1',
  version: 'v1', locale: 'be', issuer: 'services/download', ...overrides });

// ADR G01.01 variant A fixtures: stop-crane has base + extended stories,
// stop-gate is paid-only (extended story only, no fake free story).
const crane = [
  { id: 'stop-crane', storyBaseId: 'story-crane-base', storyExtendedId: 'story-crane-ext' },
  { id: 'stop-gate', storyExtendedId: 'story-gate-ext' },
];
function craneFixture({ accessibleStopIds = ['stop-crane'], tierAvailable = ['base'] } = {}) {
  return step(start('session-1', crane, { version: 'v3', accessibleStopIds, tierAvailable }),
    { type: 'LocationAccepted', fix: fix() }, now);
}

test('C2: accepted arrival starts audio and spends automatic attempt', () => {
  const s = send(fixture(), trigger('a'));
  assert.equal(s.playing?.stopId, 'a');
  assert.equal(s.playing?.storyId, 'a');
  assert.deepEqual(s.autoFired, ['a']);
  assert.equal(s.commands[0]?.type, 'PlayStory');
});

test('C6: completed automatic stop never autoplays twice; manual replay works', () => {
  let s = finishAudio(send(fixture(), trigger('a')));
  s = send(s, trigger('a'));
  assert.equal(s.playing, null);
  s = send(s, play('a'));
  assert.equal(s.playing?.stopId, 'a');
  assert.equal(s.playing?.playId, 2);
});

test('C7/C11: interrupted replay preserves heard and finish summary', () => {
  let s = finishAudio(send(fixture(), trigger('a')));
  s = send(s, play('a'));
  s = send(s, { type: 'UserPausedAudio' });
  assert.equal(status(s, 'a'), 'played');
  s = send(s, { type: 'End' });
  assert.deepEqual(missed(s), ['b', 'c']);
});

test('G01.01.b: base heard stays heard after same-version unlock; no new Play', () => {
  let s = craneFixture();
  s = send(s, play('stop-crane'));
  assert.equal(s.playing?.storyId, 'story-crane-base');
  s = finishAudio(s);
  assert.deepEqual(s.heard, ['story-crane-base']);
  s = send(s, access({ version: 'v3', tiers: ['extended'] }));
  assert.deepEqual(s.commands, []);
  assert.equal(s.playing, null);
  assert.deepEqual(s.heard, ['story-crane-base']);
  assert.equal(status(s, 'stop-crane'), 'played');
  assert.deepEqual(missed(s), ['story-crane-ext']);
  s = send(s, trigger('stop-crane'));
  assert.equal(s.playing, null);
  s = send(s, playStory('stop-crane', 'story-crane-ext'));
  assert.equal(s.playing?.storyId, 'story-crane-ext');
});

test('G01.01.b: extended is credited only by its own finished playback', () => {
  let s = craneFixture({ tierAvailable: ['base', 'extended'] });
  s = finishAudio(send(s, play('stop-crane')));
  assert.deepEqual(s.heard, ['story-crane-base']);
  const first = send(s, playStory('stop-crane', 'story-crane-ext'));
  assert.equal(first.playing?.playId, 2);
  s = send(first, { type: 'UserPausedAudio' });
  assert.deepEqual(s.heard, ['story-crane-base']);
  assert.equal(status(s, 'stop-crane'), 'played');
  s = send(s, playStory('stop-crane', 'story-crane-ext'));
  assert.equal(s.playing?.playId, 3);
  s = finishAudio(s);
  assert.deepEqual(s.heard, ['story-crane-base', 'story-crane-ext']);
  assert.equal(status(s, 'stop-crane'), 'played');
});

test('G01.01.b: paid-only stop stays locked until same-version unlock, then is a normal stop', () => {
  let s = craneFixture();
  assert.equal(status(s, 'stop-gate'), 'locked');
  s = send(s, trigger('stop-gate'));
  assert.equal(s.playing, null);
  assert.deepEqual(s.autoFired, []);
  s = send(s, { type: 'PurchaseSucceeded', stopIds: ['stop-gate'] });
  s = send(s, playStory('stop-gate', 'story-gate-ext'));
  assert.equal(s.playing, null);
  s = send(s, access({ version: 'v3', stopIds: ['stop-gate'], tiers: ['extended'] }));
  assert.equal(status(s, 'stop-gate'), 'pending');
  assert.equal(s.playing, null);
  s = send(s, trigger('stop-gate'));
  assert.equal(s.playing?.storyId, 'story-gate-ext');
});

test('G01.01.b: manual primary before approach never autoplays again', () => {
  let s = craneFixture();
  s = finishAudio(send(s, play('stop-crane')));
  assert.deepEqual(s.autoFired, []);
  s = send(s, trigger('stop-crane'));
  assert.equal(s.playing, null);
  assert.deepEqual(s.autoFired, []);
});

test('G01.01.b: queue does not replay a primary heard manually meanwhile', () => {
  let s = send(send(fixture(), trigger('a')), trigger('b'));
  assert.equal(s.queued?.stopId, 'b');
  s = send(s, play('b'));
  s = finishAudio(s);
  assert.deepEqual(s.heard, ['b']);
  assert.equal(s.queued, null);
  assert.deepEqual(s.autoFired, ['a', 'b']);
  assert.equal(s.playing, null);
  assert.equal(s.commands.some(c => c.type === 'PlayStory'), false);
});

test('G01.01.b: completion callback naming a foreign story is ignored', () => {
  let s = craneFixture({ tierAvailable: ['base', 'extended'] });
  s = send(s, playStory('stop-crane', 'story-crane-ext'));
  s = send(s, { type: 'AudioFinished', sessionId: s.sessionId,
    playId: s.playing.playId, storyId: 'story-crane-base' });
  assert.deepEqual(s.heard, []);
  assert.equal(s.playing?.storyId, 'story-crane-ext');
  s = finishAudio(s);
  assert.deepEqual(s.heard, ['story-crane-ext']);
});

test('G01.01.b: completion with present-but-empty or null story id is ignored', () => {
  for (const bad of ['', null]) {
    let s = craneFixture();
    s = send(s, play('stop-crane'));
    s = send(s, { type: 'AudioFinished', sessionId: s.sessionId,
      playId: s.playing.playId, storyId: bad });
    assert.deepEqual(s.heard, [], `storyId=${JSON.stringify(bad)}`);
    assert.equal(s.playing?.storyId, 'story-crane-base');
    s = finishAudio(s);
    assert.deepEqual(s.heard, ['story-crane-base']);
  }
});

test('G01.01.b: markers are stop-level from the primary; additional unheard stays out of pending', () => {
  let s = craneFixture({ tierAvailable: ['base', 'extended'] });
  assert.equal(status(s, 'stop-crane'), 'pending');
  s = send(s, playStory('stop-crane', 'story-crane-ext'));
  assert.equal(status(s, 'stop-crane'), 'playing');
  s = finishAudio(s);
  assert.equal(status(s, 'stop-crane'), 'pending');
  s = finishAudio(send(s, play('stop-crane')));
  assert.equal(status(s, 'stop-crane'), 'played');
  assert.deepEqual(missed(s), []);
});

test('G01.01.b: unlock never rewrites the primary of a paid-only stop', () => {
  let s = craneFixture();
  s = send(s, access({ version: 'v3', stopIds: ['stop-gate'], tiers: ['extended'] }));
  s = send(s, trigger('stop-gate'));
  const first = s.playing?.storyId;
  assert.equal(first, 'story-gate-ext');
  s = finishAudio(s);
  s = send(s, play('stop-gate'));
  assert.equal(s.playing?.storyId, 'story-gate-ext');
});

test('C8: queued stop remains eligible and plays after current audio', () => {
  let s = send(send(fixture(), trigger('a')), trigger('b'));
  assert.equal(s.queued?.stopId, 'b');
  assert.equal(status(s, 'b'), 'pending');
  assert.deepEqual(s.autoFired, ['a']);
  s = finishAudio(s);
  assert.equal(s.playing?.stopId, 'b');
  assert.deepEqual(s.autoFired, ['a', 'b']);
});

test('C9/C13/C14: paused session ignores arrivals; explicit resume restores eligibility', () => {
  let s = send(fixture(), { type: 'Pause' });
  assert.equal(s.state, 'Paused');
  assert.ok(s.commands.some(c => c.type === 'ClearGeofences'));
  s = send(s, trigger('b'));
  assert.deepEqual(s.autoFired, []);
  s = send(s, { type: 'Resume' });
  s = send(s, trigger('b'));
  assert.equal(s.playing?.stopId, 'b');
});

test('C10: old completion cannot finish a replay of the same story', () => {
  let s = send(fixture(), play('a'));
  const old = s.playing.playId;
  s = send(s, play('a'));
  s = send(s, { type: 'AudioFinished', sessionId: s.sessionId, playId: old });
  assert.equal(s.playing?.playId, old + 1);
  assert.deepEqual(s.heard, []);
});

test('C10: equal play numbers from different sessions do not collide', () => {
  const old = send(fixture(), play('a'));
  let s = send(start('walk-2', stops), play('b'));
  assert.equal(old.playing.playId, s.playing.playId);
  s = send(s, { type: 'AudioFinished', sessionId: old.sessionId,
    playId: old.playing.playId });
  assert.equal(s.playing?.stopId, 'b');
  assert.deepEqual(s.heard, []);
});

test('C12: manually completed stop does not autoplay on later arrival', () => {
  let s = finishAudio(send(fixture(), play('a')));
  assert.deepEqual(s.autoFired, []);
  s = send(s, trigger('a'));
  assert.equal(s.playing, null);
});

test('C13: session pause retires queued attempt and stops playback', () => {
  let s = send(send(fixture(), trigger('a')), trigger('b'));
  s = send(s, { type: 'Pause' });
  assert.equal(s.playing, null);
  assert.equal(s.queued, null);
  assert.equal(status(s, 'b'), 'available');
  assert.ok(s.commands.some(c => c.type === 'StopAudio'));
});

test('C16: ended session cannot resume or accept manual playback', () => {
  let s = send(fixture(), { type: 'End' });
  s = send(s, { type: 'Resume' });
  s = send(s, play('a'));
  assert.equal(s.state, 'Ended');
  assert.equal(s.playing, null);
  const next = start('walk-2', stops);
  assert.notEqual(next.sessionId, s.sessionId);
  assert.deepEqual(next.heard, []);
});

for (const event of ['UserPausedAudio', 'FocusLoss']) {
  test(`C18/C19/C20: ${event} blocks arrivals until explicit Play`, () => {
    let s = send(send(fixture(), trigger('a')), { type: event });
    s = send(s, trigger('b'));
    assert.equal(s.playing, null);
    assert.equal(status(s, 'b'), 'available');
    s = send(s, { type: 'FocusRegain' });
    assert.equal(s.playing, null);
    assert.equal(s.suspended, true);
    s = send(s, play('b'));
    assert.equal(s.suspended, false);
    assert.equal(s.playing?.stopId, 'b');
  });
}

test('C5/C21: newest queued stop replaces previous without marking it heard', () => {
  let s = send(send(send(fixture(), trigger('a')), trigger('b')), trigger('c'));
  assert.equal(status(s, 'b'), 'available');
  assert.equal(s.heard.includes('b'), false);
  s = finishAudio(s);
  assert.equal(s.playing?.stopId, 'c');
});

for (const [label, location] of [
  ['missing', null], ['stale', fix({ at: now - 30_001 })],
  ['inaccurate', fix({ accuracy: 21 })],
  ['too far', fix({ distances: { a: 0, b: 41, c: 0 } })],
]) {
  test(`C22: ${label} position retires queue without playback`, () => {
    let s = send(send(fixture(), trigger('a')), trigger('b'));
    s = send(s, { type: 'LocationAccepted', fix: location });
    s = finishAudio(s);
    assert.equal(s.playing, null);
    assert.equal(status(s, 'b'), 'available');
    assert.deepEqual(s.heard, ['a']);
  });
}

test('C22: exact freshness, accuracy and queued distance boundaries are accepted', () => {
  let s = send(send(fixture(), trigger('a')), trigger('b'));
  s = send(s, { type: 'LocationAccepted', fix: fix({ at: now - 30_000,
    accuracy: 20, distances: { b: 40 } }) });
  assert.equal(finishAudio(s).playing?.stopId, 'b');
});

test('C24: selecting another stop stops first before playing second', () => {
  const s = send(send(fixture(), trigger('a')), play('b'));
  assert.equal(status(s, 'a'), 'available');
  assert.equal(s.playing?.stopId, 'b');
  assert.deepEqual(s.commands.map(c => c.type), ['StopAudio', 'PlayStory']);
});

test('boundary: inactive state takes precedence over suspended autoplay', () => {
  let s = send(fixture(), { type: 'Pause' });
  s = send(s, trigger('a'));
  assert.equal(status(s, 'a'), 'pending');
  assert.equal(s.queued, null);
});

test('boundary: stale immediate trigger spends no attempt; fresh retry succeeds', () => {
  let s = send(fixture(), { type: 'LocationAccepted', fix: fix({ at: 0 }) });
  s = send(s, trigger('a'));
  assert.deepEqual(s.autoFired, []);
  s = send(s, { type: 'LocationAccepted', fix: fix() });
  assert.equal(send(s, trigger('a')).playing?.stopId, 'a');
});

test('boundary: replayed queue notification cannot evict itself', () => {
  let s = send(send(fixture(), trigger('a')), trigger('b'));
  s = send(s, trigger('b'));
  assert.equal(status(s, 'b'), 'pending');
  assert.equal(finishAudio(s).playing?.stopId, 'b');
});

test('boundary: unknown stop and future timestamp cannot trigger playback', () => {
  let s = send(fixture(), trigger('unknown'));
  assert.equal(s.playing, null);
  s = send(s, { type: 'LocationAccepted', fix: fix({ at: now + 1 }) });
  s = send(s, trigger('a'));
  assert.equal(s.playing, null);
  assert.deepEqual(s.autoFired, []);
});

test('boundary: unknown story and cross-stop story selection are rejected', () => {
  let s = send(fixture(), playStory('a', 'nonexistent'));
  assert.equal(s.playing, null);
  s = send(s, playStory('a', 'b'));
  assert.equal(s.playing, null);
  s = send(s, playStory('a', 'a'));
  assert.equal(s.playing?.storyId, 'a');
});

test('reducer does not mutate input state or event', () => {
  const s = fixture();
  const event = trigger('a');
  const original = structuredClone({ s, event });
  send(s, event);
  assert.deepEqual({ s, event }, original);
});

test('C31: every permutation of stop visits works without following suggested order', () => {
  for (const order of [['a','b','c'], ['a','c','b'], ['b','a','c'],
    ['b','c','a'], ['c','a','b'], ['c','b','a']]) {
    let s = fixture();
    for (const id of order) {
      s = send(s, trigger(id));
      assert.equal(s.playing?.stopId, id);
      s = finishAudio(s);
    }
    assert.deepEqual([...s.heard].sort(), stops);
    assert.equal(s.state, 'Active');
  }
});

test('C32: ending after one freely selected stop is a normal session end', () => {
  const s = send(finishAudio(send(fixture(), trigger('c'))), { type: 'End' });
  assert.equal(s.state, 'Ended');
  assert.deepEqual(missed(s), ['a', 'b']);
  assert.equal(s.commands.some(c => /fail|incomplete/i.test(c.type)), false);
});

function lockedFixture() {
  return send(start('walk-1', stops, { version: 'v1', accessibleStopIds: ['a', 'c'] }),
    { type: 'LocationAccepted', fix: fix() });
}

test('C33: locked preview is excluded from manual and automatic playback and remaining list', () => {
  let s = lockedFixture();
  assert.equal(status(s, 'b'), 'locked');
  s = send(send(s, trigger('b')), play('b'));
  assert.equal(s.playing, null);
  assert.deepEqual(s.autoFired, []);
  assert.deepEqual(missed(s), ['a', 'c']);
});

test('C34: verified downloaded access unlocks any nearby stop without restarting progress', () => {
  let s = finishAudio(send(lockedFixture(), trigger('c')));
  s = send(s, access({ stopIds: ['b'] }));
  assert.equal(status(s, 'b'), 'pending');
  assert.equal(s.playing, null);
  assert.deepEqual(s.heard, ['c']);
  s = send(s, trigger('b'));
  assert.equal(s.playing?.stopId, 'b');
  assert.equal(s.sessionId, 'walk-1');
});

test('C35: catalog version change cannot unlock or replace active session content', () => {
  let s = lockedFixture();
  s = send(s, access({ version: 'v2', stopIds: ['b'] }));
  assert.equal(s.version, 'v1');
  assert.equal(status(s, 'b'), 'locked');
  assert.deepEqual(s.tierAvailable, ['base']);
});

test('C33: purchase notification alone is not playable access', () => {
  let s = lockedFixture();
  s = send(s, { type: 'PurchaseSucceeded', stopIds: ['b'] });
  s = send(s, play('b'));
  assert.equal(s.playing, null);
  assert.equal(status(s, 'b'), 'locked');
});

test('boundary: access update is atomic and rejects unknown stops and tiers', () => {
  let s = send(lockedFixture(), access({ stopIds: ['b', 'unknown'] }));
  assert.equal(status(s, 'b'), 'locked');
  s = send(lockedFixture(), access({ tiers: ['extended', 'bogus'] }));
  assert.equal(status(s, 'b'), 'locked');
  assert.deepEqual(s.tierAvailable, ['base']);
});

test('G01.03.b: grant for another route is ignored entirely', () => {
  let s = lockedFixture();
  const before = structuredClone(s);
  before.commands = [];
  s = send(s, access({ routeId: 'route-2', stopIds: ['b'] }));
  assert.deepEqual(s, before);
});

test('G01.03.b: grant for another locale is ignored entirely', () => {
  let s = lockedFixture();
  const before = structuredClone(s);
  before.commands = [];
  s = send(s, access({ locale: 'en', stopIds: ['b'] }));
  assert.deepEqual(s, before);
});

test('G01.03.b: grant from a non-download issuer is ignored entirely', () => {
  let s = lockedFixture();
  for (const issuer of ['purchase-flow', undefined]) {
    const before = structuredClone(s);
    before.commands = [];
    s = send(s, access({ issuer, stopIds: ['b'] }));
    assert.deepEqual(s, before, `issuer=${String(issuer)}`);
  }
});

test('G01.03.b: repeated identical AccessReady is a no-op', () => {
  const event = access({ stopIds: ['b'], tiers: ['extended'] });
  let s = lockedFixture();
  s = send(s, event);
  const once = structuredClone(s);
  s = send(s, event);
  assert.deepEqual(s, once);
  assert.deepEqual(s.commands, []);
  assert.equal(status(s, 'b'), 'pending');
});

test('G01.03.b: late grant after End mutates nothing; a session pinning that version still receives it', () => {
  let ended = send(fixture(), { type: 'End' });
  const before = structuredClone(ended);
  before.commands = [];
  ended = send(ended, access({ stopIds: ['b'] }));
  assert.deepEqual(ended, before);
  let fresh = start('walk-2', stops, { version: 'v1' });
  fresh = send(fresh, access({ stopIds: ['b'] }));
  assert.equal(status(fresh, 'b'), 'pending');
  assert.equal(fresh.version, 'v1');
});

test('G01.03.b: version stays pinned across pause, resume and a foreign-version grant', () => {
  let s = lockedFixture();
  s = send(s, { type: 'Pause' });
  s = send(s, access({ version: 'v2', stopIds: ['b'] }));
  s = send(s, { type: 'Resume' });
  assert.equal(s.version, 'v1');
  assert.deepEqual(s.tierAvailable, ['base']);
  assert.equal(status(s, 'b'), 'locked');
});

test('G01.03.b: playSeq is a write-through counter; an old playSeq cannot credit a newer play', () => {
  let s = fixture();
  s = send(s, play('a'));
  const firstPlaySeq = s.playSeq;
  assert.equal(s.playing.playId, firstPlaySeq);
  s = send(s, play('b'));
  assert.equal(s.playSeq, firstPlaySeq + 1);
  s = send(s, { type: 'AudioFinished', sessionId: s.sessionId, playId: firstPlaySeq });
  assert.deepEqual(s.heard, []);
  assert.equal(s.playing?.stopId, 'b');
});

test('G01.03.b: start refuses a package claiming no verified layer or an unknown layer', () => {
  assert.throws(() => start('walk-9', stops, { tierAvailable: [] }), RangeError);
  assert.throws(() => start('walk-9', stops, { tierAvailable: ['premium'] }), RangeError);
});

test('G01.03.b: start refuses accessibleStopIds naming stops outside the pinned package', () => {
  assert.throws(() => start('walk-9', stops, { accessibleStopIds: ['a', 'ghost'] }), RangeError);
});

test('bounded exploration: invariants across all 4-event sequences (9 choices per step)', () => {
  let transitions = 0;
  function explore(s, depth) {
    if (!depth) return;
    const events = [trigger('a'), trigger('b'), play('a'),
      playStory('a', 'a'),
      { type: 'AudioFinished', sessionId: s.sessionId, playId: s.playing?.playId ?? -1 },
      { type: 'FocusLoss' }, { type: 'Pause' }, { type: 'Resume' }, { type: 'End' }];
    for (const event of events) {
      const snapshot = structuredClone(s);
      const next = send(s, event);
      const context = JSON.stringify({ state: s, event });
      assert.deepEqual(s, snapshot, context);
      assert.ok(s.heard.every(id => next.heard.includes(id)), context);
      assert.ok(s.autoFired.every(id => next.autoFired.includes(id)), context);
      assert.equal(new Set(next.autoFired).size, next.autoFired.length, context);
      assert.equal(new Set(next.heard).size, next.heard.length, context);
      assert.ok(!next.playing || (next.state === 'Active' && !next.suspended), context);
      if (s.state === 'Ended') assert.equal(next.state, 'Ended', context);
      assert.ok(next.commands.filter(c => c.type === 'PlayStory').length <= 1, context);
      transitions++;
      explore(next, depth - 1);
    }
  }
  explore(fixture(), 4);
  assert.equal(transitions, 7380);
});
