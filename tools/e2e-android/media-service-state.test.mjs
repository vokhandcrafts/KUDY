import assert from 'node:assert/strict';
import test from 'node:test';

// APR-08.c (#854): the service-state helper reads dumpsys activity services
// for one named service and rejects an unknown Stop state. The implementation
// adds this helper and calls it from walk.mjs after the test is frozen.
import { assertMediaServiceState } from './media-service-state.mjs';

const target = 'by.kudy.app/expo.modules.audio.service.AudioControlsService';
const other = 'com.example.app/com.example.OtherService';

function service(name, details) {
  return `* ServiceRecord{123 u0 ${name}}\n${details}\n`;
}

test('APR-08.c Stop requires an explicit non-foreground state on AudioControlsService itself', () => {
  const stopped = service(target, '    isForeground=false foregroundId=0 types=0x00000000') +
    service(other, '    isForeground=true foregroundId=42 types=0x00000002');
  assert.doesNotThrow(() => assertMediaServiceState(stopped, 'stopped'),
    'another service being foreground must not change the target service result');

  const unknown = service(target, '    foregroundId=0 types=0x00000000') +
    service(other, '    isForeground=false foregroundId=0 types=0x00000000');
  assert.throws(() => assertMediaServiceState(unknown, 'stopped'), /foreground|unknown|ambiguous/i,
    'another service being stopped must not fill in the target service state');

  const lateForeground = service(target,
    `${'    serviceConnection=bound\n'.repeat(130)}    isForeground=true foregroundId=42 types=0x00000002`);
  assert.throws(() => assertMediaServiceState(lateForeground, 'stopped'), /foreground/i,
    'the target foreground flag must be checked even after 3000 characters');

  const conflicting = service(target,
    '    isForeground=false foregroundId=0\n    isForeground=true foregroundId=42 types=0x00000002');
  assert.throws(() => assertMediaServiceState(conflicting, 'stopped'), /foreground|ambiguous/i,
    'conflicting target service flags must not count as a confirmed Stop');
});
