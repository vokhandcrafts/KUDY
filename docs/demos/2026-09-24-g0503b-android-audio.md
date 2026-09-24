# G05.03.b — the expo-audio adapter: pure status and lock-screen mappings

*2026-09-24T19:20:00Z by Showboat 0.6.1*
<!-- showboat-id: g0503b-android-audio -->

Issue #214: the device implementation of the G05.03.a player port on expo-audio lives in `services/audio/expo/`. The adapter itself (`expo-audio-port.ts`) is thin expo glue — one physical `AudioPlayer` per source, disposed whole on replacement, the speech audio mode requested through a once-guard — and everything decidable is delegated to pure mappings proven here on synthetic statuses: an interruption (the OS taking the output without a pause command) maps to focus loss and never to finished; a source loaded and then unloaded maps to a failure with a reason (expo-audio 1.1.1 has no error field — ExoPlayer's idle state is both the initial and the error state, so the discriminator is a was-loaded flag); millisecond conversion never invents numbers, NaN passes through to the service guard and becomes a failed state; the lock-screen next/prev walks the accessible recommended list skipping locked entries without touching progress and has no address for Moment content; the speech audio mode is set exactly once.

```python
import subprocess
subprocess.run(['node', '--test', '--experimental-strip-types', '--test-reporter=dot', 'services/audio/expo/status-mapping.test.ts', 'services/audio/expo/lock-screen.test.ts', 'services/audio/expo/speech-mode.test.ts'], check=True)
```

```output
..................
```

```python
import subprocess
js = """
import { createStatusMapper } from './services/audio/expo/status-mapping.ts';
import { mapLockScreenCommand } from './services/audio/expo/lock-screen.ts';
import { createSpeechModeSetter, SPEECH_AUDIO_MODE } from './services/audio/expo/speech-mode.ts';
import { AudioService } from './services/audio/service.ts';
import { FakeAudioPlayerPort } from './services/audio/fake-port.ts';

const status = (o = {}) => ({
  id: 1, currentTime: 0, playbackState: 'ready', timeControlStatus: 'paused',
  reasonForWaitingToPlay: '', mute: false, duration: 62.5, playing: false,
  loop: false, didJustFinish: false, isBuffering: false, isLoaded: true,
  playbackRate: 1, shouldCorrectPitch: true, ...o,
});
const drive = () => {
  const mapper = createStatusMapper();
  const events = [];
  return {
    feed(s, key = 1) {
      const m = mapper.onStatus(s);
      if (!m) return;
      events.push(m.type === 'focus-loss' || m.type === 'focus-regain' ? m : { ...m, key });
    },
    mapper, events,
  };
};

const call = drive();
call.mapper.onCommand('play');
call.feed(status({ playing: true, timeControlStatus: 'playing' }));
call.feed(status({ playing: false, timeControlStatus: 'paused' }));   // the OS takes the output
call.feed(status({ playing: true, timeControlStatus: 'playing' }));   // the output comes back
call.feed(status({ playing: true, didJustFinish: true, playbackState: 'ended' }));
console.log('a call during playback -> mapped events:');
console.log(' ', JSON.stringify(call.events));

const broken = drive();
broken.mapper.onCommand('play');
broken.feed(status({ playing: true, timeControlStatus: 'playing' }));
broken.feed(status({ isLoaded: false, playbackState: 'idle', playing: false }));
console.log('loaded then unloaded ->', JSON.stringify(broken.events[0]));

const nan = drive();
nan.mapper.onCommand('play');
const snapshot = nan.mapper.snapshotOf(status({ playing: true, currentTime: 2.5, duration: Number.NaN }));
console.log('NaN duration status -> snapshot:', JSON.stringify(snapshot));
const service = new AudioService({ createPort: () => new FakeAudioPlayerPort() });
await service.play({ token: { kind: 'guide', ref: 'session-1', seq: 3 }, path: 'stop4-base.m4a' });
service['session'].port.snapshotValue = snapshot;
console.log('the service guard turns it into ->', JSON.stringify(service.playbackState()));

const recommended = Object.freeze([
  { storyId: 'stop-1-main', locked: false },
  { storyId: 'stop-1-extra', locked: true },
  { storyId: 'stop-2-main', locked: false },
  { storyId: 'stop-2-extra', locked: true },
  { storyId: 'stop-3-main', locked: false },
]);
console.log('lock-screen next/prev over the recommended list:');
console.log('  next from stop-1-main ->', JSON.stringify(mapLockScreenCommand('next', recommended, 'stop-1-main')));
console.log('  prev from stop-3-main ->', JSON.stringify(mapLockScreenCommand('prev', recommended, 'stop-3-main')));
console.log('  next from stop-3-main (boundary) ->', JSON.stringify(mapLockScreenCommand('next', recommended, 'stop-3-main')));
console.log('  prev with no selection ->', JSON.stringify(mapLockScreenCommand('prev', recommended, null)));
console.log('  entry type carries only a storyId — no Moment address in the list');

let sets = 0;
const setter = createSpeechModeSetter(async (mode) => {
  sets += 1;
  if (JSON.stringify(mode) !== JSON.stringify(SPEECH_AUDIO_MODE)) throw new Error('unexpected mode');
}, SPEECH_AUDIO_MODE);
await setter();
await setter();
console.log('speech audio mode set once across calls:', sets, 'underlying set, isSet =', setter.isSet);
"""
subprocess.run(['node', '--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', js], check=True)
```

```output
a call during playback -> mapped events:
  [{"type":"focus-loss"},{"type":"focus-regain"},{"type":"finished","key":1}]
loaded then unloaded -> {"type":"failed","reason":"player reported playbackState \"idle\" after the source was loaded","key":1}
NaN duration status -> snapshot: {"state":"playing","positionMs":2500,"durationMs":null}
the service guard turns it into -> {"kind":"failed","token":{"kind":"guide","ref":"session-1","seq":3},"reason":"durationMs is NaN — the port must report a finite millisecond value"}
lock-screen next/prev over the recommended list:
  next from stop-1-main -> {"type":"select-story","storyId":"stop-2-main"}
  prev from stop-3-main -> {"type":"select-story","storyId":"stop-2-main"}
  next from stop-3-main (boundary) -> null
  prev with no selection -> null
  entry type carries only a storyId — no Moment address in the list
speech audio mode set once across calls: 1 underlying set, isSet = true
```
