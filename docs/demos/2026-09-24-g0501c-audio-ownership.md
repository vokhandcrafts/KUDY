# G05.01.c — audio ownership in the reducer

*2026-09-23T23:24:26Z by Showboat 0.6.1*
<!-- showboat-id: bf269979-02ee-46b6-bcd1-a7fd21e79303 -->

Issue #199: the G01.02 owner rules as reducer transitions — guide/moment variants of playing with the live-pause flag, every launch carrying the {kind, ref, seq} token (the guide token IS the (session_id, play_id) pair, moment tokens are minted by the controller and echoed), tagged callbacks rejected entirely on a token mismatch, the explicit Play Moment that stops the guide by command and retires the queue, the single 10-minute focus threshold over focus_lost_at, and session Pause/End stopping only guide audio while a moment outlives the session. Start injects a playing moment (playingNow) and the autotrigger waits for a free player.

```python
import subprocess
subprocess.run(['node', '--test', '--experimental-strip-types', '--test-reporter=dot', 'core/engine/ownership.test.ts'], check=True)
```

```output
....................
.
```

```python
import subprocess
js = """
import { step } from './core/engine/reducer.ts';
import { initialRunState } from './core/engine/state.ts';
const cfg = { fixFreshnessMs: 30000, queueDistanceMultiplier: 2, focusRegainWindowMs: 600000 };
const now = 100000;
const stops = [
  { stopId: 'stop-crane', storyBaseId: 'story-crane-base', storyExtendedId: 'story-crane-ext' },
  { stopId: 'stop-plain', storyBaseId: 'story-plain-base' },
];
const start = () => ({ type: 'Start', sessionId: 'session-1', routeId: 'route-1', version: 'v3',
  locale: 'be', tier: ['base'], accessibleStopIds: ['stop-crane', 'stop-plain'], stops });
const fix = () => ({ type: 'LocationAccepted',
  fix: { lat: 54.35, lng: 18.65, accuracy: 5, at: now, distances: new Map(stops.map((s) => [s.stopId, 5])) } });
const dwell = (stopId) => ({ type: 'DwellCompleted', stopId, radius: 30 });
const playMoment = (seq) => ({ type: 'PlayMoment', momentId: 'moment-9', storyId: 'story-m9',
  token: { kind: 'moment', ref: 'moment-9', seq } });
const finishMoment = (seq) => ({ type: 'MomentFinished', momentId: 'moment-9', storyId: 'story-m9',
  token: { kind: 'moment', ref: 'moment-9', seq } });

let r = step(initialRunState, start(), now, cfg);
r = step(r.state, fix(), now, cfg);
r = step(r.state, { type: 'UserSelectedStop', stopId: 'stop-plain' }, now, cfg);
r = step(r.state, dwell('stop-crane'), now, cfg);
console.log('guide playing with a queued trigger -> Play Moment:');
r = step(r.state, playMoment(7), now, cfg);
console.log('  commands:', JSON.stringify(r.commands.map((c) => c.type + ' token=' + c.token.kind + '/' + c.token.seq)));
console.log('  heard:', JSON.stringify(r.state.heard), '| queue retired -> auto_fired:', JSON.stringify(r.state.autoFired), '| suspended:', r.state.autoplaySuspended);
r = step(r.state, finishMoment(7), now, cfg);
console.log('moment finished -> playing:', r.state.playing, '| heard:', JSON.stringify(r.state.heard), '| suspended:', r.state.autoplaySuspended);
r = step(r.state, { type: 'GuideResume' }, now, cfg);
console.log('GuideResume -> suspended:', r.state.autoplaySuspended, '| commands:', JSON.stringify(r.commands));
r = step(r.state, dwell('stop-plain'), now, cfg);
const play = r.commands.find((c) => c.type === 'PlayStory');
console.log('a fresh trigger plays by the general conditions:', JSON.stringify(play));
console.log('the retired stop stays retired: dwell stop-crane ->', JSON.stringify(step(r.state, dwell('stop-crane'), now, cfg).commands));
"""
subprocess.run(['node', '--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', js], check=True)
```

```output
guide playing with a queued trigger -> Play Moment:
  commands: ["StopAudio token=guide/1","PlayMoment token=moment/7"]
  heard: [] | queue retired -> auto_fired: ["stop-crane"] | suspended: true
moment finished -> playing: null | heard: [] | suspended: true
GuideResume -> suspended: false | commands: []
a fresh trigger plays by the general conditions: {"type":"PlayStory","storyId":"story-plain-base","path":"be/base/audio/story-plain-base.m4a","sessionId":"session-1","playId":2,"token":{"kind":"guide","ref":"session-1","seq":2}}
the retired stop stays retired: dwell stop-crane -> []
```

```python
import subprocess
js = """
import { step } from './core/engine/reducer.ts';
import { initialRunState } from './core/engine/state.ts';
const cfg = { fixFreshnessMs: 30000, queueDistanceMultiplier: 2, focusRegainWindowMs: 600000 };
const now = 100000;
const stops = [{ stopId: 'stop-plain', storyBaseId: 'story-plain-base' }];
const start = (sessionId, playingNow) => ({ type: 'Start', sessionId, routeId: 'route-1', version: 'v3',
  locale: 'be', tier: ['base'], accessibleStopIds: ['stop-plain'], stops,
  ...(playingNow ? { playingNow } : {}) });
const resume = (token) => ({ type: 'ResumeAudio', token });
const guideToken = (playId) => ({ kind: 'guide', ref: 'session-1', seq: playId });
const playMoment = (seq) => ({ type: 'PlayMoment', momentId: 'moment-9', storyId: 'story-m9',
  token: { kind: 'moment', ref: 'moment-9', seq } });
const finishMoment = (seq) => ({ type: 'MomentFinished', momentId: 'moment-9', storyId: 'story-m9',
  token: { kind: 'moment', ref: 'moment-9', seq } });

let r = step(initialRunState, start('session-1'), now, cfg);
r = step(r.state, { type: 'UserSelectedStop', stopId: 'stop-plain' }, now, cfg);
r = step(r.state, { type: 'FocusLoss' }, now, cfg);
console.log('FocusLoss -> live pause: paused', r.state.playing.paused, '| suspended:', r.state.autoplaySuspended);
r = step(r.state, { type: 'FocusRegain' }, now + 540000, cfg);
console.log('FocusRegain after 9 min -> launch kept:', r.state.playing !== null);
r = step(r.state, resume(guideToken(1)), now + 540001, cfg);
console.log('tap Resume -> same token continues:', JSON.stringify(r.commands), '| paused:', r.state.playing.paused);

r = step(r.state, { type: 'FocusLoss' }, now + 540002, cfg);
r = step(r.state, { type: 'FocusRegain' }, now + 540002 + 600001, cfg);
console.log('FocusRegain past the 10-min threshold -> launch closed:', r.state.playing === null);
r = step(r.state, resume(guideToken(1)), now + 1140004, cfg);
console.log('resume of the closed token -> commands:', JSON.stringify(r.commands));

r = step(r.state, playMoment(3), now + 1140005, cfg);
r = step(r.state, { type: 'End' }, now + 1140006, cfg);
console.log('End during a moment -> phase:', r.state.phase, '| moment keeps playing:', r.state.playing !== null);
r = step(r.state, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, now + 1140007, cfg);
console.log('late guide callback -> commands:', JSON.stringify(r.commands));
r = step(r.state, finishMoment(3), now + 1140008, cfg);
console.log('moment finished after End -> player freed:', r.state.playing === null, '| phase:', r.state.phase);

let w = step(initialRunState, start('session-2', { momentId: 'moment-9', storyId: 'story-m9', seq: 4 }), now + 1140009, cfg);
console.log('Start with playingNow -> owner:', w.state.playing.owner, '| play_seq:', w.state.playSeq);
"""
subprocess.run(['node', '--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', js], check=True)
```

```output
FocusLoss -> live pause: paused true | suspended: true
FocusRegain after 9 min -> launch kept: true
tap Resume -> same token continues: [{"type":"ResumeAudio","token":{"kind":"guide","ref":"session-1","seq":1}}] | paused: false
FocusRegain past the 10-min threshold -> launch closed: true
resume of the closed token -> commands: []
End during a moment -> phase: Ended | moment keeps playing: true
late guide callback -> commands: []
moment finished after End -> player freed: true | phase: Ended
Start with playingNow -> owner: moment | play_seq: 0
```
