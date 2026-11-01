import assert from 'node:assert/strict';
import test from 'node:test';

import { assertMediaNotificationState } from './media-notification-state.mjs';

const media = `NotificationRecord(0x123: pkg=by.kudy.app user=UserHandle{0} id=1)
    mChannel=NotificationChannel{mId=expo_audio_channel mName=Playback}
    Notification(channel=expo_audio_channel flags=0x40)
    mFlags=FOREGROUND_SERVICE
`;
const unrelated = `NotificationRecord(0x456: pkg=another.app user=UserHandle{0} id=4)
    mChannel=NotificationChannel{mId=expo_audio_channel}
    mFlags=FOREGROUND_SERVICE
`;

test('#854 stopped detects KUDY media channel on a different line from NotificationRecord', () => {
  assert.throws(() => assertMediaNotificationState(media, 'stopped'), /remains after Stop/);
  assert.throws(() => assertMediaNotificationState(unrelated + media, 'stopped'), /remains after Stop/);
});

test('#854 paused requires the target app, exact channel, and foreground flag', () => {
  assert.match(assertMediaNotificationState(unrelated + media, 'paused'), /by.kudy.app/);
  assert.throws(() => assertMediaNotificationState(media.replace('FOREGROUND_SERVICE', 'NONE').replace('flags=0x40', 'flags=0x0'), 'paused'), /not marked/);
  assert.throws(() => assertMediaNotificationState(unrelated, 'paused'), /one KUDY media/);
});

test('#854 stopped allows unrelated records but rejects unparseable notification output', () => {
  assert.equal(assertMediaNotificationState(unrelated, 'stopped'), '(absent)');
  assert.throws(() => assertMediaNotificationState('', 'stopped'), /empty/);
  assert.throws(() => assertMediaNotificationState('other output', 'stopped'), /does not establish/);
});

test('#854 foreground flag is parsed as a bitmask and a similarly named package is not KUDY', () => {
  const combinedFlags = media.replace('mFlags=FOREGROUND_SERVICE', 'mFlags=0xc1').replace('flags=0x40', 'flags=0x0');
  assert.match(assertMediaNotificationState(combinedFlags, 'paused'), /by.kudy.app/);
  const imposter = media.replace('pkg=by.kudy.app ', 'pkg=by.kudy.app.evil ');
  assert.equal(assertMediaNotificationState(imposter, 'stopped'), '(absent)');
});

test('#854 stopped does not flag a different channel from the app', () => {
  const otherChannel = media.replaceAll('expo_audio_channel', 'unrelated_channel');
  assert.equal(assertMediaNotificationState(otherChannel, 'stopped'), '(absent)');
});
