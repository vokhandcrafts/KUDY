// G20.29 / #791: pending mode setup may outlive the device service.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AudioService } from '../services/audio/service.ts';
import { FakeAudioPlayerPort } from '../services/audio/fake-port.ts';

test('G20.29 AC3: dispose during pending mode setup never creates or starts a player', async () => {
  let completeMode: (() => void) | null = null;
  let createdPorts = 0;
  const port = new FakeAudioPlayerPort();
  const audio = new AudioService({
    createPort: () => { createdPorts += 1; return port; },
    configureMode: () => new Promise<void>((complete) => { completeMode = complete; }),
  });
  const pending = audio.play({
    token: { kind: 'moment', ref: 'disposed', seq: 1 },
    path: 'file:///installed/disposed.m4a',
  });
  assert.ok(completeMode, 'mode initialization is pending');
  audio.dispose();
  completeMode();
  await pending;
  assert.equal(createdPorts, 0);
  assert.deepEqual(port.commands, []);
  assert.equal(audio.playbackState().kind, 'idle');
});
