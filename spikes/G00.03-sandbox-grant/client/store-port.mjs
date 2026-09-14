// Store port (client side).
//
//   purchase({ productId, deviceId }) → { ok: true } | { ok: false, reason }
//   restore({ productId, deviceId })  → { ok: true } | { ok: false, reason }
//
// The real adapters (Apple StoreKit 2 / Google Play Billing via the
// RevenueCat SDK) are integration points documented in README; this spike
// ships only the test transport below. Every transport answer must come from
// the underlying store model — a transport never fabricates success, so a
// failing store cannot be talked into a fake entitlement (no fail-open).

// Test-only store + entitlement model shared by the client transport and the
// server-side test provider. Purchases are held per store account; a device
// is bound to an account by purchase/restore, which models the store account
// migration a restore performs on a fresh install.
export function createTestStoreSim({ environment = 'sandbox' } = {}) {
  const purchases = new Map();
  const deviceAccounts = new Map();
  let available = true;
  let payments = 0;
  return {
    environment,
    payments: () => payments,
    setAvailable(value) {
      available = value;
    },
    purchase(account, productId) {
      if (!available) return { ok: false, reason: 'store_unavailable' };
      const key = `${account}:${productId}`;
      if (!purchases.has(key)) {
        payments += 1;
        purchases.set(key, { environment, paid_at: Date.now() });
      }
      return { ok: true };
    },
    restore(account, productId) {
      if (!available) return { ok: false, reason: 'store_unavailable' };
      if (!purchases.has(`${account}:${productId}`)) return { ok: false, reason: 'nothing_to_restore' };
      return { ok: true, restored: true };
    },
    bindDevice(deviceId, account) {
      deviceAccounts.set(deviceId, account);
    },
    entitlementFor(deviceId, productId) {
      if (!available) return 'unavailable';
      const account = deviceAccounts.get(deviceId);
      if (!account) return null;
      return purchases.get(`${account}:${productId}`) ?? null;
    },
  };
}

export function createTestStorePort({ store, storeAccount }) {
  return {
    async purchase({ productId, deviceId }) {
      const result = store.purchase(storeAccount, productId);
      if (result.ok) store.bindDevice(deviceId, storeAccount);
      return result;
    },
    async restore({ productId, deviceId }) {
      const result = store.restore(storeAccount, productId);
      if (result.ok) store.bindDevice(deviceId, storeAccount);
      return result;
    },
  };
}
