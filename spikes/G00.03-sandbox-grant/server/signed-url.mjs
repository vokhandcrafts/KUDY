import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Token binds the manifest base (route/version/locale/tier), the manifest path,
// a hash of the device identity and an expiry. The signing key lives only in
// the server process (env in live mode); tokens are the only thing a client
// ever sees — the storage layout itself is not part of the grant response.
export function mintFileToken({ signingKey, manifestBase, path, deviceId, ttlSeconds, now = Date.now() }) {
  const payload = {
    b: manifestBase,
    p: path,
    d: createHash('sha256').update(deviceId, 'utf8').digest('hex').slice(0, 16),
    e: now + ttlSeconds * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', signingKey).update(body).digest('base64url');
  return { token: `${body}.${mac}`, expiresAt: payload.e };
}

export function verifyFileToken({ signingKey, token, now = Date.now() }) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const expected = createHmac('sha256', signingKey).update(parts[0]).digest();
  const given = Buffer.from(parts[1], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  if (
    typeof payload?.b !== 'string' ||
    typeof payload?.p !== 'string' ||
    typeof payload?.d !== 'string' ||
    typeof payload?.e !== 'number'
  ) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (now >= payload.e) return { ok: false, reason: 'expired' };
  return { ok: true, manifestBase: payload.b, path: payload.p, deviceIdHash: payload.d };
}
