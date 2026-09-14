// Minimal purchase/restore/grant/download client for the G00.03.a spike.
//
// Contract mirrors of docs/architecture/09 §5:
// - the client never asserts a purchase: after the store action it asks
//   /v1/grant and the server decides (a local "bought" flag is cosmetic UI
//   state, never sent anywhere);
// - the grant request carries {route_id, version, locale, tier, paths} only —
//   no product_id (the server maps route_id × tier itself) and no user_id
//   (the entitlement is looked up for the authenticated device identity).

// The Bearer device secret crosses this connection, so a non-loopback base
// URL must be https; plain http is tolerated only for loopback test targets.
function assertSecureBaseUrl(serverBaseUrl) {
  let parsed;
  try {
    parsed = new URL(serverBaseUrl);
  } catch {
    throw new Error('serverBaseUrl must be a valid URL');
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback)) return;
  throw new Error('serverBaseUrl must use https; http is allowed only for loopback test targets');
}

export function createPurchaseClient({ serverBaseUrl, storePort, fetchImpl = fetch }) {
  assertSecureBaseUrl(serverBaseUrl);
  const base = serverBaseUrl.replace(/\/$/, '');
  let device = null;
  let boughtFlag = false;

  function requireDevice() {
    if (!device) throw new Error('client is not registered; call register() first');
    return device;
  }

  async function register() {
    const response = await fetchImpl(`${base}/v1/device`, { method: 'POST' });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.device_id || !body?.device_secret) {
      throw new Error(`device registration failed (${response.status})`);
    }
    device = { deviceId: body.device_id, deviceSecret: body.device_secret };
    return device;
  }

  function authHeader() {
    const { deviceSecret } = requireDevice();
    return `Bearer ${deviceSecret}`;
  }

  async function requestGrant({ routeId, version, locale, tier, paths }) {
    const response = await fetchImpl(`${base}/v1/grant`, {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ route_id: routeId, version, locale, tier, paths }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, code: body?.error?.code };
    return { ok: true, lockUrl: body.lock_url, urls: body.urls };
  }

  async function runStoreAction(stage, storeAction, { productId, ...catalogRequest }) {
    requireDevice();
    const result = await storeAction({ productId, deviceId: device.deviceId });
    if (!result.ok) return { ok: false, stage, reason: result.reason };
    boughtFlag = true;
    return requestGrant(catalogRequest);
  }

  async function download(file) {
    const response = await fetchImpl(`${base}${file.url}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { ok: false, status: response.status, code: body?.error?.code };
    }
    return { ok: true, bytes: Buffer.from(await response.arrayBuffer()) };
  }

  return {
    register,
    purchaseAndGrant: (request) =>
      runStoreAction('purchase', (args) => storePort.purchase(args), request),
    restoreAndGrant: (request) =>
      runStoreAction('restore', (args) => storePort.restore(args), request),
    requestGrant,
    download,
    markBoughtWithoutPurchase: () => {
      boughtFlag = true;
    },
    bought: () => boughtFlag,
    deviceId: () => device?.deviceId ?? null,
  };
}
