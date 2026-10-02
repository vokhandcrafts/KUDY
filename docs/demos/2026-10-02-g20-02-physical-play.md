# G20.02 — запуск і вызваленне фізічнага Expo-плэера

*Showboat demo for issue #473 (`services/audio/expo/`), created 2026-10-02.*

Усе блокі дэтэрмінаваныя: сапраўдны адаптар імпартуецца ўвесь, замена
`expo-audio` — толькі праз `mock.module` (Node 26, флаг
`--experimental-test-module-mocks`; фізічны гук на прыладзе — асобны
доказ, ніводны блок тут яго не сцвярджае). Кожны блок задае
`LD_LIBRARY_PATH=$HOME/.local/lib` яўна: node гэтага хаста (v26.10.0)
патрабуе `libsimdjson.so.33` з `~/.local/lib`, а Showboat запускае блокі
ў ачышчаным асяроддзі — прэфікс трымае блок самадастатковым
(implementation-rules 9).

Першы блок — рэпрадакшн A26-02 на выпраўленым кодзе: `play()` стварае
плэер, падпісваецца на статусы і запускае яго адзін раз. Да выпраўлення
гэты ж скрыпт друкаваў `physical play calls: 0` (выклікаў
`create,listen` без запуску):

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --experimental-test-module-mocks --experimental-strip-types --input-type=module -e "
const { mock } = await import('node:test');
let playCalls = 0, listened = 0;
mock.module('expo-audio', { namedExports: {
  createAudioPlayer: () => ({ addListener: () => { listened++; }, play: () => { playCalls++; }, remove: () => {} }),
  setAudioModeAsync: async () => {},
}});
const { createExpoAudioPlayerPort } = await import('./services/audio/expo/expo-audio-port.ts');
const port = createExpoAudioPlayerPort();
port.play({ key: 1, path: 'guide-1.m4a' });
console.log('listener attached: ' + listened + ' | physical play calls: ' + playCalls);
" 2>/dev/null
```

```output
listener attached: 1 | physical play calls: 1
```

Другі блок — шлях памылкі стварэння (AC3): кінутая `createAudioPlayer`
даходзіць да існай падзеі `failed` з ключом крыніцы (адзін узровень вышэй
гэта `story_play_failed`), порт застаецца пустым і сапраўдным — `pause`,
`stop` і `snapshot` працуюць без кідання:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --experimental-test-module-mocks --experimental-strip-types --input-type=module -e "
const { mock } = await import('node:test');
mock.module('expo-audio', { namedExports: {
  createAudioPlayer: () => { throw new Error('decoder missing'); },
  setAudioModeAsync: async () => {},
}});
const { createExpoAudioPlayerPort } = await import('./services/audio/expo/expo-audio-port.ts');
const port = createExpoAudioPlayerPort();
port.onSourceEvent((e) => console.log(JSON.stringify(e)));
port.play({ key: 3, path: 'c.m4a' });
port.pause();
console.log('snapshot: ' + JSON.stringify(port.snapshot()));
" 2>/dev/null
```

```output
{"type":"failed","key":3,"reason":"player creation failed: decoder missing"}
snapshot: {"state":"idle","positionMs":0,"durationMs":0}
```

Трэці блок — зводка паводзінавага сьюту адаптара: запуск, замена з
вызваленнем і guard-ам састарэлых падзей, дзве праўкі памылак; сьют
ўпадае пры адкате `created.play()` або stale-owner guard-а:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --test --experimental-strip-types --experimental-test-module-mocks --test-reporter=spec services/audio/expo/expo-audio-port.test.ts 2>/dev/null | grep -E '^ℹ (tests|suites|pass|fail) [0-9]+$'
```

```output
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
```
