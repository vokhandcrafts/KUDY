# G20.03 — пераход прагулкі публікуецца толькі пасля трывалага запісу

*Showboat demo for issue #474 (`controllers/run/runOrchestrator.ts`, `controllers/useRunController.ts`), created 2026-10-02.*

Блокі дэтэрмінаваныя. Першы блок — галоўны доказ A26-03 на рэальным стэку
(рэальны `node:sqlite`, рэальныя транзакцыі `services/db`; збой уведзены на
мяжы драйвера: уключаны збой робіць кожны `COMMIT` памылковым, таму адмова
ідзе праз рэальны ролбэк). Да выпраўлення аўдыт бачыў
`afterFault {memory: Paused, disk: active}` і паўтор, які больш не пісаў;
пасля выпраўлення памяць трыма апошні трывалы стан, а паўтор перапісвае радок:

```sh
node --input-type=module -e "
import assert from 'node:assert/strict';
import { createRunController } from './controllers/useRunController.ts';
import { defaultEngineConfig } from './core/engine/reducer.ts';
import { LocationService } from './services/location/service.ts';
import { FakeLocationOsPort } from './services/location/fake-port.ts';
import { AudioService } from './services/audio/service.ts';
import { FakeAudioPlayerPort } from './services/audio/fake-port.ts';
import { nodeSqliteDriver } from './services/db/test-fixture.ts';
import { openDatabase, getLiveSession } from './services/db/db.ts';
import { createAccessPort } from './services/download/access.ts';
import { sessionStoreOver } from './test/session-store.ts';

const base = nodeSqliteDriver();
openDatabase(base);
let faulted = false;
const driver = {
  execSql: (sql) => {
    if (faulted && sql.trim() === 'COMMIT') throw new Error('audit disk write failed');
    base.execSql(sql);
  },
  prepare: (sql) => base.prepare(sql),
};
const controller = createRunController({
  location: new LocationService({ port: new FakeLocationOsPort(), clock: { now: () => 1000, schedule: () => () => {} }, permissions: { foreground: 'fg', background: 'bg' } }),
  audio: new AudioService({ createPort: () => new FakeAudioPlayerPort() }),
  clock: { now: () => 1000 },
  engineConfig: defaultEngineConfig,
  pipelineConfig: { dwellMs: 0 },
  route: { routeId: 'audit', version: '1', locale: 'be', tier: ['base'] },
  stops: [{ stopId: 's1', lat: 0, lng: 0, radius: 20, storyBaseId: 'story' }],
  sessionStore: sessionStoreOver(driver),
  readiness: { evaluate: async () => ({ status: 'ready', tierAvailable: ['base'] }) },
  packageStops: { stopsOfLayer: async () => ['s1'] },
  access: createAccessPort(),
  newSessionId: () => 'audit-session',
  wakelock: { acquire() {}, release() {} },
  recovery: { read: async () => null },
});
await controller.getState().start();
faulted = true;
assert.throws(() => controller.getState().pauseSession(), /audit disk write failed/);
const afterFault = { memory: controller.getState().run.phase, disk: getLiveSession(driver).state };
faulted = false;
controller.getState().pauseSession();
const afterRetry = { memory: controller.getState().run.phase, disk: getLiveSession(driver).state };
console.log('DURABILITY ' + JSON.stringify({ afterFault, afterRetry }));
assert.deepEqual(afterFault, { memory: 'Active', disk: 'active' });
assert.deepEqual(afterRetry, { memory: 'Paused', disk: 'paused' });
console.log('A26-03 fixed: the retry rewrites the row');
" 2>/dev/null
```

```output
DURABILITY {"afterFault":{"memory":"Active","disk":"active"},"afterRetry":{"memory":"Paused","disk":"paused"}}
A26-03 fixed: the retry rewrites the row
```

Другі блок — прыёмачныя сцэнары задачы (шэсць новых тэстаў G20.03 у
кантролернай суіце; без змены орхэстратара і контролера ўсе шэсць чырвоныя —
реверц-эксперымент у выніках):

```sh
node --test controllers/useRunController.test.ts 2>/dev/null | grep -E '^ℹ (tests|pass|fail)'
```

```output
ℹ tests 38
ℹ pass 38
ℹ fail 0
```
