// Shared N3 test support for the suites that drive the production default
// transports (services/device, services/analytics): a stub over the platform
// fetch that records every request — the network boundary, not the code
// under test. Test-only module — imported by *.test.ts suites, never by
// production code (the jscpd gate: one variant, not two).
export interface FetchStub {
  requests: Array<{ input: unknown; init?: RequestInit }>;
  restore(): void;
}

export function stubGlobalFetch(impl: (input: unknown, init?: RequestInit) => Promise<unknown>): FetchStub {
  const requests: Array<{ input: unknown; init?: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    requests.push({ input, init });
    return impl(input, init);
  }) as typeof fetch;
  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
