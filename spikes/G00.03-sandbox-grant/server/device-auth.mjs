import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Canonical device auth per docs/architecture/09 §5:
//   POST /v1/device → { device_id (UUID), device_secret (32 bytes, shown once) },
//   the devices registry stores only the secret hash, and later calls use
//   `Authorization: Bearer <device_secret>`.
// The registry is keyed by secret hash; a 32-byte random secret needs no salt.

function secretHash(deviceSecret) {
  return createHash('sha256').update(deviceSecret, 'utf8').digest('hex');
}

export function registerDevice(devicesFile, { now = () => new Date().toISOString() } = {}) {
  const deviceId = randomUUID();
  const deviceSecret = randomBytes(32).toString('base64url');
  const devices = existsSync(devicesFile)
    ? JSON.parse(readFileSync(devicesFile, 'utf8'))
    : {};
  devices[secretHash(deviceSecret)] = { device_id: deviceId, registered_at: now() };
  mkdirSync(dirname(devicesFile), { recursive: true });
  writeFileSync(devicesFile, JSON.stringify(devices, null, 2));
  return { deviceId, deviceSecret };
}

export function authenticateBearer(header, devicesFile) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return { ok: false, reason: 'malformed_header' };
  }
  const candidate = Buffer.from(secretHash(header.slice('Bearer '.length)), 'hex');
  if (!existsSync(devicesFile)) return { ok: false, reason: 'unknown_device' };
  const devices = JSON.parse(readFileSync(devicesFile, 'utf8'));
  // Full scan keeps the work independent of which entry matches.
  for (const [hash, record] of Object.entries(devices)) {
    const known = Buffer.from(hash, 'hex');
    if (known.length === candidate.length && timingSafeEqual(known, candidate)) {
      return { ok: true, deviceId: record.device_id };
    }
  }
  return { ok: false, reason: 'unknown_device' };
}
