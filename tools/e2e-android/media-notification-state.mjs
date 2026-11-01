import assert from 'node:assert/strict';

const RECORD_HEADER = /^[ \t]*NotificationRecord\s*[({][^\r\n]*/gm;
const APP = /\bpkg=by\.kudy\.app(?=[\s),}]|$)/;
const CHANNEL = /\bexpo_audio_channel\b/;

// Dumpsys prints channel and flags on separate lines from NotificationRecord.
// Parse whole records; package-only line filtering misses a lingering card.
export function assertMediaNotificationState(dump, label) {
  assert.ok(typeof dump === 'string' && dump.trim(), 'Android notification dump is empty');
  const headers = [...dump.matchAll(RECORD_HEADER)];
  assert.ok(headers.length || /Notification List:|Active Notifications:|Notification Manager State:/.test(dump),
    'Android notification dump does not establish active records');
  const records = headers.map((entry, index) => dump.slice(entry.index,
    headers[index + 1]?.index ?? dump.length));
  const media = records.filter((record) => APP.test(record.split(/\r?\n/, 1)[0]) && CHANNEL.test(record));
  const excerpt = media.map((record) => record.slice(0, 500).replace(/\s+/g, ' '));
  if (label === 'paused') {
    assert.equal(media.length, 1, 'one KUDY media notification must exist while paused');
    const flags = [...media[0].matchAll(/\b(?:mFlags|flags)=0x([0-9a-f]+)\b/gi)];
    const hasForegroundBit = flags.some((match) => (BigInt(`0x${match[1]}`) & 0x40n) !== 0n);
    assert.ok(/FOREGROUND_SERVICE/.test(media[0]) || hasForegroundBit,
      'KUDY media notification is not marked as a foreground service');
  } else if (label === 'stopped') {
    assert.equal(media.length, 0, 'KUDY media notification remains after Stop');
  } else {
    assert.fail(`unknown media notification observation: ${label}`);
  }
  return excerpt.length ? excerpt.join(' | ') : '(absent)';
}
