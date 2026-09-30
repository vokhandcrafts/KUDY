// G08.05 (issue #292) — the demo script behind docs/demos/2026-09-30-g0805-
// quiet-commerce-offer.md: the quiet commerce controller over fake ports
// with deterministic mints and clock (implementation-rules 11 — the captured
// output carries no timings and no random identifiers). Not a test: it
// prints the AC walk of the issue — the allowed-place derivation, the
// render-fact impression, the repeated-error exits, the §8 words and the
// respected decline.
import {
  createCommerceController,
  type CommerceEventRecord,
  type CommercePort,
} from './commerceController.ts';

const events: CommerceEventRecord[] = [];
let eventN = 0;
let attemptN = 0;
let purchaseCalls = 0;
let fail = true;
const port: CommercePort = {
  // The port owns the state: only its own finished purchase answers paid.
  stateOf: () => (purchaseCalls > 0 && !fail ? 'paid' : 'not-owned'),
  purchase: async () => {
    purchaseCalls += 1;
    if (fail) return { kind: 'store-problem', code: 'E_STORE' };
    return { kind: 'transaction-finished', productId: 'route_a1_prod' };
  },
};

const controller = createCommerceController({
  port,
  telemetry: { record: (event) => events.push(event) },
  routeId: 'guide-route-a1',
  mintOfferId: () => 'offer-1',
  mintAttemptId: () => `attempt-${++attemptN}`,
  mintEventId: () => `00000000-0000-4000-8000-${String(++eventN).padStart(12, '0')}`,
  now: () => '2026-09-30T00:00:00.000Z',
});
const state = controller.getState();

state.sync({ access: 'paid', productId: 'route_a1_prod' });
// The state fields are snapshots: the offer reads fresh after the sync.
const line1 = `paid + not-owned → ${controller.getState().offer}`;

const mountEvents = events.length;
state.markRendered();
state.markRendered();
const shown = events.filter((event) => event.type === 'extension_offer_shown');
const line2 = `mount events ${mountEvents}; layout ×2 → shown ${shown.length} (offer_id ${String(shown[0]?.offer_id)})`;

await state.buy();
const firstError = controller.getState().attempt.kind === 'error' ? controller.getState().attempt.reason : 'none';
await state.tryAgain();
const secondError = controller.getState().attempt.kind === 'error' ? controller.getState().attempt.reason : 'none';
const line3 = `error ×2 → ${firstError}, ${secondError}; exits try-again+continue-free; purchases ${purchaseCalls}`;

controller.getState().continueFree();
const line4 = `continue free → attempt ${controller.getState().attempt.kind}, offer ${controller.getState().offer}, events ${events.length}`;

fail = false;
await controller.getState().buy();
const line5 = `success → offer ${controller.getState().offer} («Куплена · трэба загрузіць»), succeeded ${events.filter((event) => event.type === 'purchase_succeeded').length}`;

await controller.getState().buy();
const line6 = `re-buy at paid → purchases ${purchaseCalls} (the store is never asked again)`;

const second = createCommerceController({
  // A fresh not-owned port: the decline walk needs the offered state.
  port: { stateOf: () => 'not-owned', purchase: port.purchase },
  telemetry: { record: (event) => events.push(event) },
  routeId: 'guide-route-a1',
  mintOfferId: () => 'offer-2',
  mintAttemptId: () => `attempt-${++attemptN}`,
  mintEventId: () => `00000000-0000-4000-8000-${String(++eventN).padStart(12, '0')}`,
  now: () => '2026-09-30T00:00:00.000Z',
});
second.getState().sync({ access: 'paid', productId: 'route_a1_prod' });
second.getState().dismiss();
const afterDismiss = second.getState().offer;
second.getState().sync({ access: 'paid', productId: 'route_a1_prod' });
const line7 = `dismiss → ${afterDismiss}; re-sync → ${second.getState().offer}`;

console.log([line1, line2, line3, line4, line5, line6, line7].join('\n'));
