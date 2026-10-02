# G20.07 — раздзеленыя скопы дазволу GPS у адаптары

*Showboat demo for issue #478 (`services/location/expo/`), created 2026-10-02.*

Усе блокі дэтэрмінаваныя: сапраўдны `ExpoLocationOsPort` і сапраўдны
`LocationService` імпартуюцца цалкам, замена — толькі `expo-location`,
`expo-task-manager` і `expo-constants` праз `mock.module` (Node 26, флаг
`--experimental-test-module-mocks`). Адказы OS выдаюцца рукой у парадку,
які задае гонка, што тэстуецца. Android/iOS дыялогі і фізічная праца ў
фоне — асобны прыёмкавы доказ, ніводны блок тут яго не сцвярджае.
Кожны блок задае `LD_LIBRARY_PATH=$HOME/.local/lib` яўна: node гэтага
хаста патрабуе `libsimdjson.so.33` з `~/.local/lib`, а Showboat запускае
блокі ў ачышчаным асяроддзі (implementation-rules 9).

Першы блок — крытэр 1 на выпраўленым кодзе: foreground дазволены і сесія
жыве на foreground-праглядзе; потым шлях Start пытае background scope і
атрымлівае адмову. Сесія працягвае прымаць фіксы, фізічны background-старт
не выклікаецца ніводзін раз, і сцан прагулкі застаецца `live`. Да
выпраўлення той самы скрыпт друкаваў `after-background-denied fixes: 1`
і `status: permission-denied` — адмова фонавага дазволу дэзармавала
жывую сесію (зліты `permissionState`, expo-location-port.ts:98):

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --experimental-test-module-mocks --experimental-strip-types --input-type=module -e "
const { mock } = await import('node:test');
const asks = { fg: [], bg: [] };
let watchCb = null, watchRemoved = 0, updates = 0;
const deferred = () => { let resolve; const promise = new Promise((res) => { resolve = res; }); return { promise, resolve }; };
let fgAsk = deferred(), bgAsk = deferred();
mock.module('expo-location', { namedExports: {
  Accuracy: { High: 3 },
  getForegroundPermissionsAsync: () => deferred().promise,
  requestForegroundPermissionsAsync: () => { asks.fg.push(1); return fgAsk.promise; },
  requestBackgroundPermissionsAsync: () => { asks.bg.push(1); return bgAsk.promise; },
  watchPositionAsync: (_o, cb) => { watchCb = cb; return Promise.resolve({ remove: () => { watchRemoved++; } }); },
  startLocationUpdatesAsync: () => { updates++; return Promise.resolve(); },
  hasStartedLocationUpdatesAsync: () => Promise.resolve(false),
  stopLocationUpdatesAsync: () => Promise.resolve(),
}});
mock.module('expo-task-manager', { namedExports: { defineTask: () => {} } });
mock.module('expo-constants', { defaultExport: { expoConfig: null } });
const { ExpoLocationOsPort } = await import('./services/location/expo/expo-location-port.ts');
const { LocationService } = await import('./services/location/service.ts');
const port = new ExpoLocationOsPort({ locationExplanations: { foreground: 'f', background: 'b' }, locationForegroundService: { notificationTitle: 't', notificationBody: 'n' } });
const service = new LocationService({ port, clock: { now: () => 1000, schedule: () => () => {} }, permissions: { foreground: 'f', background: 'b' } });
let fixes = 0;
service.onFix(() => { fixes++; });
const tick = () => new Promise((r) => setImmediate(r));
service.setMode('city-surface');
fgAsk.resolve({ status: 'granted' });
await tick(); await tick();
watchCb({ coords: { latitude: 53.9, longitude: 27.56, accuracy: 5 }, timestamp: 1001 });
service.setMode('active-guide');
bgAsk.resolve({ status: 'denied' });
await tick(); await tick();
watchCb({ coords: { latitude: 53.9, longitude: 27.56, accuracy: 5 }, timestamp: 1002 });
console.log('background updates requested: ' + updates + ' | watch removed: ' + watchRemoved);
console.log('after-background-denied fixes: ' + fixes + ' | status: ' + service.status().state);
" 2>/dev/null
```

```output
background updates requested: 0 | watch removed: 0
after-background-denied fixes: 2 | status: live
```

Другі блок — крытэр 3: запытанні foreground (city surface) і background
(Start) ідуць па чарзе, а адказы прыходзяць у адваротным парадку.
Састарэлы адмовы-адказ першага запытання кідаецца цалкам — свежае
рашэнне перамагае. Да выпраўлення адказ-адмова перапісваў бы сцан у
`permission-denied` і спыняў сесію:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --experimental-test-module-mocks --experimental-strip-types --input-type=module -e "
const { mock } = await import('node:test');
const deferred = () => { let resolve; const promise = new Promise((res) => { resolve = res; }); return { promise, resolve }; };
let fgAsk = deferred(), bgAsk = deferred();
let taskExec = null, updates = 0;
mock.module('expo-location', { namedExports: {
  Accuracy: { High: 3 },
  getForegroundPermissionsAsync: () => deferred().promise,
  requestForegroundPermissionsAsync: () => fgAsk.promise,
  requestBackgroundPermissionsAsync: () => bgAsk.promise,
  watchPositionAsync: () => Promise.resolve({ remove: () => {} }),
  startLocationUpdatesAsync: () => { updates++; return Promise.resolve(); },
  hasStartedLocationUpdatesAsync: () => Promise.resolve(false),
  stopLocationUpdatesAsync: () => Promise.resolve(),
}});
mock.module('expo-task-manager', { namedExports: { defineTask: (_n, exec) => { taskExec = exec; } } });
mock.module('expo-constants', { defaultExport: { expoConfig: null } });
const { ExpoLocationOsPort } = await import('./services/location/expo/expo-location-port.ts');
const { LocationService } = await import('./services/location/service.ts');
const port = new ExpoLocationOsPort({ locationExplanations: { foreground: 'f', background: 'b' }, locationForegroundService: { notificationTitle: 't', notificationBody: 'n' } });
const service = new LocationService({ port, clock: { now: () => 1000, schedule: () => () => {} }, permissions: { foreground: 'f', background: 'b' } });
let fixes = 0;
service.onFix(() => { fixes++; });
const tick = () => new Promise((r) => setImmediate(r));
service.setMode('city-surface');
service.setMode('active-guide');
bgAsk.resolve({ status: 'granted' });
await tick(); await tick();
fgAsk.resolve({ status: 'denied' });
await tick(); await tick();
taskExec({ data: { locations: [{ coords: { latitude: 53.9, longitude: 27.56, accuracy: 5 }, timestamp: 1001 }] } });
await tick();
console.log('background task starts: ' + updates + ' | stale reply dropped, permission: ' + port.permission());
console.log('fixes through the task: ' + fixes + ' | status: ' + service.status().state);
" 2>/dev/null
```

```output
background task starts: 1 | stale reply dropped, permission: granted
fixes through the task: 1 | status: live
```
