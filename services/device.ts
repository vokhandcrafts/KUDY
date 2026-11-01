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
import {
  clearDeviceAccountState, getDeviceDeleteState, getDeviceId, isDeviceDeletionPending,
  setDeviceDeleteState, setDeviceId, type DeviceDeleteState,
} from './db/db.ts';
import {
  blockAfterUnpersistedDelete, deletionBarrierPersisted, deviceDeletionRequested,
  markDeviceDeletionRequested, withDeviceLifecycle,
} from './device-lifecycle.ts';
import type { SqlDriver } from './db/types.ts';
import { NETWORK_WAIT_LIMITS, withWaitLimit } from './network-wait.ts';
import { assertNotRedirected, parseSecureEndpointUrl, SecureUrlError } from './secure-url.ts';

export class DeviceError extends Error {
  rule: 'network_failed' | 'rate_limited' | 'server_error' | 'invalid_response' | 'unsafe_endpoint' | 'deletion_pending';

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
  let pendingRemote = false;
  try {
    pendingRemote = getDeviceDeleteState(deps.driver) === 'pending_remote';
  } catch (error) {
    return Promise.reject(error);
  }
  if (deviceDeletionRequested(deps.driver) || pendingRemote) {
    return Promise.reject(new DeviceError('deletion_pending', 'device deletion needs an explicit retry'));
  }
  const running = inflight.get(deps.driver);
  if (running) return running;
  const promise = withDeviceLifecycle(deps.driver, () => registerOnce(deps)).finally(() => {
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
  // Finish a server-acknowledged local wipe after a crash before ever
  // accessing or recreating an identity. An unresolved remote request never
  // implicitly re-registers: the caller must explicitly retry deletion.
  await recoverPendingLocalDeletion(deps.driver, deps.secretStore);
  if (isDeviceDeletionPending(deps.driver)) {
    throw new DeviceError('deletion_pending', 'device deletion needs an explicit retry');
  }
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
  deleteDevice(baseUrl: string, deviceSecret: string): Promise<{ status: number; body?: unknown }>;
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
        const answer = await withWaitLimit('wait-device', waitLimitMs, async (signal) => {
          const response = await fetch(endpoint, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${deviceSecret}` },
            redirect: 'error',
            signal,
          });
          assertNotRedirected(endpoint, response, 'device deletion');
          const raw = await response.text();
          let body: unknown = null;
          if (raw !== '') {
            try {
              body = JSON.parse(raw);
            } catch {
              body = raw;
            }
          }
          return { status: response.status, body };
        });
        return answer;
      } catch (error) {
        if (error instanceof SecureUrlError) {
          throw new DeviceError('unsafe_endpoint', error.message, { cause: error });
        }
        throw new DeviceError('network_failed', 'device delete request failed', { cause: error });
      }
    },
  };
}

// Persist the server decision separately from local completion. A lost 204
// followed by 403 is indistinguishable from a wrong secret: neither proves
// remote erasure. This accessor intentionally exposes only those two states.
export type DeviceDeletionResult = { local: 'complete'; remote: 'remote_confirmed' | 'remote_unverified' };

function remoteResult(state: DeviceDeleteState): DeviceDeletionResult {
  return { local: 'complete', remote: state.endsWith('confirmed') ? 'remote_confirmed' : 'remote_unverified' };
}

export function getLastDeviceDeletionResult(driver: SqlDriver): DeviceDeletionResult | null {
  const state = getDeviceDeleteState(driver);
  return state?.startsWith('complete_') ? remoteResult(state) : null;
}

// Recover the local half even when the previous process crashed after the
// SQLite transaction and before SecureStore cleared. Never erase the secret
// when there has been no validated remote answer.
export async function recoverPendingLocalDeletion(driver: SqlDriver, secretStore: SecureSecretStore): Promise<void> {
  const state = getDeviceDeleteState(driver);
  if (state !== 'cleanup_remote_confirmed' && state !== 'cleanup_remote_unverified') return;
  clearDeviceAccountState(driver);
  await secretStore.clearSecret();
  setDeviceDeleteState(driver, state === 'cleanup_remote_confirmed'
    ? 'complete_remote_confirmed' : 'complete_remote_unverified');
}

/** Deletion never claims remote success on 403 or missing credentials. */
export async function deleteDeviceAccount(deps: {
  driver: SqlDriver;
  secretStore: SecureSecretStore;
  /** Functions base URL, e.g. https://<ref>.supabase.co/functions/v1 */
  baseUrl: string;
  transport?: DeviceDeleteTransport;
  /** Wait limit override for the default transport (tests; the owner is NETWORK_WAIT_LIMITS.deviceMs). */
  waitLimitMs?: number;
}): Promise<DeviceDeletionResult> {
  const releaseRequest = markDeviceDeletionRequested(deps.driver);
  let barrierPersisted = false;
  return withDeviceLifecycle<DeviceDeletionResult>(deps.driver, async () => {
    await recoverPendingLocalDeletion(deps.driver, deps.secretStore);
    const previous = getDeviceDeleteState(deps.driver);
    if (previous?.startsWith('complete_') && getDeviceId(deps.driver) === null) {
      deletionBarrierPersisted(deps.driver);
      return remoteResult(previous);
    }
    // Persist this barrier before network activity. A failure is durable:
    // neither registration nor a sender may revive an old account.
    setDeviceDeleteState(deps.driver, 'pending_remote');
    barrierPersisted = true;
    deletionBarrierPersisted(deps.driver);
    const secret = await deps.secretStore.getSecret();
    if (secret === null) {
      // With no bearer, remote erasure cannot be proven or requested.
      // Clear only local device-owned data, without a new registration.
      setDeviceDeleteState(deps.driver, 'cleanup_remote_unverified');
      await recoverPendingLocalDeletion(deps.driver, deps.secretStore);
      return { local: 'complete', remote: 'remote_unverified' };
    }
    const transport = deps.transport ?? defaultDeleteTransport(deps.waitLimitMs ?? NETWORK_WAIT_LIMITS.deviceMs);
    const response = await transport.deleteDevice(deps.baseUrl, secret);
    if (response.status !== 204 && response.status !== 403) {
      throw new DeviceError('server_error', `device delete failed with status ${response.status}`);
    }
    if (response.status === 403) {
      const body = response.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body) ||
          Object.keys(body).length !== 1 || (body as { error?: unknown }).error !== 'device_auth_failed') {
        throw new DeviceError('invalid_response', 'device delete: unverified 403 response');
      }
    } else if (response.body !== null && response.body !== undefined && response.body !== '') {
      throw new DeviceError('invalid_response', 'device delete: 204 must have an empty body');
    }
    const remote = response.status === 204 ? 'remote_confirmed' : 'remote_unverified';
    setDeviceDeleteState(deps.driver, remote === 'remote_confirmed'
      ? 'cleanup_remote_confirmed' : 'cleanup_remote_unverified');
    await recoverPendingLocalDeletion(deps.driver, deps.secretStore);
    return { local: 'complete', remote };
  }).catch((error: unknown) => {
    // If the initial SQLite marker itself fails, no durable pause can be
    // claimed; nevertheless keep this process's senders stopped. Explicit
    // retry is the only release from this in-memory fallback.
    if (!barrierPersisted) {
      try {
        // An existing cleanup phase is already a durable barrier: allow the
        // normal restart path to retry it automatically when storage returns.
        if (!isDeviceDeletionPending(deps.driver)) blockAfterUnpersistedDelete(deps.driver);
      } catch {
        blockAfterUnpersistedDelete(deps.driver);
      }
    }
    throw error;
  }).finally(releaseRequest);
}
