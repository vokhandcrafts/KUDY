# G20.04 — валоданне падпіскамі: адхіленая другая прагулка не забірае GPS першай

*Showboat demo for issue #475 (`controllers/run/runOrchestrator.ts`, `controllers/run/runSurfaceController.ts`), created 2026-10-02.*

Сцэнарый аўдыяту A26-04 праз сапраўдны composition root і surface controller:
першая прагулка адкрытая і прымае пазіцыі; другая паверхня (іншы маршрут)
адхіляецца крамай сесій (`live-session-exists`); новая пазіцыя пасля адмовы
ўсё роўна даходзіць да першай — яна засталася ўладальнікам адзінага GPS sink.
Гадзіннік ручны, база і пакеты ў памяці — блок дэтэрмінаваны (дзве прагоны
даюць байт-у-байт аднолькавы вывад).

```sh
node --input-type=module -e "
import { openDatabase } from './services/db/db.ts';
import { nodeSqliteDriver } from './services/db/test-fixture.ts';
import { sessionStoreOver } from './test/session-store.ts';
import { memoryBundles } from './test/memory-bundles.ts';
import { createServices } from './controllers/createServices.ts';
import { LocationService } from './services/location/service.ts';
import { FakeLocationOsPort } from './services/location/fake-port.ts';
import { AudioService } from './services/audio/service.ts';
import { FakeAudioPlayerPort } from './services/audio/fake-port.ts';
import { createAccessPort } from './services/download/access.ts';
import { defaultEngineConfig } from './core/engine/reducer.ts';

let ms = 0;
const clock = { now: () => ms, set: (v) => (ms = v), schedule: () => () => {} };
const locationPort = new FakeLocationOsPort();
const audioPort = new FakeAudioPlayerPort();
const driver = nodeSqliteDriver();
openDatabase(driver);

const routeJson = (routeId) =>
  JSON.stringify({
    route_id: routeId,
    version: '1',
    city_id: 'demo',
    access: 'paid',
    stops: [{ id: 'stop-1', position: 0, place_id: 'p1', access_tier: 'base', story_base_id: 's1' }],
  });
const placesJson = JSON.stringify([
  { id: 'p1', content_version: 'cv', lat: 54.352, lng: 18.648, trigger_radius_m: 30, kind: 'historic' },
]);
const files = {
  'bundles/route-demo/1/be/base/route.json': routeJson('route-demo'),
  'bundles/route-demo/1/be/base/places.json': placesJson,
  'bundles/route-other/1/be/base/route.json': routeJson('route-other'),
  'bundles/route-other/1/be/base/places.json': placesJson,
};

const session = {
  location: new LocationService({ port: locationPort, clock, permissions: { foreground: 'fg', background: 'bg' } }),
  audio: new AudioService({ createPort: () => audioPort }),
  clock,
  engineConfig: defaultEngineConfig,
  pipelineConfig: { dwellMs: 0 },
  sessionStore: sessionStoreOver(driver),
  readiness: { evaluate: async () => ({ status: 'ready', routeId: 'route-demo', version: '1', tier: 'base', tierAvailable: ['base'] }) },
  packageStops: { stopsOfLayer: async () => ['stop-1'] },
  access: createAccessPort(),
  wakelock: { acquire() {}, release() {} },
  recovery: { read: async () => null },
  newSessionId: () => 'demo-walk',
  grantedTiers: () => ['base'],
};
const services = createServices({ bundlesStore: memoryBundles(files), run: { session }, audio: session.audio, now: () => clock.now() });

const settled = (store) =>
  new Promise((resolve) => {
    const poll = () => (store.getState().status === 'loading' ? setTimeout(poll, 2) : resolve(store.getState()));
    poll();
  });
const deliver = () => {
  const starts = locationPort.commands.filter((c) => c.startsWith('start '));
  const sub = Number(starts[starts.length - 1].slice(6));
  for (const offset of [0, 1000, 2000]) {
    clock.set(ms + 1000);
    locationPort.emitFix(sub, { lat: 54.352, lng: 18.648, accuracy: 5, at: clock.now() });
  }
};

const first = await settled(services.run.create('route-demo'));
deliver();
const before = first.controller.getState().run.lastFix.at;

const second = await settled(services.run.create('route-other'));
deliver();
const after = first.controller.getState().run.lastFix.at;

console.log(
  JSON.stringify({
    firstWalkPhase: first.controller.getState().run.phase,
    lastFixAtBeforeRefusal: before,
    secondSurfaceRefusal: second.status === 'unavailable' ? second.reason : second.status,
    lastFixAtAfterRefusal: after,
    firstWalkStillOwner: after > before,
  }),
);
" 2>/dev/null
```

```output
{"firstWalkPhase":"Active","lastFixAtBeforeRefusal":3000,"secondSurfaceRefusal":"live-session-exists","lastFixAtAfterRefusal":6000,"firstWalkStillOwner":true}
```

Пры рэверце фікса (падпіска вяртаецца ў канструктар `RunOrchestrator`) кандыдат
забірае sink на сваім уваходзе і `firstWalkStillOwner` робіцца `false` —
паводзінныя тэсты `G20.04 refused_second_run_keeps_fixes` падаюць таксама.
