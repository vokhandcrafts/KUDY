// G08.03 — test fake over the store session port contract. A test scripts
// the next answer of each store entry point (a resolved ack or a thrown
// store failure — the raw shape the real SDK rejects with), and the fake
// records every call, so tests read like store scenarios and can assert the
// exact call order the linking contract needs (link before purchase/restore).
// Reverting the service's linking guard, the closed mapping or any honest
// outcome kind turns these tests red (implementation-rules 1).
import type {
  StoreLinkAck,
  StorePurchaseAck,
  StoreRestoreAck,
  StoreSessionPort,
} from './types.ts';

// The raw failure shape the pinned SDK rejects with (see
// store-error-mapping.ts): an object carrying the PURCHASES_ERROR_CODE
// string. Tests throw `rcError('1')` to script a store cancellation.
export function rcError(code: string, message = 'store failure'): object {
  return { code, message, userCancelled: null };
}

export class FakeStoreSessionPort implements StoreSessionPort {
  readonly calls: string[] = [];

  private linkScript: (() => Promise<StoreLinkAck>) | StoreLinkAck | object = { created: true };
  private purchaseScript: (() => Promise<StorePurchaseAck>) | StorePurchaseAck | object = {};
  private restoreScript: (() => Promise<StoreRestoreAck>) | StoreRestoreAck | object = {
    kind: 'restored',
  };

  // --- test controls: script the next store answer ---

  linkResolves(ack: StoreLinkAck = { created: true }): void {
    this.linkScript = ack;
  }

  linkRejects(thrown: object): void {
    this.linkScript = () => Promise.reject(thrown);
  }

  purchaseResolves(ack: StorePurchaseAck): void {
    this.purchaseScript = ack;
  }

  purchaseRejects(thrown: object): void {
    this.purchaseScript = () => Promise.reject(thrown);
  }

  restoreRejects(thrown: object): void {
    this.restoreScript = () => Promise.reject(thrown);
  }

  // A port that does not even answer in its own contract shape (the corrupt
  // store-session case the closed outcomes must survive).
  purchaseResolvesCorrupt(value: unknown): void {
    this.purchaseScript = value as StorePurchaseAck;
  }

  restoreResolvesCorrupt(value: unknown): void {
    this.restoreScript = value as StoreRestoreAck;
  }

  async link(appUserId: string): Promise<StoreLinkAck> {
    this.calls.push(`link ${appUserId}`);
    const script = this.linkScript;
    return typeof script === 'function' ? script() : Promise.resolve(script as StoreLinkAck);
  }

  async purchase(productId: string): Promise<StorePurchaseAck> {
    this.calls.push(`purchase ${productId}`);
    const script = this.purchaseScript;
    return typeof script === 'function' ? script() : Promise.resolve(script as StorePurchaseAck);
  }

  async restore(): Promise<StoreRestoreAck> {
    this.calls.push('restore');
    const script = this.restoreScript;
    return typeof script === 'function' ? script() : Promise.resolve(script as StoreRestoreAck);
  }
}
