# G05.01.a — engine types and session lifecycle

*2026-09-23T01:11:36Z by Showboat 0.6.1*
<!-- showboat-id: 7c94fc02-7f79-411c-aca6-86aa288e08e8 -->

The first production-reducer slice (issue #197): core/engine/{state,events,commands,reducer}.ts implement the 09 §6.1 session lifecycle — Start refusals, Pause/Resume/End, the six-check AccessReady gate of ADR G01.03 §3.5 — with stop status computed, never stored. Pure step(state, event, now, config): the clock is injected, effects are only commands.

```python
import subprocess
subprocess.run(['node', '--test', '--experimental-strip-types', '--test-reporter=dot', 'core/engine/reducer.test.ts', 'core/engine/state.test.ts'], check=True)
```

```output
....................
.........
```

```python
import subprocess
js = """
import { step } from './core/engine/reducer.ts';
import { initialRunState, stopStatus } from './core/engine/state.ts';
const cfg = { fixFreshnessMs: 30000, queueDistanceMultiplier: 2, focusRegainWindowMs: 600000 };
const now = 100000;
const stops = [
  { stopId: 'stop-crane', storyBaseId: 'story-crane-base', storyExtendedId: 'story-crane-ext' },
  { stopId: 'stop-plain', storyBaseId: 'story-plain-base' },
  { stopId: 'stop-gate', storyExtendedId: 'story-gate-ext' },
];
const start = (tier, accessibleStopIds) => ({
  type: 'Start', sessionId: 'session-1', routeId: 'route-1', version: 'v3',
  locale: 'be', tier, accessibleStopIds, stops,
});
let r = step(initialRunState, start(['base'], ['stop-crane', 'stop-plain']), now, cfg);
console.log('after Start:', r.state.phase, '| tierAvailable:', JSON.stringify(r.state.tierAvailable));
r = step(r.state, { type: 'Pause' }, now, cfg);
console.log('after Pause:', r.state.phase, '| commands:', JSON.stringify(r.commands));
r = step(r.state, { type: 'Resume' }, now, cfg);
console.log('after Resume:', r.state.phase, '| suspended:', r.state.autoplaySuspended);
console.log('status stop-gate before unlock:', stopStatus(r.state, 'stop-gate'));
r = step(r.state, { type: 'AccessReady', routeId: 'route-1', version: 'v3', locale: 'be', tier: 'extended', stopIds: ['stop-gate'], issuer: 'services/download' }, now, cfg);
console.log('after AccessReady: tierAvailable:', JSON.stringify(r.state.tierAvailable), '| commands:', JSON.stringify(r.commands));
console.log('status stop-gate after unlock:', stopStatus(r.state, 'stop-gate'));
r = step(r.state, { type: 'End' }, now, cfg);
const revived = step(r.state, { type: 'Resume' }, now, cfg);
console.log('after End:', r.state.phase, '| Resume on Ended ->', revived.state.phase, JSON.stringify(revived.commands));
"""
subprocess.run(['node', '--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', js], check=True)
```

```output
after Start: Active | tierAvailable: ["base"]
after Pause: Paused | commands: [{"type":"ClearGeofences"}]
after Resume: Active | suspended: false
status stop-gate before unlock: locked
after AccessReady: tierAvailable: ["base","extended"] | commands: [{"type":"SetGeofenceWindow","stopIds":["stop-crane","stop-plain","stop-gate"]}]
status stop-gate after unlock: pending
after End: Ended | Resume on Ended -> Ended []
```

```python
import subprocess
js = """
import { step } from './core/engine/reducer.ts';
import { initialRunState } from './core/engine/state.ts';
const cfg = { fixFreshnessMs: 30000, queueDistanceMultiplier: 2, focusRegainWindowMs: 600000 };
const now = 100000;
const stops = [{ stopId: 'stop-crane', storyBaseId: 'story-crane-base' }];
const start = (overrides = {}) => ({
  type: 'Start', sessionId: 'session-1', routeId: 'route-1', version: 'v3',
  locale: 'be', tier: ['base'], accessibleStopIds: ['stop-crane'], stops,
  ...overrides,
});
try {
  step(initialRunState, start({ tier: [] }), now, cfg);
} catch (e) {
  console.log('Start without a verified tier ->', e.message);
}
try {
  step(initialRunState, start({ accessibleStopIds: ['stop-unknown'] }), now, cfg);
} catch (e) {
  console.log('Start with a foreign stop ->', e.message);
}
const live = step(initialRunState, start(), now, cfg).state;
const wrong = step(live, { type: 'AccessReady', routeId: 'route-1', version: 'v4', locale: 'be', tier: 'extended', stopIds: ['stop-crane'], issuer: 'services/download' }, now, cfg);
console.log('AccessReady v4 on the v3 session -> commands:', JSON.stringify(wrong.commands), '| tierAvailable:', JSON.stringify(wrong.state.tierAvailable));
"""
subprocess.run(['node', '--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', js], check=True)
```

```output
Start without a verified tier -> start requires at least one verified layer: base|extended
Start with a foreign stop -> accessibleStopIds must reference stops of the pinned package
AccessReady v4 on the v3 session -> commands: [] | tierAvailable: ["base"]
```
