// G06.01.a (issue #313) — the origin-binding adapter for the catalog loader
// port: relative published paths resolve against the configured public origin
// (21 §3.3 — the client fetches only that origin). fetch is global in the
// app runtime and in Node ≥ 22, so one adapter serves the device build and a
// local test server.
// G20.10 (issue #481, §N4): the wait is finite — the deadline covers the
// whole document (headers and body) and its abort stops the transfer; on
// timeout the loader rejects with the named WaitTimeoutError and the caller's
// reader policy falls back to its validated cache (catalogService) or the
// existing user-facing failure.
import { NETWORK_WAIT_LIMITS, withWaitLimit } from '../network-wait.ts';

export function createOriginCatalogLoader(
  origin: string,
  options?: { waitLimitMs?: number },
): (relPath: string) => Promise<string> {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  const waitLimitMs = options?.waitLimitMs ?? NETWORK_WAIT_LIMITS.catalogMs;
  return async (relPath) => {
    return withWaitLimit('wait-catalog', waitLimitMs, async (signal) => {
      const response = await fetch(`${base}/${relPath}`, { signal });
      if (!response.ok) {
        throw new Error(`catalog-loader-${response.status}`);
      }
      return response.text();
    });
  };
}
