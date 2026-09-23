// G08.01 — device identity on the client (docs/architecture/09 §5): the
// server generates `device_id` (UUID) and `device_secret` (32 bytes, returned
// exactly once); the secret lives in expo-secure-store (the injected
// SecureSecretStore), the `device_id` row in the zone-B `device` table
// (services/db owns the SQLite write). Registration happens once per
// install; the transport is injected so tests run without a network.
//
// Crash-window trade-off (accepted, ADR G01.03 §3.8 era rules): the secret
// and the row live in two stores, so a crash between the two writes leaves
// an incomplete pair. Recovery is a fresh registration — the stale remainder
// is wiped, the server-side orphan is reclaimed by device-delete retention
// (G09.03), and until `/v1/link` exists a reinstall loses the old identity
// by design (09 §2).
import { getDeviceId, setDeviceId } from './db/db.ts';
import type { SqlDriver } from './db/types.ts';

export class DeviceError extends Error {
  rule: 'network_failed' | 'rate_limited' | 'server_error' | 'invalid_response';

  constructor(rule: DeviceError['rule'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DeviceError';
    this.rule = rule;
  }
}

export interface SecureSecretStore {
  getSecret(): Promise<string | null>;
  saveSecret(value: string): Promise<void>;
  clearSecret(): Promise<void>;
}

export interface DeviceRegistrationResponse {
  device_id: string;
  device_secret: string;
}

export interface DeviceRegistrationTransport {
  /** Registers once; maps the canonical POST /v1/device onto the functions base URL. */
  register(baseUrl: string): Promise<{ status: number; body: unknown }>;
}

export interface DeviceIdentity {
  deviceId: string;
  deviceSecret: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function defaultTransport(): DeviceRegistrationTransport {
  return {
    async register(baseUrl) {
      try {
        const response = await fetch(`${baseUrl}/device`, { method: 'POST' });
        const text = await response.text();
        let body: unknown = null;
        try {
          body = text === '' ? null : JSON.parse(text);
        } catch {
          body = null;
        }
        return { status: response.status, body };
      } catch (error) {
        throw new DeviceError('network_failed', 'device registration request failed', { cause: error });
      }
    },
  };
}

function parseRegistration(body: unknown): DeviceRegistrationResponse {
  if (typeof body !== 'object' || body === null) {
    throw new DeviceError('invalid_response', 'device registration response is not an object');
  }
  const candidate = body as Record<string, unknown>;
  const deviceId = candidate['device_id'];
  const deviceSecret = candidate['device_secret'];
  if (typeof deviceId !== 'string' || !UUID_PATTERN.test(deviceId)) {
    throw new DeviceError('invalid_response', 'device_id is missing or not a UUID');
  }
  if (typeof deviceSecret !== 'string' || deviceSecret === '') {
    throw new DeviceError('invalid_response', 'device_secret is missing');
  }
  return { device_id: deviceId, device_secret: deviceSecret };
}

// Concurrent first-launch calls (React double-mount in dev is routine) must
// not register twice: the in-flight registration is memoized per driver, so
// every caller awaits one transport round-trip and one identity.
const inflight = new WeakMap<SqlDriver, Promise<DeviceIdentity>>();

export function ensureDeviceIdentity(deps: {
  driver: SqlDriver;
  secretStore: SecureSecretStore;
  /** Functions base URL, e.g. https://<ref>.supabase.co/functions/v1 */
  baseUrl: string;
  transport?: DeviceRegistrationTransport;
}): Promise<DeviceIdentity> {
  const running = inflight.get(deps.driver);
  if (running) return running;
  const promise = registerOnce(deps).finally(() => {
    inflight.delete(deps.driver);
  });
  inflight.set(deps.driver, promise);
  return promise;
}

async function registerOnce(deps: {
  driver: SqlDriver;
  secretStore: SecureSecretStore;
  baseUrl: string;
  transport?: DeviceRegistrationTransport;
}): Promise<DeviceIdentity> {
  const secret = await deps.secretStore.getSecret();
  const storedDeviceId = getDeviceId(deps.driver);
  if (secret !== null && storedDeviceId !== null) {
    return { deviceId: storedDeviceId, deviceSecret: secret };
  }
  // Incomplete pair (crash between the two stores): wipe the stale remainder
  // and register a fresh identity rather than trust either half alone.
  if (secret !== null || storedDeviceId !== null) {
    await deps.secretStore.clearSecret();
  }

  const transport = deps.transport ?? defaultTransport();
  const response = await transport.register(deps.baseUrl);
  if (response.status === 429) {
    throw new DeviceError('rate_limited', 'device registration is rate limited; retry later');
  }
  if (response.status !== 201) {
    throw new DeviceError('server_error', `device registration failed with status ${response.status}`);
  }
  const registration = parseRegistration(response.body);

  // Persist the secret first: a crash before the row write re-registers on
  // the next run, while the reverse order could leave a row pointing at a
  // secret nobody holds.
  await deps.secretStore.saveSecret(registration.device_secret);
  setDeviceId(deps.driver, registration.device_id);
  return { deviceId: registration.device_id, deviceSecret: registration.device_secret };
}
