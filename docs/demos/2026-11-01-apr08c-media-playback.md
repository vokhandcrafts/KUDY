# APR-08.c — Android media playback activation

*2026-11-01T03:29:10Z by Showboat 0.6.1*
<!-- showboat-id: 6200d7b0-74e9-45df-9f5a-0615f3c018d1 -->

Чатыры тэсты зафіксаваныя да рэалізацыі: яны правяраюць актывацыю lock-screen controls пры Play, захаванне сесіі пры Pause/Resume і вызваленне пры Stop, замене, dispose, канцы трэка ды памылцы. Дэма паказвае кантракт адаптара; Android FGS і апавяшчэнне патрабуюць асобнага натыўнага доказу.

```bash
set -o pipefail; node --test --experimental-strip-types --experimental-test-module-mocks --test-concurrency=1 --test-reporter=tap services/audio/expo/media-playback-lifecycle.test.ts | awk '/^# tests |^# pass |^# fail |^# skipped |^not ok/'
```

```output
# tests 4
# pass 4
# fail 0
# skipped 0
```

Рэгрэсійны тэст правярае стан менавіта AudioControlsService: невядомы або супярэчлівы foreground-стан і сцяг за межамі 3000 сімвалаў не могуць быць залічаны як Stop.

```bash
set -o pipefail; node --test --test-reporter=tap tools/e2e-android/media-service-state.test.mjs | awk '/^# tests |^# pass |^# fail |^# skipped |^not ok/'
```

```output
# tests 1
# pass 1
# fail 0
# skipped 0
```
