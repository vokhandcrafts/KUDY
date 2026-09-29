// G08.03 — services/entitlement contract types. Canonical anchors, copied not
// paraphrased (implementation-rules 2):
// `09` §5.1 — «Пакупка ў дадатку (RevenueCat SDK, app_user_id = device_id)»;
// the SDK sends the receipt synchronously, and the server — not the client —
// verifies the entitlement at the moment of the grant; «Кліент ніколі не
// сцвярджае, што ён нешта купіў. Ён просіць грант; вырашае сервер, спытаўшы
// RevenueCat. Лакальны сцяг "купілі" — не крыніца праўды»; «Пры часовым збоі
// праверкі кліент захоўвае "куплена, доступ рыхтуецца" і прапануе паўтор
// праверкі/загрузкі, не паўторную аплату».
// `09` §5.2 — «Прадукты ROUTE і ROUTE_EXTENSION у сторах ствараюцца як
// non-consumable one-time purchases»; restore works for the same store on a
// new device («рэстор праз store-акаўнт без рэгістрацыі»); a cross-platform
// transfer needs /v1/link and is NOT in MVP — nothing on this surface
// promises a cross-store right transfer.
// `19` §2.3 — the module row: «RevenueCat SDK + запыт сервернага гранта; не
// вырашае права сам | сесія пакупкі; restore асобны».
//
// Name boundary: the store session port answers in the service vocabulary of
// the closed outcome unions below; the closed RC-code table that produces
// them lives in store-error-mapping.ts and is the single mapping point. The
// right itself is never a result of this module: `transaction-finished` and
// `restore-finished` are store-session facts, and the only path to the right
// is the server grant (G08.02 /v1/grant, wired into the chain by G08.04).

// The device identity the store account is linked to (09 §5.1:
// app_user_id = device_id). The deviceId is the UUID issued by POST /v1/device
// (G08.01) — validated again at this boundary before any store call.
export interface StoreIdentity {
  deviceId: string;
}

// Raw store-session acknowledgements — the facts the SDK resolves with,
// stripped of everything this module must not trust. CustomerInfo is
// deliberately not surfaced: entitlements in it are not the client's truth
// (09 §5.1), the grant path decides.
export interface StoreLinkAck {
  // RevenueCat logIn fact: whether the RC subscriber was created fresh.
  // Diagnostics only; carries no entitlement meaning.
  created: boolean;
}

export interface StorePurchaseAck {
  // The product identifier the store finished the transaction for. A value
  // that differs from the requested productId is outside the contract and
  // fails closed (unknown), never reported as finished.
  productId: string;
}

// restorePurchases resolves with customer info the service does not inspect;
// the ack is intentionally empty (09 §5.1: the client never claims rights).
export interface StoreRestoreAck {
  kind: 'restored';
}

// The injected store session (react-native-purchases on the device — the
// expo/ adapter is the only module importing it at runtime; tests use the
// fake in fake-port.ts). The SDK is configured (configure({apiKey})) by the
// composition root before any call; an unconfigured SDK surfaces as the
// closed `unknown` outcome, fail closed. Every method may reject with the
// raw store failure — the closed mapping (store-error-mapping.ts) converts
// it; a rejection is a mapped outcome, never an exception to the caller.
export interface StoreSessionPort {
  // Links every later transaction to the device account (09 §5.1:
  // app_user_id = device_id). Called by the service before any purchase or
  // restore; a re-link with a different deviceId switches the account.
  link(appUserId: string): Promise<StoreLinkAck>;
  // Purchases the named non-consumable product (09 §5.2). The product type
  // is the store catalog's configuration (operator work), not a purchase
  // argument — the surface is named for non-consumables and the app never
  // consumes transactions.
  purchase(productId: string): Promise<StorePurchaseAck>;
  // The same-store restore pass (09 §5.2). Store-scoped by the device's own
  // store: rights of the other store do not transfer, and no part of this
  // surface promises otherwise.
  restore(): Promise<StoreRestoreAck>;
}

// The link outcome of one ensureStoreLink round. `linked` is memoized per
// port for the linked deviceId; every other kind is a retryable answer.
export type StoreLinkOutcome =
  | { kind: 'linked'; created: boolean }
  // RC rejects the app_user_id or its own credentials — a configuration or
  // linking bug of the app, never a user answer (the `19` §3.6 idiom of
  // grant's invalid_request).
  | { kind: 'executor-error'; code: 'invalid-app-user' | 'invalid-credentials' | 'configuration' }
  | { kind: 'unavailable' }
  | { kind: 'store-problem'; code: string }
  | { kind: 'invalid-input'; diagnostics: string[] }
  | { kind: 'unknown'; diagnostics: string[] };

// One purchase attempt of a non-consumable product, in the honest closed
// vocabulary (criterion 1: cancel/error/delay are nameable states and none
// of them is "purchased"). No kind here grants or asserts a right — the
// finished transaction only says the store session completed; the right is
// the server grant's answer (G08.02), asked by the download chain (G08.04).
export type PurchaseOutcome =
  | { kind: 'transaction-finished'; productId: string }
  | { kind: 'cancelled' }
  | { kind: 'payment-pending' }
  | { kind: 'already-owned' }
  | { kind: 'not-allowed' }
  | { kind: 'product-unavailable' }
  | { kind: 'unavailable' }
  | { kind: 'store-problem'; code: string }
  | { kind: 'executor-error'; code: 'invalid-app-user' | 'invalid-credentials' | 'configuration' }
  | { kind: 'invalid-input'; diagnostics: string[] }
  | { kind: 'unknown'; diagnostics: string[] };

// One same-store restore pass (criterion 2). `restore-finished` says the
// store pass completed — what it restored is decided by the grant path, and
// TRANSFERs/aliases are RevenueCat's own work (09 §5.1). Store-scoped: the
// outcome carries no cross-platform meaning (09 §5.2 — /v1/link is Phase 2).
export type RestoreOutcome =
  | { kind: 'restore-finished' }
  | { kind: 'unavailable' }
  | { kind: 'store-problem'; code: string }
  | { kind: 'executor-error'; code: 'invalid-app-user' | 'invalid-credentials' | 'configuration' }
  | { kind: 'invalid-input'; diagnostics: string[] }
  | { kind: 'unknown'; diagnostics: string[] };

export interface EntitlementDeps {
  store: StoreSessionPort;
  // Named diagnostic lines only (the grant client idiom): no SDK message, no
  // store payload, no identifier beyond the kinds and codes of the closed
  // vocabulary. Absent by default — the service never logs on its own.
  onDiagnostics?: (line: string) => void;
}
