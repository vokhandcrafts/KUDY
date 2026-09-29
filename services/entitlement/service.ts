// G08.03 — services/entitlement: the store purchase session (19 §2.3 —
// «RevenueCat SDK + запыт сервернага гранта; не вырашае права сам | сесія
// пакупкі; restore асобны»). The service owns the honest closed outcomes of
// link/purchase/restore; the right itself is never its answer — after any
// finished transaction the only path to the right is the server grant
// (G08.02 /v1/grant), asked by the download chain (G08.04, `19` §6.4).
//
// Canon anchors, copied not paraphrased (implementation-rules 2): `09` §5.1 —
// the purchase runs with app_user_id = device_id, so every transaction is
// linked to the device account the grant endpoint authenticates (criterion
// 4); «Кліент ніколі не сцвярджае, што ён нешта купіў» — a finished
// transaction is a store-session fact, not a right; `09` §5.2 — products are
// non-consumable one-time purchases, restore is store-scoped and no part of
// the surface promises a cross-platform transfer.
//
// Ordering is part of the contract: purchase and restore refuse to run
// before the store account is linked to a registered device identity. The
// completed link is memoized per port and deviceId (a different deviceId
// re-links); concurrent first calls may each reach the store — the store's
// logIn for one app_user_id is idempotent, and only the finished outcome is
// remembered, unlike the inflight promise memo of services/device.ts.
import { UUID_PATTERN } from '../device.ts';
import {
  executorCodeOf,
  mapStoreFailure,
  type StoreFailure,
} from './store-error-mapping.ts';
import type {
  EntitlementDeps,
  PurchaseOutcome,
  RestoreOutcome,
  StoreIdentity,
  StoreLinkOutcome,
} from './types.ts';

// The linked state of one port: the deviceId the store account is currently
// linked to and the outcome that memoized it. Keyed by the port object, the
// same WeakMap idiom as the device registration's inflight map.
interface LinkMemo {
  deviceId: string;
  outcome: StoreLinkOutcome;
}

const links = new WeakMap<object, LinkMemo>();

function diagnosticOf(deps: EntitlementDeps): (line: string) => void {
  return (line) => deps.onDiagnostics?.(line);
}

// The boundary validation of the device identity: the deviceId must be the
// UUID shape POST /v1/device issues (G08.01). A corrupt identity — including
// a missing identity object — is rejected locally with diagnostics, never a
// thrown error, and no store call happens (implementation-rules 14).
function validateIdentity(identity: StoreIdentity): string[] {
  if (
    typeof identity !== 'object' ||
    identity === null ||
    typeof identity.deviceId !== 'string' ||
    !UUID_PATTERN.test(identity.deviceId)
  ) {
    return ['entitlement-link#device-id'];
  }
  return [];
}

// Refine one mapped store failure into the link/restore vocabulary
// (compile-exhaustive over the closed categories). Both sessions share one
// refinement: link and restore have no purchase-side semantics, so
// categories that name purchase outcomes land in the honest generic
// store-problem answer with their code. types.ts keeps the two outcome
// unions distinct on purpose; the refinement is written once (jscpd gate) —
// its answer type is the failure variants both unions share.
function sessionOutcomeOf(
  failure: StoreFailure,
):
  | { kind: 'unavailable' }
  | { kind: 'store-problem'; code: string }
  | { kind: 'executor-error'; code: 'invalid-app-user' | 'invalid-credentials' | 'configuration' } {
  switch (failure.category) {
    case 'unavailable':
      return { kind: 'unavailable' };
    case 'executor-error':
      return { kind: 'executor-error', code: executorCodeOf(failure.code) };
    case 'cancelled':
    case 'payment-pending':
    case 'already-owned':
    case 'not-allowed':
    case 'product-unavailable':
    case 'store-problem':
      return { kind: 'store-problem', code: failure.code };
  }
}

// Refine one mapped store failure into the purchase vocabulary
// (compile-exhaustive over the closed categories).
function purchaseOutcomeOf(failure: StoreFailure): PurchaseOutcome {
  switch (failure.category) {
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'payment-pending':
      return { kind: 'payment-pending' };
    case 'already-owned':
      return { kind: 'already-owned' };
    case 'not-allowed':
      return { kind: 'not-allowed' };
    case 'product-unavailable':
      return { kind: 'product-unavailable' };
    case 'unavailable':
      return { kind: 'unavailable' };
    case 'executor-error':
      return { kind: 'executor-error', code: executorCodeOf(failure.code) };
    case 'store-problem':
      return { kind: 'store-problem', code: failure.code };
  }
}

/**
 * Link the store account to the registered device (09 §5.1: app_user_id =
 * device_id) — the linking every transaction result needs before the grant
 * path can attribute it (criterion 4). Memoized per port for the linked
 * deviceId; a call with a different deviceId re-links (the account follows
 * the fresh identity). A corrupt identity is a local invalid-input answer —
 * no store call.
 */
export async function ensureStoreLink(
  deps: EntitlementDeps,
  identity: StoreIdentity,
): Promise<StoreLinkOutcome> {
  const diagnostics = validateIdentity(identity);
  if (diagnostics.length > 0) return { kind: 'invalid-input', diagnostics };

  const memo = links.get(deps.store);
  if (memo && memo.deviceId === identity.deviceId) return memo.outcome;

  try {
    const ack = await deps.store.link(identity.deviceId);
    if (typeof ack !== 'object' || ack === null || typeof ack.created !== 'boolean') {
      diagnosticOf(deps)('entitlement:link-failed kind=unknown');
      return { kind: 'unknown', diagnostics: ['entitlement-link#ack-shape'] };
    }
    const outcome: StoreLinkOutcome = { kind: 'linked', created: ack.created };
    links.set(deps.store, { deviceId: identity.deviceId, outcome });
    diagnosticOf(deps)(`entitlement:link created=${ack.created ? '1' : '0'}`);
    return outcome;
  } catch (thrown) {
    const mapped = mapStoreFailure(thrown);
    if ('kind' in mapped) {
      diagnosticOf(deps)('entitlement:link-failed kind=unknown');
      return { kind: 'unknown', diagnostics: mapped.diagnostics };
    }
    const outcome = sessionOutcomeOf(mapped);
    diagnosticOf(deps)(`entitlement:link-failed category=${mapped.category} code=${mapped.code}`);
    return outcome;
  }
}

// The local boundary rule for product identifiers: store product ids are
// reverse-DNS style ASCII tokens; anything else is rejected before any store
// call. Corrupt input yields diagnostics, never a store round-trip
// (implementation-rules 14).
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;

/**
 * Purchase one non-consumable product (09 §5.2), honestly: the closed
 * outcome names cancelled, payment-pending, already-owned, not-allowed,
 * product-unavailable, unavailability and store failures — and none of them
 * is a right. `transaction-finished` is the store session's own fact; the
 * right is the server grant's answer (G08.02), asked by the download chain.
 * Links the store account first; a failed link is returned as-is (criterion
 * 4: no transaction without the device link).
 */
export async function purchaseNonConsumable(
  deps: EntitlementDeps,
  identity: StoreIdentity,
  productId: string,
): Promise<PurchaseOutcome> {
  if (typeof productId !== 'string' || !PRODUCT_ID_PATTERN.test(productId)) {
    return { kind: 'invalid-input', diagnostics: ['entitlement-purchase#product-id'] };
  }
  const link = await ensureStoreLink(deps, identity);
  if (link.kind !== 'linked') {
    diagnosticOf(deps)(`entitlement:purchase kind=${link.kind}`);
    return link;
  }
  try {
    const ack = await deps.store.purchase(productId);
    if (
      typeof ack !== 'object' ||
      ack === null ||
      typeof ack.productId !== 'string' ||
      ack.productId !== productId
    ) {
      diagnosticOf(deps)('entitlement:purchase kind=unknown');
      return { kind: 'unknown', diagnostics: ['entitlement-purchase#ack-product-mismatch'] };
    }
    diagnosticOf(deps)('entitlement:purchase kind=transaction-finished');
    return { kind: 'transaction-finished', productId: ack.productId };
  } catch (thrown) {
    const mapped = mapStoreFailure(thrown);
    if ('kind' in mapped) {
      diagnosticOf(deps)('entitlement:purchase kind=unknown');
      return { kind: 'unknown', diagnostics: mapped.diagnostics };
    }
    const outcome = purchaseOutcomeOf(mapped);
    diagnosticOf(deps)(
      `entitlement:purchase-failed category=${mapped.category} code=${mapped.code}`,
    );
    return outcome;
  }
}

/**
 * The same-store restore pass (09 §5.2: the store account of the same store
 * on a new device; cross-platform transfer is Phase 2 `/v1/link` and no part
 * of this surface promises it). `restore-finished` says the store pass
 * completed — what it restored is decided by the grant path, never here
 * (09 §5.1). Links the store account first; a failed link is returned as-is.
 */
export async function restoreEntitlements(
  deps: EntitlementDeps,
  identity: StoreIdentity,
): Promise<RestoreOutcome> {
  const link = await ensureStoreLink(deps, identity);
  if (link.kind !== 'linked') {
    diagnosticOf(deps)(`entitlement:restore kind=${link.kind}`);
    return link;
  }
  try {
    const ack = await deps.store.restore();
    if (typeof ack !== 'object' || ack === null || ack.kind !== 'restored') {
      diagnosticOf(deps)('entitlement:restore kind=unknown');
      return { kind: 'unknown', diagnostics: ['entitlement-restore#ack-shape'] };
    }
    diagnosticOf(deps)('entitlement:restore kind=restore-finished');
    return { kind: 'restore-finished' };
  } catch (thrown) {
    const mapped = mapStoreFailure(thrown);
    if ('kind' in mapped) {
      diagnosticOf(deps)('entitlement:restore kind=unknown');
      return { kind: 'unknown', diagnostics: mapped.diagnostics };
    }
    const outcome = sessionOutcomeOf(mapped);
    diagnosticOf(deps)(
      `entitlement:restore-failed category=${mapped.category} code=${mapped.code}`,
    );
    return outcome;
  }
}
