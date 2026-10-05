# G22.07 — лінейны пералік карты

*2026-10-05T17:56:51Z by Showboat 0.6.1*
<!-- showboat-id: 515bc40e-8844-421c-9780-266a90d07750 -->

G22.07 (issue #612): праекцыя карты больш не скануе ўсе пункты на кожны маркер. Індэкс геаметрыі (fit па stopId) і выведзеная табліца статусаў (stopStatusTable у state.ts — тая ж кананічная лесвіца ADR G01.01 §4.5) будуюцца адзін раз на праекцыю; рухавік застаецца крыніцай статуса — табліца толькі чытаецца і не жыве даўжэй за выклік. Дэма мерае чытанні ўваходных масіваў праз Proxy вакол сапраўднага runMapView на 10/30/100/200 пунктах (1 000 — не прадуктовы маршрут):

```python
import os
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", newline="\n")

root = pathlib.Path.cwd()
env = dict(os.environ)
env["LD_LIBRARY_PATH"] = str(pathlib.Path.home() / ".local" / "lib")

script = root / ".g2207-demo-run-map-scaling.ts"
script.write_text("""\
import { runMapView } from './controllers/run/runMap.ts';
import type { RunSessionState } from './core/engine/state.ts';

const session = (n: number): RunSessionState => ({
  phase: 'Active',
  sessionId: 'session-1',
  routeId: 'route-map',
  version: '1',
  locale: 'be',
  tier: ['base'],
  stops: Array.from({ length: n }, (_, i) => ({ stopId: `stop-${i}`, storyBaseId: `story-${i}` })),
  accessibleStopIds: Array.from({ length: n }, (_, i) => `stop-${i}`),
  tierAvailable: ['base'],
  heard: [],
  autoFired: [],
  playing: null,
  queued: null,
  autoplaySuspended: false,
  lastFix: null,
  focusLostAt: null,
  playSeq: 0,
});

const idsOf = (state: RunSessionState): string[] => state.stops.map((stop) => stop.stopId);

const geometry = (ids: string[]) =>
  ids.map((stopId, i) => ({ stopId, lat: 54.35 + i * 0.0005, lng: 18.64 + i * 0.0005, radius: 30 }));

const facts = (ids: string[]) =>
  ids.map((stopId) => ({ stopId, placeId: `place-${stopId}`, name: { be: 'Пункт' } }));

const pois = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    placeId: `poi-${i}`,
    lat: 54.36 + i * 0.0005,
    lng: 18.65 + i * 0.0005,
    radius: 10,
    kind: 'cafe',
  }));

let reads = 0;
const counted = <T>(values: T[]): T[] =>
  new Proxy(values, {
    get: (target, prop, receiver) => {
      if (typeof prop === 'string' && /^\\d+$/.test(prop)) reads += 1;
      return Reflect.get(target, prop, receiver);
    },
  });

const counts: number[] = [];
for (const size of [10, 30, 100, 200]) {
  reads = 0;
  const state = session(size);
  const view = runMapView(
    {
      ...state,
      stops: counted(state.stops),
      accessibleStopIds: counted(state.accessibleStopIds),
      heard: counted(state.heard),
      autoFired: counted(state.autoFired),
    },
    counted(geometry(idsOf(state))),
    counted(facts(idsOf(state))),
    counted(pois(2)),
    ['be'],
  );
  counts.push(reads);
  console.log(`stops=${size} input_reads=${reads} markers=${view.markers.length}`);
}
const growth = counts[counts.length - 1] / counts[0];
console.log(`reads grew ${growth.toFixed(1)}x for 20x stops (quadratic would be 400x)`);
""", encoding="utf-8")

run = subprocess.run(
    ["node", "--experimental-strip-types", script.name],
    cwd=root,
    env=env,
    capture_output=True,
    text=True,
)
script.unlink()
assert run.returncode == 0, (run.stdout + run.stderr)[-2000:]
sys.stdout.write(run.stdout)
```

```output
stops=10 input_reads=82 markers=10
stops=30 input_reads=242 markers=30
stops=100 input_reads=802 markers=100
stops=200 input_reads=1602 markers=200
reads grew 19.5x for 20x stops (quadratic would be 400x)
```
