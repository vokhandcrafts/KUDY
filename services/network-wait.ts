// G20.10 (issue #481) — the single owner of the network wait policy
// (specification network-privacy §N4: «Велічыні лімітаў маюць аднаго
// ўладальніка ў канфігурацыі і фіксуюцца ў выніку задачы; яны не ўводзяцца ў
// некалькі файлаў»). Every bounded network wait in services/ takes its limit
// from NETWORK_WAIT_LIMITS and its mechanics from withWaitLimit — no call
// site rolls its own timer.
//
// The mechanics answer §N4 exactly: the wait is finite (a deadline fires the
// named WaitTimeoutError and aborts the signal the request runs with — the
// response BODY is covered, not just the headers, because the signal stays
// live until the run completes); owner disposal (an external AbortSignal)
// aborts the same way with kind 'cancelled'; the timer and the signal
// listener are cleaned after success, timeout and cancellation alike; and a
// late reply can never settle an already-settled promise — the deadline wins
// the race and the aborted adapter's eventual outcome is discarded.
export const NETWORK_WAIT_LIMITS = {
  /** Catalog envelope/index document fetch (services/catalog/loader.ts). */
  catalogMs: 10_000,
  /** Remote config GET (services/remote-config.ts). */
  configMs: 10_000,
  /** Device registration POST (services/device.ts). */
  deviceMs: 10_000,
  /** One feedback queue round-trip (services/feedbackSync.ts, G16.02). */
  feedbackMs: 15_000,
  /** One grant request round-trip (services/download/grant.ts grantOnce). */
  grantRequestMs: 15_000,
  /** One signed-URL byte transfer (services/download/grant.ts fetchOnce). */
  grantBytesMs: 30_000,
} as const;

export type WaitRule =
  | 'wait-catalog'
  | 'wait-config'
  | 'wait-device'
  | 'wait-feedback'
  | 'wait-grant-request'
  | 'wait-grant-bytes';

export class WaitTimeoutError extends Error {
  readonly rule: WaitRule;
  readonly kind: 'timeout' | 'cancelled';

  constructor(rule: WaitRule, kind: 'timeout' | 'cancelled', message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WaitTimeoutError';
    this.rule = rule;
    this.kind = kind;
  }
}

export async function withWaitLimit<T>(
  rule: WaitRule,
  limitMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rejectWait: ((reason: unknown) => void) | null = null;
  const onExternalAbort = () => {
    controller.abort();
    // Owner disposal must settle the wait NOW: the adapter may never answer
    // on its own, and the owner must not hang on its own cancellation.
    rejectWait?.(new WaitTimeoutError(rule, 'cancelled', `${rule}: the owner disposed the request`));
  };
  if (!externalSignal?.aborted) {
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    return await new Promise<T>((resolve, reject) => {
      rejectWait = reject;
      // An owner that was already gone before the wait began answers
      // cancelled immediately — here, where rejectWait exists.
      if (externalSignal?.aborted) onExternalAbort();
      else {
        timer = setTimeout(() => {
          // The deadline aborts the request itself — an adapter that honors
          // the signal stops transferring the body, not just the headers.
          controller.abort();
          reject(new WaitTimeoutError(rule, 'timeout', `${rule}: the network wait exceeded ${limitMs} ms`));
        }, limitMs);
      }
      // A late reply after the deadline (or after owner disposal) races a
      // settled promise: the first settle wins, the loser is discarded, so
      // disposed state is never mutated by a stale response.
      run(controller.signal).then(resolve, reject);
    });
  } finally {
    if (timer !== null) clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
