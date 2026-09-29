# G07.03 — Moments пры актыўным Run: сесія жывая, шлях тэйзера сапраўдны

*Showboat demo для issue #283 (`controllers/createServices`, `controllers/run/runOrchestrator.ts`, `controllers/moment/momentPlayController.ts`), створана 2026-09-29.*

<!-- showboat-id: g0703-moments-active-run -->

Кантракт уладальніка гуку падчас жывой прагулкі (ADR G01.02 §3.4–§3.8, `11` C38–C45) на жывым кодзе: яўны Play Moment з карткі месца ідзе праз карнявы рэзалвер жывой сесіі ў `createServices` — адзіны жывы сурфэйс з кэшу G06.04 — у рухавік сесіі. Адзін гук: гід спынены камандай (не finished, не `heard`), тэйзер грае з **сапраўдным** store-relative шляхам (path-carry кантролера, болей не пусты `play 2:`), `autoplay_suspended = true`, наборы сесіі на месцы. Паўторны ўход у Run праз «Прагулка» вяртае той самы кэшаваны сурфэйс і аўдыёстан паводле кантракту — без аўта-Start і аўта-resume.

Сцэнарый гоніць вытворчы кампазіцыйны корань (`createServices`) з рэальнымі сэрвісамі над фейк-портамі і рэальнай sqlite-базай (`test/session-store.ts`); фізічны здымак порта скрыптаваны — плэер «грае».

Доказ (root): тап тэйзера пасярод Run — адзін пераход, сапраўдны шлях, жывая сесія, той самы сурфэйс пры вяртанні:

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module -e "
import { createServices } from './controllers/createServices.ts';
import { readMomentFacts } from './services/contentRepo/momentFacts.ts';
import { defaultEngineConfig } from './core/engine/reducer.ts';
import { AudioService } from './services/audio/service.ts';
import { FakeAudioPlayerPort } from './services/audio/fake-port.ts';
import { FakeLocationOsPort } from './services/location/fake-port.ts';
import { LocationService } from './services/location/service.ts';
import { createAccessPort } from './services/download/access.ts';
import { sessionStoreOver } from './test/session-store.ts';
import { openDatabase } from './services/db/db.ts';
import { nodeSqliteDriver } from './services/db/test-fixture.ts';
import { memoryBundles } from './test/memory-bundles.ts';

const mode = process.argv.includes('reverted') ? 'reverted' : 'root';
const clock = { now: () => 0, schedule: () => () => {} };
const audioPort = new FakeAudioPlayerPort();
const locationPort = new FakeLocationOsPort();
const driver = nodeSqliteDriver();
openDatabase(driver);
const LAYER = 'bundles/route-map/1/be/base';
const files = {
  [LAYER + '/route.json']: JSON.stringify({
    route_id: 'route-map', version: '1', city_id: 'gdansk', access: 'paid',
    stops: [
      { id: 'stop-1', position: 0, place_id: 'place-1', access_tier: 'base', story_base_id: 'story-1', preview: { name: { be: 'Мытня', en: 'Customs' } } },
      { id: 'stop-2', position: 1, place_id: 'place-2', access_tier: 'base', story_base_id: 'story-2', preview: { name: { be: 'Порт', en: 'Port' } } },
    ],
  }),
  [LAYER + '/places.json']: JSON.stringify([
    { id: 'place-1', content_version: 'cv-1', lat: 54.352, lng: 18.648, trigger_radius_m: 30, kind: 'historic' },
    { id: 'place-2', content_version: 'cv-1', lat: 54.3535, lng: 18.651, trigger_radius_m: 30, kind: 'historic' },
    { id: 'place-9', content_version: 'cv-1', lat: 54.3512, lng: 18.6498, trigger_radius_m: 10, kind: 'cafe' },
  ]),
  [LAYER + '/stops.json']: JSON.stringify([
    { story_id: 'story-m9', place_id: 'place-9', voice_id: 'voice-1', tier: 'base', duration_s: 30, text: 'Тэйзер порта', sources: ['с'] },
  ]),
  'bundles/route-map/1/moments.json': JSON.stringify([
    { id: 'moment-9', place_id: 'place-9', story_id: 'story-m9', kind: 'teaser', cooldown_min: 0 },
  ]),
  [LAYER + '/audio/story-m9.m4a']: 'm4a',
};
const audio = new AudioService({ createPort: () => audioPort });
const services = createServices({
  bundlesStore: memoryBundles(files),
  run: {
    session: {
      location: new LocationService({ port: locationPort, clock, permissions: { foreground: 'fg', background: 'bg' } }),
      audio,
      clock,
      engineConfig: defaultEngineConfig,
      pipelineConfig: { dwellMs: 0 },
      sessionStore: sessionStoreOver(driver),
      readiness: { evaluate: async () => ({ status: 'ready', routeId: 'route-map', version: '1', tier: 'base', tierAvailable: ['base'] }) },
      packageStops: { stopsOfLayer: async () => ['stop-1', 'stop-2'] },
      access: createAccessPort(),
      wakelock: { acquire: () => {}, release: () => {} },
      recovery: { read: async () => null },
      newSessionId: () => 'walk-demo',
      grantedTiers: () => ['base'],
    },
  },
  audio,
  now: () => clock.now(),
});
const store = services.run.create('route-map');
let surface;
for (let i = 0; i < 200; i++) {
  surface = store.getState();
  if (surface.status !== 'loading') break;
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const controller = surface.controller;
controller.getState().selectStop('stop-1');
audioPort.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 60000 };
const facts = await readMomentFacts(memoryBundles(files), { locales: ['be', 'en'] });
const teaser = facts.moments[0];

const outcome = services.moment.play({ momentId: teaser.momentId, storyId: teaser.storyId, path: teaser.audioPath });
const run = controller.getState().run;
const commandsAtPlay = audioPort.commands.length;
// The re-entry through «Прагулка»: the same cached surface, no auto-Start.
const again = services.run.create('route-map');
const runAgain = controller.getState().run;
console.log(JSON.stringify({
  outcome,
  port: audioPort.commands,
  violations: audioPort.violations,
  phase: runAgain.phase,
  sessionId: runAgain.sessionId,
  playing: runAgain.playing,
  heard: runAgain.heard,
  autoFired: runAgain.autoFired,
  suspended: runAgain.autoplaySuspended,
  queued: runAgain.queued,
  sameSurface: again === store,
  noAutoCommands: audioPort.commands.length === commandsAtPlay,
}));
" root
```

```output
{"outcome":{"outcome":"routed"},"port":["play 1:be/base/audio/story-1.m4a","stop","play 2:bundles/route-map/1/be/base/audio/story-m9.m4a"],"violations":[],"phase":"Active","sessionId":"walk-demo","playing":{"owner":"moment","momentId":"moment-9","storyId":"story-m9","seq":1,"paused":false},"heard":[],"autoFired":[],"suspended":true,"queued":null,"sameSurface":true,"noAutoCommands":true}
```

Адкат праводкі — той самы тап праз праводку «да G07.03» (кантролер адзінага плэера без порта да жывой сесіі): іменаваная адмова, другога плэера няма, гід працягвае гучаць:

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module -e "
import { createServices } from './controllers/createServices.ts';
import { readMomentFacts } from './services/contentRepo/momentFacts.ts';
import { createMomentPlayController } from './controllers/moment/momentPlayController.ts';
import { defaultEngineConfig } from './core/engine/reducer.ts';
import { AudioService } from './services/audio/service.ts';
import { FakeAudioPlayerPort } from './services/audio/fake-port.ts';
import { FakeLocationOsPort } from './services/location/fake-port.ts';
import { LocationService } from './services/location/service.ts';
import { createAccessPort } from './services/download/access.ts';
import { sessionStoreOver } from './test/session-store.ts';
import { openDatabase } from './services/db/db.ts';
import { nodeSqliteDriver } from './services/db/test-fixture.ts';
import { memoryBundles } from './test/memory-bundles.ts';

const mode = process.argv.includes('reverted') ? 'reverted' : 'root';
const clock = { now: () => 0, schedule: () => () => {} };
const audioPort = new FakeAudioPlayerPort();
const locationPort = new FakeLocationOsPort();
const driver = nodeSqliteDriver();
openDatabase(driver);
const LAYER = 'bundles/route-map/1/be/base';
const files = {
  [LAYER + '/route.json']: JSON.stringify({
    route_id: 'route-map', version: '1', city_id: 'gdansk', access: 'paid',
    stops: [
      { id: 'stop-1', position: 0, place_id: 'place-1', access_tier: 'base', story_base_id: 'story-1', preview: { name: { be: 'Мытня', en: 'Customs' } } },
      { id: 'stop-2', position: 1, place_id: 'place-2', access_tier: 'base', story_base_id: 'story-2', preview: { name: { be: 'Порт', en: 'Port' } } },
    ],
  }),
  [LAYER + '/places.json']: JSON.stringify([
    { id: 'place-1', content_version: 'cv-1', lat: 54.352, lng: 18.648, trigger_radius_m: 30, kind: 'historic' },
    { id: 'place-2', content_version: 'cv-1', lat: 54.3535, lng: 18.651, trigger_radius_m: 30, kind: 'historic' },
    { id: 'place-9', content_version: 'cv-1', lat: 54.3512, lng: 18.6498, trigger_radius_m: 10, kind: 'cafe' },
  ]),
  [LAYER + '/stops.json']: JSON.stringify([
    { story_id: 'story-m9', place_id: 'place-9', voice_id: 'voice-1', tier: 'base', duration_s: 30, text: 'Тэйзер порта', sources: ['с'] },
  ]),
  'bundles/route-map/1/moments.json': JSON.stringify([
    { id: 'moment-9', place_id: 'place-9', story_id: 'story-m9', kind: 'teaser', cooldown_min: 0 },
  ]),
  [LAYER + '/audio/story-m9.m4a']: 'm4a',
};
const audio = new AudioService({ createPort: () => audioPort });
const services = createServices({
  bundlesStore: memoryBundles(files),
  run: {
    session: {
      location: new LocationService({ port: locationPort, clock, permissions: { foreground: 'fg', background: 'bg' } }),
      audio,
      clock,
      engineConfig: defaultEngineConfig,
      pipelineConfig: { dwellMs: 0 },
      sessionStore: sessionStoreOver(driver),
      readiness: { evaluate: async () => ({ status: 'ready', routeId: 'route-map', version: '1', tier: 'base', tierAvailable: ['base'] }) },
      packageStops: { stopsOfLayer: async () => ['stop-1', 'stop-2'] },
      access: createAccessPort(),
      wakelock: { acquire: () => {}, release: () => {} },
      recovery: { read: async () => null },
      newSessionId: () => 'walk-demo',
      grantedTiers: () => ['base'],
    },
  },
  audio,
  now: () => clock.now(),
});
const store = services.run.create('route-map');
let surface;
for (let i = 0; i < 200; i++) {
  surface = store.getState();
  if (surface.status !== 'loading') break;
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const controller = surface.controller;
controller.getState().selectStop('stop-1');
audioPort.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 60000 };
const facts = await readMomentFacts(memoryBundles(files), { locales: ['be', 'en'] });
const teaser = facts.moments[0];

if (mode === 'reverted') {
  // The pre-G07.03 wiring: a moment controller over the same one player
  // with no entry to the live session's engine.
  let seq = 0;
  const idle = createMomentPlayController({ audio, nextSeq: () => ++seq, now: () => clock.now() });
  const outcome = idle.play({ momentId: teaser.momentId, storyId: teaser.storyId, path: teaser.audioPath });
  const run = controller.getState().run;
  console.log(JSON.stringify({
    outcome,
    port: audioPort.commands,
    violations: audioPort.violations,
    playing: run.playing,
    suspended: run.autoplaySuspended,
  }));
}
" reverted
```

```output
{"outcome":{"refused":"moment#session-unroutable"},"port":["play 1:be/base/audio/story-1.m4a"],"violations":[],"playing":{"owner":"guide","stopId":"stop-1","storyId":"story-1","playId":1,"paused":false},"suspended":false}
```
