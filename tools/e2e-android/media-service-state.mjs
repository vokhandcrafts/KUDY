import assert from 'node:assert/strict';

const AUDIO_SERVICE = 'by.kudy.app/expo.modules.audio.service.AudioControlsService';
const RECORD_HEADER = /^[ \t]*\*?[ \t]*ServiceRecord\{[^\r\n]*\}/gm;

// Each foreground flag must belong to the named service record. A fixed-size
// slice can silently read a neighboring service or miss a late flag.
export function assertMediaServiceState(services, label) {
  assert.ok(typeof services === 'string' && services.trim(), 'Android service dump is empty');
  const headers = [...services.matchAll(RECORD_HEADER)];
  const records = headers.map((match, index) => ({
    header: match[0],
    body: services.slice(match.index, headers[index + 1]?.index ?? services.length),
  }));
  const targets = records.filter(({ header }) => header.includes(AUDIO_SERVICE));
  assert.ok(targets.length <= 1, 'AudioControlsService has ambiguous service records');

  if (targets.length === 0) {
    assert.equal(label, 'stopped', 'AudioControlsService is absent during Pause');
    assert.ok(headers.length > 0 || /ACTIVITY MANAGER SERVICES|Active services:/.test(services),
      'Android service dump cannot establish that AudioControlsService is absent');
    return { excerpt: '(absent)', foreground: '(absent)' };
  }

  const record = targets[0].body;
  const flags = [...record.matchAll(/\bisForeground=(true|false)\b[^\r\n]*/g)].map((match) => match[0]);
  assert.equal(flags.length, 1, 'AudioControlsService foreground state is unknown or ambiguous');
  const foreground = flags[0];
  if (label === 'paused') {
    assert.match(foreground, /\bisForeground=true\b.*\btypes=0x0*2\b/,
      'AudioControlsService is not foreground with mediaPlayback type during Pause');
  } else if (label === 'stopped') {
    assert.match(foreground, /\bisForeground=false\b/,
      'AudioControlsService remains foreground after Stop');
  } else {
    assert.fail(`unknown media service observation: ${label}`);
  }
  return { excerpt: record.slice(0, 700).replace(/\s+/g, ' '), foreground };
}
