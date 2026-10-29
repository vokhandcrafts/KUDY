import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPickupFeedback } from './pickup-feedback.mjs';

function harness() {
  let next = 0;
  const pending = new Map();
  const transitions = [];
  const pickup = createPickupFeedback({
    schedule: (fn, delay) => { assert.equal(delay, 120); pending.set(++next, fn); return next; },
    unschedule: (id) => pending.delete(id),
    onChange: (state) => transitions.push(state),
  });
  return { pickup, transitions, pending, tick() {
    for (const [id, fn] of [...pending]) { pending.delete(id); fn(); }
  } };
}

test('brief tap never lifts, remains navigable, and cleans its hold timer', () => {
  const h = harness();
  h.pickup.press();
  assert.equal(h.pickup.getState(), 'pressed');
  assert.equal(h.pickup.release(), false);
  h.tick();
  assert.deepEqual(h.transitions, ['pressed', 'idle']);
  assert.equal(h.pending.size, 0);
});

test('holding still lifts gently before drag and releasing a held item is not a tap', () => {
  const h = harness();
  h.pickup.press();
  h.tick();
  assert.equal(h.pickup.getState(), 'lifted');
  assert.equal(h.pickup.release(), true);
  assert.deepEqual(h.transitions, ['pressed', 'lifted', 'idle']);
});

test('movement immediately lifts with no long-press gate and leaves no pending timer', () => {
  const h = harness();
  h.pickup.press();
  h.pickup.drag();
  assert.equal(h.pickup.getState(), 'lifted');
  assert.equal(h.pickup.release(), true);
  h.tick();
  assert.deepEqual(h.transitions, ['pressed', 'lifted', 'idle']);
});

test('cancellation including second touch/lost capture cannot activate a stale pickup', () => {
  const h = harness();
  h.pickup.press();
  h.pickup.cancel();
  h.tick();
  assert.deepEqual(h.transitions, ['pressed', 'idle']);
  assert.equal(h.pickup.getState(), 'idle');
  h.pickup.press();
  h.tick();
  h.pickup.cancel();
  assert.equal(h.pickup.release(), false);
  assert.deepEqual(h.transitions.slice(-3), ['pressed', 'lifted', 'idle']);
  assert.equal(h.pending.size, 0);
});
