// G08.03 — the react-native-purchases adapter over the G08.03 store session
// port. This is the only module of services/entitlement/expo/ that imports
// the SDK at runtime; node --test never imports it (the closed failure
// mapping it delegates to is tested on synthetic throws instead — the
// services/audio idiom). The composition root receives the port as the
// `store` dependency; no other module imports this file.
//
// Canon anchors: `09` §5.1 — the purchase session runs with app_user_id =
// device_id, so link() is the RC logIn with the registered device UUID;
// `09` §5.2 — products are non-consumable one-time purchases and restore is
// the same-store store-account pass. The SDK must be configured
// (Purchases.configure({apiKey})) by the composition root before the first
// port call; an unconfigured SDK rejects and the closed mapping answers
// `unknown` — fail closed, never a guessed kind.
//
// Platform facts (checked in node_modules/react-native-purchases 10.9.1, not
// assumed): purchaseProduct(productIdentifier) resolves MakePurchaseResult
// (the productIdentifier echo is the ack) and rejects with a `code`-carrying
// failure; restorePurchases() resolves CustomerInfo the service never
// inspects (09 §5.1: entitlements in it are not the client's truth); logIn()
// resolves {created, customerInfo}. The SDK's own cancellation check is the
// error code, not the deprecated userCancelled boolean (purchases.js:436).
// A resolved value without its documented object shape becomes a rejection —
// the closed mapping answers it fail closed, like any other store failure.
import Purchases from 'react-native-purchases';
import type { CustomerInfo, LogInResult, MakePurchaseResult } from 'react-native-purchases';
import type { StoreLinkAck, StorePurchaseAck, StoreRestoreAck, StoreSessionPort } from '../types.ts';

function assertResolved<T extends object>(value: unknown, label: string): T {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`rc-port#${label}-shape`);
  }
  return value as T;
}

export function createRcStoreSessionPort(): StoreSessionPort {
  return {
    async link(appUserId: string): Promise<StoreLinkAck> {
      const result = assertResolved<LogInResult>(await Purchases.logIn(appUserId), 'link');
      return { created: result.created === true };
    },

    async purchase(productId: string): Promise<StorePurchaseAck> {
      const result = assertResolved<MakePurchaseResult>(
        await Purchases.purchaseProduct(productId),
        'purchase',
      );
      return { productId: result.productIdentifier };
    },

    async restore(): Promise<StoreRestoreAck> {
      // The customer info is deliberately not read: what the pass restored
      // is the grant path's decision (09 §5.1), not this adapter's.
      assertResolved<CustomerInfo>(await Purchases.restorePurchases(), 'restore');
      return { kind: 'restored' };
    },
  };
}
