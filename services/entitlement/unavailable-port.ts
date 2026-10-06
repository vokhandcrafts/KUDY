// G20.20 — the explicitly-unavailable commerce port: stateOf never leaves
// 'not-owned' and purchase resolves the closed { kind: 'unavailable' }
// outcome with zero store, grant or paid-byte calls. react-native-purchases
// is deliberately not imported here — the composition root constructs no
// store session until G20.21 wires and verifies the live path (the purchase
// chain's own vocabulary, no fake success shape exists in this file).
import type { PurchaseChainState } from './purchase-chain.ts';
import type { PurchaseOutcome } from './types.ts';

export interface UnavailableCommercePort {
  stateOf(productId: string): PurchaseChainState;
  purchase(productId: string): Promise<PurchaseOutcome>;
}

export function createUnavailableCommercePort(): UnavailableCommercePort {
  return {
    stateOf: () => 'not-owned',
    purchase: async () => ({ kind: 'unavailable' }),
  };
}
