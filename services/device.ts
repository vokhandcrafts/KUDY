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
import { clearDeviceAccountState, getDeviceId, setDeviceId } from './db/db.ts';
import type { SqlDriver } from './db/types.ts';
import { NETWORK_WAIT_LIMITS, withWaitLimit } from './network-wait.ts';
import { assertNotRedirected, parseSecureEndpointUrl, SecureUrlError } from './secure-url.ts';

export class DeviceError extends Error {
  rule: 'network_failed' | 'rate_limited' | 'server_error' | 'invalid_response' | 'unsafe_endpoint';

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

// The deviceId shape POST /v1/device issues (09 §5). Exported for the
// sibling boundaries that re-validate a device identity at their own edge —
// the pattern stays single-sourced here (jscpd gate).
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function defaultTransport(waitLimitMs: number): DeviceRegistrationTransport {
  return {
    async register(baseUrl) {
      // N3: the parsed URL is validated before the network — the response
      // carries the device secret, so an unvalidated endpoint never gets
      // the request. Redirects are refused twice: fetch itself runs with
      // redirect: 'error', and a response that was redirected anyway (a
      // platform that ignored the option) is rejected before its body is
      // read, so a secret from a foreign origin is never accepted.
      let endpoint: URL;
      try {
        endpoint = parseSecureEndpointUrl(`${baseUrl}/device`, 'device registration');
      } catch (error) {
        const message = error instanceof SecureUrlError
          ? error.message
          : 'device registration: the endpoint URL is not parseable';
        throw new DeviceError('unsafe_endpoint', message, { cause: error });
      }
      try {
        // G20.10 (§N4): the registration wait is finite and covers the body.
        // A deadline rejects before anything is persisted — a failed
        // registration never fabricates a local secret or identity.
        const response = await withWaitLimit('wait-device', waitLimitMs, async (signal) => {
          const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal });
          assertNotRedirected(endpoint, response, 'device registration');
          const text = await response.text();
          let body: unknown = null;
          try {
            body = text === '' ? null : JSON.parse(text);
          } catch {
            body = null;
          }
          return { status: response.status, body };
        });
        return { status: response.status, body: response.body };
      } catch (error) {
        if (error instanceof SecureUrlError) {
          throw new DeviceError('unsafe_endpoint', error.message, { cause: error });
        }
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
  /** Wait limit override for the default transport (tests; the owner is NETWORK_WAIT_LIMITS.deviceMs). */
  waitLimitMs?: number;
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
  waitLimitMs?: number;
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

  const transport = deps.transport ?? defaultTransport(deps.waitLimitMs ?? NETWORK_WAIT_LIMITS.deviceMs);
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

// --- G09.03 — device data deletion (09 §5, DELETE /v1/device) ---

export interface DeviceDeleteTransport {
  /** Requests the canonical `DELETE /v1/device` with the device bearer. */
  deleteDevice(baseUrl: string, deviceSecret: string): Promise<{ status: number }>;
}

function defaultDeleteTransport(waitLimitMs: number): DeviceDeleteTransport {
  return {
    async deleteDevice(baseUrl, deviceSecret) {
      // N3: the parsed URL is validated before the network — the request
      // carries the device bearer, so an unvalidated endpoint never gets it.
      // Redirects are refused twice (the fetch option and the response
      // guard), the same way the registration transport refuses them.
      let endpoint: URL;
      try {
        endpoint = parseSecureEndpointUrl(`${baseUrl}/device`, 'device deletion');
      } catch (error) {
        const message = error instanceof SecureUrlError
          ? error.message
          : 'device deletion: the endpoint URL is not parseable';
        throw new DeviceError('unsafe_endpoint', message, { cause: error });
      }
      try {
        // G20.10 (§N4): the deletion wait is finite and covers the body read.
        const { status } = await withWaitLimit('wait-device', waitLimitMs, async (signal) => {
          const response = await fetch(endpoint, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${deviceSecret}` },
            redirect: 'error',
            signal,
          });
          assertNotRedirected(endpoint, response, 'device deletion');
          await response.text();
          return { status: response.status };
        });
        return { status };
      } catch (error) {
        if (error instanceof SecureUrlError) {
          throw new DeviceError('unsafe_endpoint', error.message, { cause: error });
        }
        throw new DeviceError('network_failed', 'device delete request failed', { cause: error });
      }
    },
  };
}

/**
 * Deletes the device account: the server call goes first, and the local
 * durable state is wiped only after the server confirmed. 204 — the account
 * was live and is gone (the server's FK cascades took the event log and the
 * grant cache). 403 — the device is already gone on the server (a lost 204
 * after a committed delete, or a secret that matches no row): the local wipe
 * still completes, because every later authenticated call would 403 the
 * same way and the old queue must never resurrect the account (`21` §6).
 * Any other status, or a network failure, wipes nothing — the retry is safe
 * because the server delete is idempotent. Downloaded bundles (zone A) and
 * run progress stay (09 §5, `21` §6); the DB wipe is one transaction
 * (clearDeviceAccountState), the secret store goes last, so a crash
 * mid-flow leaves the retry path intact — symmetric to the registration
 * crash window above.
 */
export async function deleteDeviceAccount(deps: {
  driver: SqlDriver;
  secretStore: SecureSecretStore;
  /** Functions base URL, e.g. https://<ref>.supabase.co/functions/v1 */
  baseUrl: string;
  transport?: DeviceDeleteTransport;
  /** Wait limit override for the default transport (tests; the owner is NETWORK_WAIT_LIMITS.deviceMs). */
  waitLimitMs?: number;
}): Promise<void> {
  const secret = await deps.secretStore.getSecret();
  if (secret === null) {
    // No identity to authenticate: no server account is reachable under a
    // secret nobody holds (an incomplete registration pair — the next
    // ensureDeviceIdentity re-registers), so the deletion is the local wipe
    // only, and never a re-registration for the old state.
    clearDeviceAccountState(deps.driver);
    await deps.secretStore.clearSecret();
    return;
  }
  const transport = deps.transport ?? defaultDeleteTransport(deps.waitLimitMs ?? NETWORK_WAIT_LIMITS.deviceMs);
  const response = await transport.deleteDevice(deps.baseUrl, secret);
  if (response.status !== 204 && response.status !== 403) {
    throw new DeviceError('server_error', `device delete failed with status ${response.status}`);
  }
  clearDeviceAccountState(deps.driver);
  await deps.secretStore.clearSecret();
}
