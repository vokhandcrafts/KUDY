// G08.04 — the client purchase chain: аплата → загрузка → AccessReady
// (19 §6.4 scenario «Пакупка → загрузка падае → рэтрай → той самай версіі
// актывацыя»). One unlock() call runs the whole chain over the production
// modules: the store session (service.ts), the grant client and the
// activation core (services/download) — the only AccessReady issuer
// (ADR G01.03 §3.5), reached through the one access port the engine
// subscribes to.
//
// Canon anchors, copied not paraphrased (implementation-rules 2): `09` §5.1 —
// «Кліент ніколі не сцвярджае, што ён нешта купіў»; the server grant is the
// only path to the right; «Пры часовым збоі праверкі кліент захоўвае
// «куплена, доступ рыхтуецца» і прапануе паўтор праверкі/загрузкі, не
// паўторную аплату». `11` §8 — «Пасля аплаты: «Куплена · трэба загрузіць»,
// пакуль сервер не выдаў доступ і загрузка цалкам не правераная. Паўтор
// загрузкі не патрабуе паўторнай аплаты»; «Адкрыццё доступу не скідае
// прагрэс і не запускае аўдыё». G08.03 notes — `already-owned` is the
// store's own «не бярэм грошай другі раз», the foundation of the no-re-offer
// rule.
//
// The chain's state is the honest client-side purchase fact, never a right:
// 'paid' says the store session finished (or the store refused a second
// charge) and the download is pending or failed — the next action is a
// download retry, never Buy. It lives in memory per chain instance: the
// durable truth is the server's (19 §4.2 — «кліенцкае „куплена" — не
// крыніца»; the server keeps the positive-entitlement cache), and after an
// app restart a repeated unlock goes through the store again, whose
// non-consumable protection answers already-owned without a second charge.
// Readiness is deliberately not part of this state either: the disk owns it
// (ADR G01.03 §3.2/§3.6 — no ready flag), so every unlock re-runs the
// activation — idempotent, resumed by hash, zero fetches for a complete
// layer — and the 'ready' state only ever gates the purchase offer.
import { UUID_PATTERN } from '../device.ts';
import { activate, parseActivationInput, validateKey } from '../download/download.ts';
import { createGrantFetchSource, type GrantFetchDeps } from '../download/grant.ts';
import type { DownloadAccessPort } from '../download/access.ts';
import type { ActivationResult, DownloadStore, LayerKey, Sha256 } from '../download/types.ts';
import type { SqlDriver } from '../db/types.ts';
import { PRODUCT_ID_PATTERN, purchaseNonConsumable } from './service.ts';
import type { PurchaseOutcome, StoreIdentity, StoreSessionPort } from './types.ts';

// The honest client-side states of one product's chain. 'not-owned' — the
// purchase path may be offered; 'paid' — «Куплена · трэба загрузіць»: the
// store session finished and the verified access is still missing, whatever
// the download answered; 'ready' — the last activation completed with
// verified files (the port delivered AccessReady). Download failures of
// every kind land on 'paid' — the owned fact never regresses to 'not-owned'
// here; the refund/transfer policy is G08.06's decision, not this module's.
export type PurchaseChainState = 'not-owned' | 'paid' | 'ready';

export interface PurchaseChainDeps {
  // The store session the purchase runs through (service.ts contract).
  store: StoreSessionPort;
  // The activation core's ports (services/download): the bundles store over
  // the 09 §7 layout, the digest, the zone A driver and the one AccessReady
  // port the engine subscribes to (ADR G01.03 §3.5 — the composition root
  // hands the same instance to the run orchestrator).
  bundlesStore: DownloadStore;
  sha256: Sha256;
  driver: SqlDriver;
  access: DownloadAccessPort;
  // The grant client's ports (services/download/grant.ts): the transport,
  // credential, byte fetch, delay and clock the signed-URL source uses. The
  // expired-URL renewal (09 §5.1 re-mint, 403 url_expired re-grant) is the
  // source's own work — the chain never re-purchases for it.
  grant: GrantFetchDeps;
  // Named diagnostic lines only (the grant/entitlement idiom) — no store
  // message, no URL, no payload.
  onDiagnostics?: (line: string) => void;
}

export interface UnlockInput {
  identity: StoreIdentity;
  // The non-consumable product the store session charges (09 §5.2). The
  // product → route/tier correspondence is the route document's fact
  // (`product_id_route` / `product_id_extension`, contracts route schema);
  // the server re-checks it at the grant (no_entitlement otherwise).
  productId: string;
  // The layer to download and unlock: the pinned session identity in
  // production (11 §8 — the extension must match the session version).
  key: LayerKey;
  lock: unknown;
}

// The closed outcome of one unlock() call — every kind names the next
// honest action for the surface: 'ready' is the unlocked layer (the
// AccessReady event has been delivered by the activation commit itself),
// 'download-incomplete' keeps the state at paid — retry the download, never
// Buy; 'purchase-not-finished' passes the store's own honest answer through
// and the purchase path stays available; 'invalid-input' rejected the
// request before any store, grant or filesystem call.
export type UnlockOutcome =
  | { kind: 'ready'; state: 'ready' }
  | { kind: 'download-incomplete'; state: 'paid'; result: ActivationResult }
  | { kind: 'purchase-not-finished'; state: 'not-owned'; outcome: PurchaseOutcome }
  | { kind: 'invalid-input'; state: PurchaseChainState; diagnostics: string[] };

export interface PurchaseChain {
  // The full chain for one product/layer pair. Purchase happens only from
  // the 'not-owned' state; from 'paid'/'ready' the store is never called
  // again (criterion 1 — a download failure never re-offers the purchase)
  // and the activation runs as the retry, resumed by hash. The activation
  // itself runs on every call: the disk owns readiness (ADR G01.03 §3.2,
  // §3.6), a complete layer re-activates with zero fetches, and a new
  // release (another version) activates under its own package key — never
  // substituting the open session's content (the engine ignores a
  // foreign-version AccessReady, ADR G01.03 §3.5).
  unlock(input: UnlockInput): Promise<UnlockOutcome>;
  // The current honest state of one product's chain.
  stateOf(productId: string): PurchaseChainState;
}

// The per-product state of one chain instance, in memory (see the header:
// the durable truth is the server's; the store's non-consumable protection
// covers the across-restart path). The in-flight memo of a running unlock
// (the services/device.ts idiom) keeps the promise only while it runs, so a
// double-tap never reaches the store, the grant or the same staging path
// twice — a settled unlock frees the product and a later call runs a fresh
// chain, which is exactly the retry semantics.
export function createPurchaseChain(deps: PurchaseChainDeps): PurchaseChain {
  const states = new Map<string, PurchaseChainState>();
  const inflight = new Map<string, Promise<UnlockOutcome>>();
  const diagnostic = (line: string): void => deps.onDiagnostics?.(line);
  const stateOf = (productId: string): PurchaseChainState => states.get(productId) ?? 'not-owned';

  async function runUnlock(input: UnlockInput): Promise<UnlockOutcome> {
    if (input === null || typeof input !== 'object') {
      return { kind: 'invalid-input', state: 'not-owned', diagnostics: ['chain#request-shape'] };
    }
    // Boundary validation before any side effect (implementation-rules
    // 14): the identity shape (the UUID POST /v1/device issues), the
    // product id (the same pattern the store session enforces — the
    // single copy exported from service.ts) and the layer key (the
    // shared contentRepo guard). A corrupt request is a named local
    // answer; the store, the grant and the filesystem are untouched.
    const diagnostics: string[] = [];
    if (
      typeof input.identity !== 'object' ||
      input.identity === null ||
      typeof input.identity.deviceId !== 'string' ||
      !UUID_PATTERN.test(input.identity.deviceId)
    ) {
      diagnostics.push('chain#device-id');
    }
    if (typeof input.productId !== 'string' || !PRODUCT_ID_PATTERN.test(input.productId)) {
      diagnostics.push('chain#product-id');
    }
    const key: LayerKey = {
      routeId: input.key?.routeId ?? '',
      version: input.key?.version ?? '',
      locale: input.key?.locale ?? '',
      tier: input.key?.tier ?? '',
    };
    if (validateKey(key).length > 0) diagnostics.push('chain#layer-key');
    // The lock is validated through the activation core's own prologue —
    // the same guard the grant client and activate() trust — so a corrupt
    // lock is refused before the purchase, never after the user has paid.
    const parsed = parseActivationInput({ ...key, lock: input.lock });
    if (parsed.invalid) diagnostics.push('chain#lock');
    if (diagnostics.length > 0) {
      return { kind: 'invalid-input', state: stateOf(input.productId), diagnostics };
    }
    const identity: StoreIdentity = input.identity;
    const productId: string = input.productId;
    const { lock } = input;

    // The purchase leg (criterion 1). From 'paid'/'ready' the store is
    // never called again: the owned fact stands whatever the download
    // answered, and the retry below is a download, not a Buy. The
    // 'not-owned' pass takes the store's own honest answer: a finished
    // transaction — or the store's own «не бярэм грошай другі раз»
    // (already-owned) — marks the product paid; every other kind is
    // passed through untouched and the purchase path stays available.
    if (stateOf(productId) === 'not-owned') {
      const outcome = await purchaseNonConsumable({ store: deps.store }, identity, productId);
      diagnostic(`chain:purchase kind=${outcome.kind}`);
      if (outcome.kind !== 'transaction-finished' && outcome.kind !== 'already-owned') {
        return { kind: 'purchase-not-finished', state: 'not-owned', outcome };
      }
      states.set(productId, 'paid');
    } else {
      diagnostic(`chain:purchase-skip state=${stateOf(productId)}`);
    }

    // The download leg: grant + staging + per-file hash + atomic rename,
    // through the production activation core. The signed-URL source
    // re-mints expired portions and re-grants a 403 url_expired mid-flight
    // (09 §5.1) — criterion 2 without any second purchase. Only the core's
    // own 'complete' — every file hash-verified and renamed — turns the
    // state ready (criterion 3); the AccessReady event is the commit's
    // own emission through the port, never the chain's.
    const fetch = createGrantFetchSource({ key, entries: parsed.entries }, deps.grant);
    const result = await activate(
      { ...key, lock },
      {
        store: deps.bundlesStore,
        fetch,
        sha256: deps.sha256,
        driver: deps.driver,
        access: deps.access,
      },
    );
    diagnostic(`chain:activation status=${result.status}`);
    if (result.status === 'complete') {
      states.set(productId, 'ready');
      return { kind: 'ready', state: 'ready' };
    }
    // Every failure category — partial, hash-mismatch, insufficient-space,
    // invalid-input, cancelled — keeps the owned fact: the state lands on
    // 'paid' (from 'ready' too: the disk truth regressed, so the verified
    // access is gone until a retry completes), and the next action is the
    // download retry.
    states.set(productId, 'paid');
    return { kind: 'download-incomplete', state: 'paid', result };
  }

  return {
    stateOf,
    unlock(input: UnlockInput): Promise<UnlockOutcome> {
      // The in-flight memo (the services/device.ts idiom), keyed by the
      // product AND the layer identity: concurrent unlocks of the same
      // product/layer pair share one chain run — the store session, the
      // grant and the staging path are single-consumer. Overlapping unlocks
      // of one product with DIFFERENT layers are not the same request: each
      // runs its own chain (the store's non-consumable protection answers
      // already-owned for the second charge), so a retry of v1 and a v2
      // arrival never swallow each other's result. The memo holds the
      // promise only while it runs; a settled unlock (any outcome) frees
      // its key, so a later call runs a fresh chain — the retry semantics
      // never change. A request-shaped input is needed even to find the
      // memo: anything else is the named local invalid-input answer, with
      // nothing running at all.
      const memoKey =
        input !== null && typeof input === 'object' && typeof input.productId === 'string'
          ? `${input.productId}#${JSON.stringify([
              input.key?.routeId,
              input.key?.version,
              input.key?.locale,
              input.key?.tier,
            ])}`
          : null;
      const running = memoKey !== null ? inflight.get(memoKey) : undefined;
      if (running !== undefined) return running;
      const run = runUnlock(input);
      if (memoKey !== null) {
        inflight.set(memoKey, run);
        void run.then(
          () => {
            if (inflight.get(memoKey) === run) inflight.delete(memoKey);
          },
          () => {
            if (inflight.get(memoKey) === run) inflight.delete(memoKey);
          },
        );
      }
      return run;
    },
  };
}
