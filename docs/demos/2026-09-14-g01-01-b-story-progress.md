# G01.01.b — story-level progress (ADR variant A)

*2026-09-13T23:36:49Z by Showboat 0.6.1*
<!-- showboat-id: 37caaba1-f76c-468f-b962-54894e406467 -->

Accepted ADR variant A: heard is keyed by story_id, the primary story of a stop is derived (base, else paid-only extended) and never rewritten by an unlock. The demo runs the full model suite, the mutation gate, and the ADR §5 base-to-extended scenario.

```python
import subprocess
subprocess.run(['node', '--test', '--test-reporter=dot', 'docs/run-model/run-model.test.mjs'], check=True)

```

```output
....................
....................
.
```

```python
import subprocess
subprocess.run(['node', 'docs/run-model/check-regressions.mjs'], check=True)

```

```output
CAUGHT: consume queued stop before playback
CAUGHT: erase heard during replay
CAUGHT: autoplay manually completed stop
CAUGHT: credit extended together with base
CAUGHT: swap primary to extended after unlock
CAUGHT: accept completion from another session
CAUGHT: accept completion from earlier playback
CAUGHT: accept completion naming another story
CAUGHT: accept stale queued location
CAUGHT: play locked stop manually
CAUGHT: autoplay locked stop
CAUGHT: activate a different content version
12/12 reviewed regressions rejected. Repository model unchanged.
```

```python
import subprocess
js = """
import { start, step, status, missed } from './docs/run-model/run-model.mjs';
const now = 100_000;
const fix = { at: now, accuracy: 5, distances: { 'stop-crane': 0 } };
let s = start('session-1', [
  { id: 'stop-crane', storyBaseId: 'story-crane-base', storyExtendedId: 'story-crane-ext' },
  { id: 'stop-gate', storyExtendedId: 'story-gate-ext' },
], { version: 'v3', accessibleStopIds: ['stop-crane'], tierAvailable: ['base'] });
s = step(s, { type: 'LocationAccepted', fix }, now);
s = step(s, { type: 'UserSelectedStop', stopId: 'stop-crane' }, now);
console.log('primary playing:', s.playing.storyId);
s = step(s, { type: 'AudioFinished', sessionId: 'session-1', playId: s.playing.playId }, now);
console.log('heard after base:', s.heard);
s = step(s, { type: 'AccessReady', version: 'v3', tiers: ['extended'] }, now);
console.log('commands after unlock:', JSON.stringify(s.commands));
console.log('heard after unlock:', s.heard);
console.log('marker:', status(s, 'stop-crane'));
console.log('open discoveries:', missed(s));
s = step(s, { type: 'UserSelectedStory', stopId: 'stop-crane', storyId: 'story-crane-ext' }, now);
console.log('manual additional play:', s.playing.storyId);
"""
subprocess.run(['node', '--input-type=module', '-e', js], check=True)

```

```output
primary playing: story-crane-base
heard after base: [ 'story-crane-base' ]
commands after unlock: []
heard after unlock: [ 'story-crane-base' ]
marker: played
open discoveries: [ 'story-crane-ext' ]
manual additional play: story-crane-ext
```
