// G08.01 — behavioral tests for the device-registration core. Every rule
// here fails when the corresponding guard in device-core.ts is reverted
// (implementation-rules 1/14): registration shape, bearer verification
// negatives, and the per-IP rate window.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  checkRateLimit,
  createMemoryLookup,
  DEVICE_INSERT_SQL,
  DEVICE_LOOKUP_SQL,
  DEVICE_RATE_LIMIT,
  DEVICE_RATE_WINDOW_MS,
  hashIp,
  hashSecret,
  RATE_INCREMENT_SQL,
  rateWindowStart,
  registerDevice,
  verifyBearer,
} from './device-core.ts';

test('registerDevice: UUID + 32-byte base64url secret + sha256 hash, secret returned once', () => {
  const reg = registerDevice();
  assert.match(reg.deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const raw = Buffer.from(reg.deviceSecret, 'base64url');
  assert.equal(raw.length, 32);
  assert.equal(reg.secretHash, createHash('sha256').update(reg.deviceSecret, 'utf8').digest('hex'));
  // The secret must never appear in the stored form.
  assert.ok(!reg.secretHash.includes(reg.deviceSecret));
  assert.ok(!reg.secretHash.includes(reg.deviceId));
});

test('registerDevice: two registrations never share a secret or id', () => {
  const a = registerDevice();
  const b = registerDevice();
  assert.notEqual(a.deviceSecret, b.deviceSecret);
  assert.notEqual(a.deviceId, b.deviceId);
  assert.notEqual(a.secretHash, b.secretHash);
});

test('hashSecret is deterministic lowercase hex and differs from the secret', () => {
  const h1 = hashSecret('s3cret-value');
  const h2 = hashSecret('s3cret-value');
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, 's3cret-value');
});

test('verifyBearer: valid header authenticates through the hash lookup', () => {
  const reg = registerDevice();
  const entries = new Map([[reg.secretHash, reg.deviceId]]);
  const result = verifyBearer(`Bearer ${reg.deviceSecret}`, createMemoryLookup(entries));
  assert.deepEqual(result, { ok: true, deviceId: reg.deviceId });
});

test('verifyBearer: malformed headers are rejected (scheme spelling, no prefix, other scheme)', () => {
  const reg = registerDevice();
  const lookup = createMemoryLookup(new Map([[reg.secretHash, reg.deviceId]]));
  for (const header of [undefined, null, '', 'Bearer', 'bearer x', 'Basic x', `bearer ${reg.deviceSecret}`, `Token ${reg.deviceSecret}`]) {
    const result = verifyBearer(header, lookup);
    assert.deepEqual(result, { ok: false, reason: 'malformed_header' }, header ?? 'empty');
  }
});

test('verifyBearer: unknown or foreign secret is unknown_device', () => {
  const reg = registerDevice();
  const lookup = createMemoryLookup(new Map([[reg.secretHash, reg.deviceId]]));
  assert.deepEqual(verifyBearer('Bearer wrong-secret', lookup), { ok: false, reason: 'unknown_device' });
  assert.deepEqual(verifyBearer('Bearer ', lookup), { ok: false, reason: 'unknown_device' });
});

test('memory lookup keeps the constant-time compare idiom working over many entries', () => {
  const regs = Array.from({ length: 50 }, () => registerDevice());
  const entries = new Map(regs.map((r) => [r.secretHash, r.deviceId]));
  const lookup = createMemoryLookup(entries);
  const target = regs[25]!;
  assert.deepEqual(verifyBearer(`Bearer ${target.deviceSecret}`, lookup), {
    ok: true,
    deviceId: target.deviceId,
  });
});

test('rate limit: attempts up to the limit pass, the next one is denied with Retry-After', () => {
  const now = 1_700_000_000_000;
  let attempts = 0;
  const storage = { increment: () => ++attempts };
  for (let i = 0; i < DEVICE_RATE_LIMIT; i++) {
    const decision = checkRateLimit(storage, hashIp('203.0.113.7'), now);
    assert.equal(decision.allowed, true, `attempt ${i + 1}`);
  }
  const denied = checkRateLimit(storage, hashIp('203.0.113.7'), now);
  assert.equal(denied.allowed, false);
  assert.equal(denied.attempts, DEVICE_RATE_LIMIT + 1);
  assert.ok(denied.retryAfterSeconds >= 1 && denied.retryAfterSeconds <= DEVICE_RATE_WINDOW_MS / 1000);
});

test('rate limit: a new window resets the counter; other IPs are independent', () => {
  const withinFirstWindow = DEVICE_RATE_WINDOW_MS - 1;
  const nextWindow = DEVICE_RATE_WINDOW_MS + 10;
  // Window-aware fake mirroring the SQL counter's (ip_hash, window_start) key.
  const counts = new Map<string, number>();
  const storage = {
    increment: (ipHash: string, windowStart: number) => {
      const key = `${ipHash}@${windowStart}`;
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
  const ip = hashIp('198.51.100.4');
  for (let i = 0; i < DEVICE_RATE_LIMIT; i++) {
    checkRateLimit(storage, ip, withinFirstWindow);
  }
  assert.equal(checkRateLimit(storage, ip, withinFirstWindow).allowed, false);
  assert.equal(checkRateLimit(storage, ip, nextWindow).allowed, true);
  assert.equal(checkRateLimit(storage, hashIp('192.0.2.9'), withinFirstWindow).allowed, true);
});

test('rateWindowStart floors to the window boundary', () => {
  assert.equal(rateWindowStart(DEVICE_RATE_WINDOW_MS + 5), DEVICE_RATE_WINDOW_MS);
  assert.equal(rateWindowStart(0), 0);
});

test('hashIp is deterministic, hides the raw address, and differs per input', () => {
  const a = hashIp('203.0.113.7');
  assert.equal(a, hashIp('203.0.113.7'));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes('203.0.113.7'));
  assert.notEqual(a, hashIp('203.0.113.8'));
});

test('SQL constants are pinned exactly: the statements the RLS suite proves by behavior', () => {
  // Rule-15 parity: the edge function executes these constants; the RLS
  // suite proves the same statements' semantics on PGlite through its own
  // literals, so the constants must stay byte-identical to the proven texts.
  assert.equal(
    RATE_INCREMENT_SQL,
    'insert into device_registration_rate (ip_hash, window_start, attempts) values ($1, to_timestamp($2 / 1000.0), 1) ' +
      'on conflict (ip_hash, window_start) do update set attempts = device_registration_rate.attempts + 1 ' +
      'returning attempts',
  );
  assert.equal(DEVICE_INSERT_SQL, 'insert into devices (device_id, secret_hash) values ($1, $2)');
  assert.equal(DEVICE_LOOKUP_SQL, 'select device_id from devices where secret_hash = $1');
});
