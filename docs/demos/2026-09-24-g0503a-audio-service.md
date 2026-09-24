# G05.03.a — the audio service over an injected player port

*2026-09-24T19:20:00Z by Showboat 0.6.1*
<!-- showboat-id: 0503a-audio-service-demo -->

Issue #213: `services/audio` as a plain class over an injected port — one physical player (the second play stops the first by command before the next starts), callbacks tagged with the token of the source that produced them and a late event of a replaced source ignored entirely (the proof scenario: play A's late finish is not credited to play B), focus events passing through verbatim and never becoming finished, playback state computed from the port on read with NaN/negative numbers becoming a failure instead of a value, and a disposed player re-created on the next play — the disposed instance never reset, its events never forwarded.

```python
import subprocess
subprocess.run(['node', '--test', '--experimental-strip-types', '--test-reporter=dot', 'services/audio/service.test.ts'], check=True)
```

```output
.................
```

```python
import subprocess
js = """
import { AudioService } from './services/audio/service.ts';
import { FakeAudioPlayerPort } from './services/audio/fake-port.ts';

const ports = [];
const events = [];
const service = new AudioService({
  createPort: () => {
    const p = new FakeAudioPlayerPort();
    ports.push(p);
    return p;
  },
});
service.onEvent((e) => events.push(e));
const guide = (seq) => ({ kind: 'guide', ref: 'session-1', seq });
const moment = (seq) => ({ kind: 'moment', ref: 'moment-9', seq });

await service.play({ token: guide(1), path: 'stop2-base.m4a' });
await service.play({ token: moment(7), path: 'moment9-teaser.m4a' });
console.log('one player — the second play stops the first by command:');
console.log(' ', JSON.stringify(ports[0].commands));

ports[0].finish(1);
console.log('late finish of play A after B started -> callbacks:', JSON.stringify(events));
events.length = 0;
ports[0].finish(2);
console.log("play B's own finish carries B's token:", JSON.stringify(events));
events.length = 0;

await service.play({ token: guide(2), path: 'stop3-base.m4a' });
ports[0].focusLoss();
ports[0].focusRegain();
ports[0].finish(3);
console.log('a call during a guide play is focus, never finished:');
console.log(' ', JSON.stringify(events));
events.length = 0;

await service.play({ token: guide(3), path: 'stop4-base.m4a' });
ports[0].snapshotValue = { state: 'playing', positionMs: 61000, durationMs: Number.NaN };
console.log('NaN duration from the port ->', JSON.stringify(service.playbackState()));
ports[0].snapshotValue = { state: 'playing', positionMs: 61000, durationMs: 125000 };
console.log('healthy port ->', JSON.stringify(service.playbackState()));

service.dispose();
await service.play({ token: moment(8), path: 'moment10-teaser.m4a' });
console.log('dispose then play re-creates the player (factory calls:', ports.length + ')');
ports[0].finish(4);
console.log('the disposed instance forwards nothing:', JSON.stringify(events));
ports[1].finish(5);
console.log('the new player finishes with its own token:', JSON.stringify(events));
"""
subprocess.run(['node', '--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', js], check=True)
```

```output
one player — the second play stops the first by command:
  ["play 1:stop2-base.m4a","stop","play 2:moment9-teaser.m4a"]
late finish of play A after B started -> callbacks: []
play B's own finish carries B's token: [{"type":"finished","token":{"kind":"moment","ref":"moment-9","seq":7}}]
a call during a guide play is focus, never finished:
  [{"type":"FocusLoss"},{"type":"FocusRegain"},{"type":"finished","token":{"kind":"guide","ref":"session-1","seq":2}}]
NaN duration from the port -> {"kind":"failed","token":{"kind":"guide","ref":"session-1","seq":3},"reason":"durationMs is NaN — the port must report a finite millisecond value"}
healthy port -> {"kind":"playing","token":{"kind":"guide","ref":"session-1","seq":3},"positionMs":61000,"durationMs":125000}
dispose then play re-creates the player (factory calls: 2)
the disposed instance forwards nothing: []
the new player finishes with its own token: [{"type":"finished","token":{"kind":"moment","ref":"moment-9","seq":8}}]
```
