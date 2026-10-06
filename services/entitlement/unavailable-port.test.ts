// G20.20 — the explicitly-unavailable commerce port: the closed outcome and
// the not-owned state, and zero side effects by construction (the module
// imports no store; the wiring guards in controllers/wiring.test.ts pin
// that the composition roots never import react-native-purchases).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createUnavailableCommercePort } from './unavailable-port.ts';


test('purchase resolves unavailable and state stays not-owned', async () => {
  const port = createUnavailableCommercePort();
  assert.equal(port.stateOf('kudy.route.paid'), 'not-owned');
  assert.deepEqual(await port.purchase('kudy.route.paid'), { kind: 'unavailable' });
});
