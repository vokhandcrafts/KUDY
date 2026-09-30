// G08.05 (issue #292) — the commerce controller's acceptance suite.
// Criteria:
// 1. the offer renders only in its allowed place — the derivation never
//    offers on a free route, without a product fact or without the port,
//    and the Run surface never receives the card (its render absence is
//    proven in app/run.test.tsx);
// 2. Continue free works after repeated purchase errors — every error
//    state carries both exits, the app keeps working, the offer stays;
// 3. the impression is the render fact, not the mount — exactly one
//    extension_offer_shown per visibility period, never before the layout;
// 4. the decline is respected — after dismiss the same offer never returns
//    in the same context (the revert-proof: removing the dismissal branch
//    in deriveOffer fails criterion 4);
// + the verbatim event shapes (implementation-rules 2: the records copy
//   contracts/events/event-table.v1.json — snake_case at the boundary, the
//   reason enum narrowed to the failed event, purchase_started carrying the
//   offer_id per the join rule) and the closed-outcome mapping without
//   crashes on out-of-union shapes (implementation-rules 14).
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCommerceController,
  deriveOffer,
  purchaseFailureReason,
  type CommerceControllerState,
  type CommerceEventRecord,
  type CommercePort,
  type PurchaseFailureReason,
  type TelemetryPort,
} from './commerceController.ts';
import type { ControllerStore } from '../createControllerStore.ts';
import type { PurchaseChainState } from '../../services/entitlement/purchase-chain.ts';
import type { PurchaseOutcome } from '../../services/entitlement/types.ts';

// Deterministic mints: the uuid shape the table's common fields require,
// the ISO clock, per-fixture counters for the join identifiers.
const EVENT_SEQ = { n: 0 };
const mintEventId = (): string => `00000000-0000-4000-8000-${String(++EVENT_SEQ.n).padStart(12, '0')}`;
const NOW_ISO = '2026-09-30T00:00:00.000Z';

interface Fixture {
  readonly events: CommerceEventRecord[];
  readonly purchases: string[];
  readonly chain: { state: PurchaseChainState };
  readonly port: CommercePort;
  readonly telemetry: TelemetryPort;
  readonly controller: (overrides?: Partial<CommercePort>) => ControllerStore<CommerceControllerState>;
}

function fixture(answer: PurchaseOutcome, initialChain: PurchaseChainState = 'not-owned'): Fixture {
  const events: CommerceEventRecord[] = [];
  const purchases: string[] = [];
  const chain = { state: initialChain };
  const port: CommercePort = {
    stateOf: (productId) => (purchases.includes(productId) ? 'paid' : chain.state),
    purchase: async (productId) => {
      purchases.push(productId);
      return answer;
    },
  };
  const telemetry: TelemetryPort = { record: (event) => events.push(event) };
  let attemptN = 0;
  const mintAttemptId = (): string => `attempt-${++attemptN}`;
  let offerN = 0;
  const mintOfferId = (): string => `offer-${++offerN}`;
  const controller = (overrides: Partial<CommercePort> = {}) =>
    createCommerceController({
      port: { ...port, ...overrides },
      telemetry,
      routeId: 'guide-route-a1',
      mintEventId,
      mintAttemptId,
      mintOfferId,
      now: () => NOW_ISO,
    });
  return { events, purchases, chain, port, telemetry, controller };
}

test('deriveOffer: the visibility table (the Proof target)', () => {
  const paid = { access: 'paid' as const, productId: 'com.kudy.route.a1', chainState: 'not-owned' as const };
  // The paid route with the product fact offers; free never does; the
  // mixed extension offer is the consciously deferred case.
  assert.equal(deriveOffer(paid), 'offered');
  assert.equal(deriveOffer({ ...paid, access: 'free' }), 'none');
  assert.equal(deriveOffer({ ...paid, access: 'mixed' }), 'none');
  // No product fact from the route document — no offer, fail closed.
  assert.equal(deriveOffer({ ...paid, productId: null }), 'none');
  // The decline is respected; the chain's paid state wins over it (the
  // owned fact is not an offer), 'ready' renders nothing commerce.
  assert.equal(deriveOffer({ ...paid, dismissed: true }), 'dismissed');
  assert.equal(deriveOffer({ ...paid, chainState: 'paid' as const, dismissed: true }), 'paid');
  assert.equal(deriveOffer({ ...paid, chainState: 'ready' as const, dismissed: true }), 'none');
});

test('purchaseFailureReason: the closed outcomes land on the table enum, verbatim', () => {
  const cases: ReadonlyArray<[PurchaseOutcome['kind'], PurchaseFailureReason]> = [
    ['cancelled', 'user_cancelled'],
    ['payment-pending', 'payment_failed'],
    ['not-allowed', 'payment_failed'],
    ['product-unavailable', 'payment_failed'],
    ['store-problem', 'payment_failed'],
    ['unavailable', 'verification_unavailable'],
    ['executor-error', 'verification_unavailable'],
    ['invalid-input', 'verification_unavailable'],
    ['unknown', 'verification_unavailable'],
  ];
  for (const [kind, reason] of cases) {
    const outcome = (kind === 'store-problem' ? { kind, code: 'x' } : kind === 'unknown' || kind === 'invalid-input' || kind === 'executor-error' ? { kind, diagnostics: ['d'] } : { kind }) as PurchaseOutcome;
    assert.equal(purchaseFailureReason(outcome), reason, kind);
  }
  // The success kinds answer without crashing (they are split by the
  // controller first; a defensive default keeps rule 14's no-crash rule).
  assert.equal(purchaseFailureReason({ kind: 'transaction-finished', productId: 'p' }), 'verification_unavailable');
  assert.equal(purchaseFailureReason({ kind: 'already-owned' }), 'verification_unavailable');
});

test('AC3: the impression is the render fact — one shown per period, none on the mount', () => {
  const rig = fixture({ kind: 'cancelled' });
  const controller = rig.controller();
  controller.getState().sync({ access: 'paid', productId: 'com.kudy.route.a1' });
  // The mount alone records nothing (the state derives 'offered', the
  // layout fact has not arrived).
  assert.equal(controller.getState().offer, 'offered');
  assert.equal(rig.events.length, 0);
  controller.getState().markRendered();
  controller.getState().markRendered();
  const shown = rig.events.filter((event) => event.type === 'extension_offer_shown');
  assert.equal(shown.length, 1);
  assert.deepEqual(
    { ...shown[0], event_id: '…', at: '…' },
    {
      type: 'extension_offer_shown',
      event_id: '…',
      at: '…',
      schema_version: 1,
      route_id: 'guide-route-a1',
      offer_id: 'offer-1',
    },
  );
  assert.ok(/^[0-9a-f-]{36}$/.test(shown[0].event_id));
  assert.equal(shown[0].at, NOW_ISO);
  // A new visibility period re-arms: nothing here does (the card stayed
  // visible), so still exactly one.
  controller.getState().sync({ access: 'paid', productId: 'com.kudy.route.a1' });
  controller.getState().markRendered();
  assert.equal(rig.events.filter((event) => event.type === 'extension_offer_shown').length, 1);
});

test('AC3/AC4: dismiss spends the offer — no return in the same context, no further events', async () => {
  const rig = fixture({ kind: 'cancelled' });
  const controller = rig.controller();
  const state = controller.getState();
  state.sync({ access: 'paid', productId: 'com.kudy.route.a1' });
  state.markRendered();
  state.dismiss();
  assert.equal(controller.getState().offer, 'dismissed');
  // The re-sync the screen performs on every preview load does not bring
  // the offer back (the revert-proof: removing the dismissal branch in
  // deriveOffer turns this and the table test red).
  controller.getState().sync({ access: 'paid', productId: 'com.kudy.route.a1' });
  assert.equal(controller.getState().offer, 'dismissed');
  // The dismissed card buys nothing and records nothing further.
  await controller.getState().buy();
  assert.equal(rig.events.filter((event) => event.type !== 'extension_offer_shown').length, 0);
  assert.equal(rig.purchases.length, 0);
});

test('AC2/C28: repeated errors keep both exits; Continue free keeps the app working', async () => {
  const rig = fixture({ kind: 'store-problem', code: 'E_STORE' });
  const controller = rig.controller();
  const state = controller.getState();
  state.sync({ access: 'paid', productId: 'com.kudy.route.a1' });
  state.markRendered();
  await state.buy();
  // The first error: the dialog state with both exits (the words live in
  // the strings; the state contract is what the screen renders).
  assert.deepEqual(controller.getState().attempt, { kind: 'error', reason: 'payment_failed' });
  assert.equal(controller.getState().offer, 'offered');
  // Try again — a fresh attempt with a new attempt_id, still from the offer.
  await controller.getState().tryAgain();
  assert.deepEqual(controller.getState().attempt, { kind: 'error', reason: 'payment_failed' });
  assert.equal(controller.getState().offer, 'offered');
  const started = rig.events.filter((event) => event.type === 'purchase_started');
  assert.equal(started.length, 2);
  assert.notEqual(started[0].attempt_id, started[1].attempt_id);
  // The join rule: both attempts carry the same offer_id.
  assert.equal(started[0].offer_id, started[1].offer_id);
  // The failed events narrowed to the failed event only, verbatim enum.
  const failed = rig.events.filter((event) => event.type === 'purchase_failed');
  assert.deepEqual(
    failed.map((event) => event.reason),
    ['payment_failed', 'payment_failed'],
  );
  // Continue free: the dialog closes, the offer stays, the port was called
  // exactly twice (no hidden third attempt), the context is intact.
  controller.getState().continueFree();
  assert.deepEqual(controller.getState().attempt, { kind: 'idle' });
  assert.equal(controller.getState().offer, 'offered');
  assert.equal(rig.purchases.length, 2);
});

test('AC2: the cancel is the person’s own answer — the failed event records, no dialog opens', async () => {
  const rig = fixture({ kind: 'cancelled' });
  const controller = rig.controller();
  controller.getState().sync({ access: 'paid', productId: 'com.kudy.route.a1' });
  await controller.getState().buy();
  assert.deepEqual(
    rig.events.filter((event) => event.type === 'purchase_failed').map((event) => event.reason),
    ['user_cancelled'],
  );
  assert.deepEqual(controller.getState().attempt, { kind: 'idle' });
  assert.equal(controller.getState().offer, 'offered');
});

test('the finished purchase: succeeded event, the §8 paid line, the offer never returns', async () => {
  const rig = fixture({ kind: 'transaction-finished', productId: 'com.kudy.route.a1' });
  const controller = rig.controller();
  const state = controller.getState();
  state.sync({ access: 'paid', productId: 'com.kudy.route.a1' });
  state.markRendered();
  await state.buy();
  assert.deepEqual(
    rig.events.filter((event) => event.type === 'purchase_succeeded').map((event) => event.attempt_id),
    ['attempt-1'],
  );
  assert.equal(controller.getState().offer, 'paid');
  // already-owned (the store's «не бярэм грошай другі раз») lands the same.
  const rig2 = fixture({ kind: 'already-owned' });
  const controller2 = rig2.controller();
  controller2.getState().sync({ access: 'paid', productId: 'com.kudy.route.a1' });
  await controller2.getState().buy();
  assert.equal(controller2.getState().offer, 'paid');
});

test('the double-tap guard: a busy attempt is a no-op, the store is called once', async () => {
  const events: CommerceEventRecord[] = [];
  const gate: { release: ((outcome: PurchaseOutcome) => void) | null } = { release: null };
  const purchases: string[] = [];
  const controller = createCommerceController({
    port: {
      stateOf: () => 'not-owned',
      purchase: async (productId) => {
        purchases.push(productId);
        return await new Promise<PurchaseOutcome>((resolve) => {
          gate.release = resolve;
        });
      },
    },
    telemetry: { record: (event) => events.push(event) },
    routeId: 'guide-route-a1',
    mintEventId,
    mintAttemptId: () => 'attempt-double-tap',
    mintOfferId: () => 'offer-double-tap',
    now: () => NOW_ISO,
  });
  const state = controller.getState();
  state.sync({ access: 'paid', productId: 'com.kudy.route.a1' });
  const first = state.buy();
  const second = state.buy();
  assert.equal(purchases.length, 1);
  gate.release?.({ kind: 'cancelled' });
  await Promise.all([first, second]);
  assert.equal(purchases.length, 1);
});

test('the free route and the missing port surface: nothing commerce renders or records', () => {
  const rig = fixture({ kind: 'cancelled' });
  const controller = rig.controller();
  controller.getState().sync({ access: 'free', productId: null });
  assert.equal(controller.getState().offer, 'none');
  controller.getState().markRendered();
  assert.equal(rig.events.length, 0);
  // The port itself is absent in the app root today — the whole service
  // member is undefined then (createServices), the screen renders nothing:
  // the composition-level fail-closed case proven in app/preview.test.tsx.
});
