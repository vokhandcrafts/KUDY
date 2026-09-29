// G08.03 — the closed mapping from a thrown store-session failure to one
// failure category. Single mapping point for the RC error vocabulary: the
// service (service.ts) and the expo adapter (expo/rc-port.ts) both refine
// through this file, so an outcome kind has exactly one producer.
//
// Platform fact (checked in node_modules/react-native-purchases 10.9.1, not
// assumed): rejections of purchaseProduct/restorePurchases/logIn carry a
// `code` whose value is the PURCHASES_ERROR_CODE string of
// @revenuecat/purchases-typescript-internal (dist/generated/error-codes.d.ts;
// the SDK's own cancellation check is `error.code ===
// PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR`, purchases.js line 436 —
// the code, not the deprecated `userCancelled` boolean, is the fact this
// module reads). The table below copies every enum value of the pinned
// version; a future SDK value that is absent here lands in `unknown` — fail
// closed (implementation-rules 14), never a guessed kind.
//
// Category decisions, once each: the store says the user backed out →
// cancelled; the payment is delayed (async approval) → payment-pending; the
// non-consumable is already owned → already-owned; the store or OS refuses
// the purchase (or the user is ineligible) → not-allowed; the product is not
// purchasable here → product-unavailable; the store or RevenueCat is
// unreachable or the operation is transiently busy → unavailable; a named
// failure of the store/RC side → store-problem with its code; a bug or
// misconfiguration of the app itself (RC credentials, the linked
// app_user_id, SDK configuration) → executor-error — an app defect, never a
// user answer (the `19` §3.6 idiom: grant's invalid_request is the same
// class). Codes without a user-meaningful distinction are store-problem.
export type StoreFailureCategory =
  | 'cancelled'
  | 'payment-pending'
  | 'already-owned'
  | 'not-allowed'
  | 'product-unavailable'
  | 'unavailable'
  | 'store-problem'
  | 'executor-error';

export interface StoreFailure {
  category: StoreFailureCategory;
  // The RC PURCHASES_ERROR_CODE value the category was read from — a stable
  // named fact, safe for diagnostics (no message text, no payload).
  code: string;
}

// The executor-error refinement: which app defect the code names. Absent
// entries refine to `configuration`.
const EXECUTOR_CODE_BY_RC: Record<string, 'invalid-credentials' | 'invalid-app-user'> = {
  '11': 'invalid-credentials',
  '14': 'invalid-app-user',
};

// Every PURCHASES_ERROR_CODE value of the pinned 10.9.1 enum, verbatim.
// Exported for the drift guard: the test deep-compares this key set against
// the enum list copied from the pinned package's error-codes.d.ts, so an SDK
// bump that adds a code fails the suite until the table decides its category.
export const CATEGORY_BY_CODE: Record<string, StoreFailureCategory> = {
  '0': 'store-problem',
  '1': 'cancelled',
  '2': 'store-problem',
  '3': 'not-allowed',
  '4': 'store-problem',
  '5': 'product-unavailable',
  '6': 'already-owned',
  '7': 'store-problem',
  '8': 'store-problem',
  '9': 'store-problem',
  '10': 'unavailable',
  '11': 'executor-error',
  '12': 'store-problem',
  '13': 'store-problem',
  '14': 'executor-error',
  '15': 'unavailable',
  '16': 'store-problem',
  '17': 'executor-error',
  '18': 'not-allowed',
  '19': 'executor-error',
  '20': 'payment-pending',
  '21': 'store-problem',
  '22': 'store-problem',
  '23': 'executor-error',
  '24': 'executor-error',
  '25': 'store-problem',
  '26': 'store-problem',
  '28': 'store-problem',
  '29': 'store-problem',
  '30': 'store-problem',
  '31': 'store-problem',
  '32': 'unavailable',
  '33': 'unavailable',
  '34': 'store-problem',
  '35': 'unavailable',
  '42': 'store-problem',
};

function sanitizeCodeToken(raw: string): string {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(raw) ? raw : 'raw';
}

// One thrown value → one closed answer. A recognized RC code yields its
// category; a thrown shape whose code is a string outside the closed table
// is `unknown` with the sanitized code named in the diagnostics; anything
// else (a plain Error, a string, null) is `unknown` with the shape
// diagnostic. Never throws (implementation-rules 14: corrupt input yields
// diagnostics, not a crash).
export function mapStoreFailure(
  thrown: unknown,
): StoreFailure | { kind: 'unknown'; diagnostics: string[] } {
  if (typeof thrown !== 'object' || thrown === null) {
    return { kind: 'unknown', diagnostics: ['store-error#shape'] };
  }
  const code = (thrown as Record<string, unknown>)['code'];
  if (typeof code !== 'string' || code === '') {
    return { kind: 'unknown', diagnostics: ['store-error#shape'] };
  }
  const category = CATEGORY_BY_CODE[code];
  if (category === undefined) {
    return {
      kind: 'unknown',
      diagnostics: [`store-error#unrecognized-code:${sanitizeCodeToken(code)}`],
    };
  }
  return { category, code };
}

// The executor-error literal for a recognized RC code; only meaningful when
// the category is executor-error.
export function executorCodeOf(code: string): 'invalid-credentials' | 'invalid-app-user' | 'configuration' {
  return EXECUTOR_CODE_BY_RC[code] ?? 'configuration';
}
