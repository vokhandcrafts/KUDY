// G08.03 demo — the store purchase session's honest closed states, live
// against the scripted store (fake-port.ts): the same module the behavioral
// tests drive, wired exactly as the composition root will. Deterministic:
// no clock, no randomness, no network; the device UUID and the product id
// are synthetic constants, no secrets anywhere.
import { FakeStoreSessionPort, rcError } from './fake-port.ts';
import {
  ensureStoreLink,
  purchaseNonConsumable,
  restoreEntitlements,
} from './service.ts';

const DEVICE = '3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const PRODUCT = 'com.kudy.route.gdansk_extended';

async function main(): Promise<void> {
  const port = new FakeStoreSessionPort();
  const lines: string[] = [];
  const deps = { store: port, onDiagnostics: (line: string) => lines.push(line) };

  // The user backs out at the payment sheet.
  port.purchaseRejects(rcError('1'));
  console.log('cancelled      →', JSON.stringify(await purchaseNonConsumable(deps, { deviceId: DEVICE }, PRODUCT)));

  // The payment is delayed (async store approval).
  port.purchaseRejects(rcError('20'));
  console.log('pending        →', JSON.stringify(await purchaseNonConsumable(deps, { deviceId: DEVICE }, PRODUCT)));

  // The store refuses the purchase on this device.
  port.purchaseRejects(rcError('3'));
  console.log('not-allowed    →', JSON.stringify(await purchaseNonConsumable(deps, { deviceId: DEVICE }, PRODUCT)));

  // The store finishes the transaction.
  port.purchaseResolves({ productId: PRODUCT });
  console.log('finished       →', JSON.stringify(await purchaseNonConsumable(deps, { deviceId: DEVICE }, PRODUCT)));

  // The store session saw exactly one link and four purchases.
  console.log('store calls    →', JSON.stringify(port.calls));

  // The same-store restore pass on the linked account.
  console.log('restore        →', JSON.stringify(await restoreEntitlements(deps, { deviceId: DEVICE })));

  // An RC misconfiguration is an app defect, never a user answer.
  const misconfigured = new FakeStoreSessionPort();
  misconfigured.linkRejects(rcError('11'));
  console.log('executor-error →', JSON.stringify(await purchaseNonConsumable({ store: misconfigured }, { deviceId: DEVICE }, PRODUCT)));

  // Diagnostics are named lines only — no store message, no payload.
  console.log('diagnostics    →', JSON.stringify(lines));
}

void main();
