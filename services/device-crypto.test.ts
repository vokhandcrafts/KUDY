// G20.20 — the digest adapter's byte parity and the uuid shape over a
// node:crypto-backed facility: the fake digest256 IS the reference
// implementation, so every vector proves the adapter maps the same bytes to
// the same hex node:crypto does (implementation-rules 1: breaking the hex
// mapping fails parity).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';

import { createDeviceSha256, newDeviceSessionId } from './device-crypto.ts';

const crypto = {
  digest256: async (data: Uint8Array) => createHash('sha256').update(data).digest().buffer as ArrayBuffer,
  randomUUID: () => nodeRandomUUID(),
};

test('device sha256 matches node:crypto over raw bytes', async () => {
  const sha256 = createDeviceSha256(crypto);
  const vectors = [
    new Uint8Array(0),
    new TextEncoder().encode('kudy'),
    new Uint8Array([0, 1, 2, 253, 254, 255]),
    new Uint8Array([9, 8, 7]),
  ];
  for (const bytes of vectors) {
    assert.equal(await sha256(bytes as Uint8Array), createHash('sha256').update(bytes as Uint8Array).digest('hex'));
  }
});

test('session id mints a UUID', () => {
  const id = newDeviceSessionId(crypto);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(newDeviceSessionId(crypto), id);
});
