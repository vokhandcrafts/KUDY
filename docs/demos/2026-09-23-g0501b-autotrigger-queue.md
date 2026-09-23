# G05.01.b — autotrigger, one-cell queue and P01 progress

*2026-09-23T21:57:11Z by Showboat 0.6.1*
<!-- showboat-id: 74147f6e-42bd-4f8c-9ffc-2273b3a0bee0 -->

Issue #198: the reducer slice that makes the city talk — the six §4.8 autotrigger conditions with the three distinct not-played outcomes (11 §5.1.1), the one-cell queue with its inclusive deferred re-check (freshness ≤ 30 000 ms, accuracy ≤ radius, distance ≤ 2 × radius), the (session_id, play_id, story_id?) AudioFinished gate with the write-through play_seq, and the P01 progress rules (base/extended/locked). New in core/engine: dwell/audioFinished handling in reducer.ts, the radius payload on DwellCompleted, the missedStories view («Яшчэ можна адкрыць»).

```python
import subprocess
subprocess.run(['node', '--test', '--experimental-strip-types', '--test-reporter=dot', 'core/engine/autotrigger.test.ts'], check=True)
```

```output
....................
..........
```

```python
import subprocess
js = """
import { step } from './core/engine/reducer.ts';
import { initialRunState, stopStatus } from './core/engine/state.ts';
const cfg = { fixFreshnessMs: 30000, queueDistanceMultiplier: 2, focusRegainWindowMs: 600000 };
const now = 100000;
const stops = [
  { stopId: 'stop-s1', storyBaseId: 'story-s1' },
  { stopId: 'stop-s2', storyBaseId: 'story-s2' },
  { stopId: 'stop-s3', storyBaseId: 'story-s3' },
  { stopId: 'stop-s4', storyBaseId: 'story-s4' },
];
const start = () => ({
  type: 'Start', sessionId: 'session-1', routeId: 'route-1', version: 'v3',
  locale: 'be', tier: ['base'], accessibleStopIds: ['stop-s1', 'stop-s2', 'stop-s3', 'stop-s4'], stops,
});
const fix = (distance) => ({
  type: 'LocationAccepted',
  fix: { lat: 54.35, lng: 18.65, accuracy: 5, at: now, distances: new Map(stops.map((s) => [s.stopId, distance])) },
});
const dwell = (stopId) => ({ type: 'DwellCompleted', stopId, radius: 30 });
const finished = (playId) => ({ type: 'AudioFinished', sessionId: 'session-1', playId });

let r = step(initialRunState, start(), now, cfg);
r = step(r.state, fix(5), now, cfg);
r = step(r.state, { type: 'UserSelectedStop', stopId: 'stop-s1' }, now, cfg);
console.log('manual launch of stop-s1 -> play_seq:', r.state.playSeq, '| auto_fired untouched:', JSON.stringify(r.state.autoFired));
r = step(r.state, dwell('stop-s2'), now, cfg);
console.log('trigger while busy -> queued:', JSON.stringify(r.state.queued));
r = step(r.state, dwell('stop-s3'), now, cfg);
console.log('newest trigger wins -> queued:', JSON.stringify(r.state.queued), '| displaced stop-s2 -> auto_fired:', JSON.stringify(r.state.autoFired));
r = step(r.state, finished(1), now, cfg);
const deferred = r.commands.find((c) => c.type === 'PlayStory');
console.log('after the completion the queued stop plays:', JSON.stringify(deferred));
r = step(r.state, finished(2), now, cfg);
r = step(r.state, { type: 'UserSelectedStop', stopId: 'stop-s1' }, now, cfg);
r = step(r.state, dwell('stop-s4'), now, cfg);
console.log('stop-s4 queued:', JSON.stringify(r.state.queued));
r = step(r.state, fix(61), now, cfg);
r = step(r.state, finished(3), now, cfg);
console.log('61 m past 2 x 30 m -> nothing plays, stop-s4 retires: queued', JSON.stringify(r.state.queued), '| auto_fired:', JSON.stringify(r.state.autoFired));
console.log('statuses: s1', stopStatus(r.state, 'stop-s1'), '| s2', stopStatus(r.state, 'stop-s2'), '| s3', stopStatus(r.state, 'stop-s3'), '| s4', stopStatus(r.state, 'stop-s4'));
"""
subprocess.run(['node', '--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', js], check=True)
```

```output
manual launch of stop-s1 -> play_seq: 1 | auto_fired untouched: []
trigger while busy -> queued: {"stopId":"stop-s2","radius":30,"at":100000}
newest trigger wins -> queued: {"stopId":"stop-s3","radius":30,"at":100000} | displaced stop-s2 -> auto_fired: ["stop-s2"]
after the completion the queued stop plays: {"type":"PlayStory","storyId":"story-s3","path":"be/base/audio/story-s3.m4a","sessionId":"session-1","playId":2}
stop-s4 queued: {"stopId":"stop-s4","radius":30,"at":100000}
61 m past 2 x 30 m -> nothing plays, stop-s4 retires: queued null | auto_fired: ["stop-s2","stop-s3","stop-s4"]
statuses: s1 played | s2 available | s3 played | s4 available
```

```python
import subprocess
js = """
import { step } from './core/engine/reducer.ts';
import { initialRunState, missedStories, stopStatus } from './core/engine/state.ts';
const cfg = { fixFreshnessMs: 30000, queueDistanceMultiplier: 2, focusRegainWindowMs: 600000 };
const now = 100000;
const stops = [
  { stopId: 'stop-crane', storyBaseId: 'story-crane-base', storyExtendedId: 'story-crane-ext' },
  { stopId: 'stop-plain', storyBaseId: 'story-plain-base' },
  { stopId: 'stop-gate', storyExtendedId: 'story-gate-ext' },
];
const start = (sessionId) => ({
  type: 'Start', sessionId, routeId: 'route-1', version: 'v3',
  locale: 'be', tier: ['base'], accessibleStopIds: ['stop-crane', 'stop-plain'], stops,
});
const fix = () => ({
  type: 'LocationAccepted',
  fix: { lat: 54.35, lng: 18.65, accuracy: 5, at: now, distances: new Map(stops.map((s) => [s.stopId, 5])) },
});
const dwell = (stopId) => ({ type: 'DwellCompleted', stopId, radius: 30 });

let r = step(initialRunState, start('session-1'), now, cfg);
r = step(r.state, fix(), now, cfg);
r = step(r.state, { type: 'UserSelectedStop', stopId: 'stop-plain' }, now, cfg);
r = step(r.state, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, now, cfg);
const attempt = step(r.state, dwell('stop-plain'), now, cfg);
console.log('primary heard by hand -> dwell:', JSON.stringify(attempt.commands), '| auto_fired:', JSON.stringify(attempt.state.autoFired));

const lockedDwell = step(r.state, dwell('stop-gate'), now, cfg);
const lockedManual = step(r.state, { type: 'UserSelectedStop', stopId: 'stop-gate' }, now, cfg);
console.log('locked stop: dwell ->', JSON.stringify(lockedDwell.commands), '| manual play ->', JSON.stringify(lockedManual.commands), '| auto_fired:', JSON.stringify(lockedDwell.state.autoFired));
console.log('missed so far:', JSON.stringify(missedStories(r.state)));

r = step(r.state, { type: 'AccessReady', routeId: 'route-1', version: 'v3', locale: 'be', tier: 'extended', stopIds: ['stop-crane'], issuer: 'services/download' }, now, cfg);
console.log('same-version unlock: commands', JSON.stringify(r.commands), '| heard untouched:', JSON.stringify(r.state.heard), '| missed:', JSON.stringify(missedStories(r.state)));
r = step(r.state, dwell('stop-crane'), now, cfg);
const play = r.commands.find((c) => c.type === 'PlayStory');
console.log('dwell after unlock plays the primary base story:', JSON.stringify(play));

let w = step(initialRunState, start('session-2'), now, cfg);
w = step(w.state, fix(), now, cfg);
w = step(w.state, { type: 'UserSelectedStop', stopId: 'stop-plain' }, now, cfg);
const late = step(w.state, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, now, cfg);
console.log('late callback of walk 1: heard', JSON.stringify(late.state.heard), '| launch kept:', late.state.playing ? 'playId ' + late.state.playing.playId : 'none');
const accepted = step(w.state, { type: 'AudioFinished', sessionId: 'session-2', playId: 1 }, now, cfg);
console.log('the pair of walk 2 is accepted: heard', JSON.stringify(accepted.state.heard), '| playing:', accepted.state.playing);
"""
subprocess.run(['node', '--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', js], check=True)
```

```output
primary heard by hand -> dwell: [] | auto_fired: []
locked stop: dwell -> [] | manual play -> [] | auto_fired: []
missed so far: ["story-crane-base"]
same-version unlock: commands [{"type":"SetGeofenceWindow","stopIds":["stop-crane","stop-plain"]}] | heard untouched: ["story-plain-base"] | missed: ["story-crane-base","story-crane-ext"]
dwell after unlock plays the primary base story: {"type":"PlayStory","storyId":"story-crane-base","path":"be/base/audio/story-crane-base.m4a","sessionId":"session-1","playId":2}
late callback of walk 1: heard [] | launch kept: playId 1
the pair of walk 2 is accepted: heard ["story-plain-base"] | playing: null
```
