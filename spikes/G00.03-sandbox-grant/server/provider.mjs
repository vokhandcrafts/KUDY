// Entitlement provider port (docs/architecture/09 §5.1 corrected flow).
//
//   verifyEntitlement({ deviceId, productId }) returns one of:
//   { ok: true, entitled: boolean, environment: 'sandbox' | 'production' }
//   { ok: false, reason: 'unavailable', detail? }
//
// The server asks the provider about the AUTHENTICATED device only
// (app_user_id = device_id; RevenueCat resolves aliases and TRANSFERs itself
// — the spike keeps no alias table). Any "unavailable" answer must fail
// closed (HTTP 503), never grant.

// RevenueCat REST adapter. UNVERIFIED OFFLINE: this spike task had no network
// access, so the request shape follows the documented REST contract as of
// writing and MUST be confirmed against the live API in G00.03.c. Until then
// the adapter is never exercised by tests or the demo; an answer that cannot
// be attributed to a concrete environment fails closed instead of guessing.
export function createRevenueCatProvider({
  secretApiKey,
  baseUrl = 'https://api.revenuecat.com',
}) {
  if (!secretApiKey) throw new Error('env REVENUECAT_SECRET_API_KEY is required for the live provider');
  return {
    async verifyEntitlement({ deviceId, productId }) {
      let response;
      try {
        response = await fetch(
          `${baseUrl.replace(/\/$/, '')}/v1/subscribers/${encodeURIComponent(deviceId)}`,
          {
            headers: {
              Authorization: `Bearer ${secretApiKey}`,
              Accept: 'application/json',
            },
          },
        );
      } catch {
        return { ok: false, reason: 'unavailable', detail: 'network_error' };
      }
      if (response.status === 401) {
        return { ok: false, reason: 'unavailable', detail: 'server_credential_rejected' };
      }
      if (response.status === 404) {
        return { ok: true, entitled: false, environment: null };
      }
      if (!response.ok) {
        return { ok: false, reason: 'unavailable', detail: `http_${response.status}` };
      }
      let subscriber;
      try {
        subscriber = await response.json();
      } catch {
        return { ok: false, reason: 'unavailable', detail: 'bad_payload' };
      }
      const entitled = Object.values(subscriber?.subscriber?.entitlements ?? {})
        .some((entitlement) => entitlement?.product_id === productId);
      if (!entitled) return { ok: true, entitled: false, environment: null };
      // Sandbox/production attribution is not part of this endpoint's
      // documented payload; verify how to read it in G00.03.c.
      return { ok: false, reason: 'unavailable', detail: 'environment_undeterminable' };
    },
  };
}

// Test transport. Only ever wired by test/ suites and demo scripts; npm start
// (live mode) never constructs it, so a test provider cannot serve a
// "production" run. It models a store that holds purchases per store account
// and binds devices to accounts on purchase/restore (restore = TRANSFER).
export function createTestProvider({ store }) {
  return {
    async verifyEntitlement({ deviceId, productId }) {
      const answer = store.entitlementFor(deviceId, productId);
      if (answer === 'unavailable') return { ok: false, reason: 'unavailable' };
      if (!answer) return { ok: true, entitled: false, environment: store.environment };
      return { ok: true, entitled: true, environment: answer.environment };
    },
  };
}
