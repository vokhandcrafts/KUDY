// G20.10 demo harness (issue #481) — deterministic, synthetic, no network.
// Drives the real wait-policy owner and two production wirings (the catalog
// loader and the grant byte source) against a stubbed platform fetch that
// never resolves, and prints only stable lines (rules, kinds, redacted
// replies) so the output stays byte-identical between runs. No URL, no
// credential, no payload ever reaches the output (§N4/§N3 journal hygiene).
import { NETWORK_WAIT_LIMITS, WaitTimeoutError, withWaitLimit } from './network-wait.ts';
import { createOriginCatalogLoader } from './catalog/loader.ts';
import { createGrantFetchSource, type GrantFetchDeps } from './download/grant.ts';

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => new Promise<Response>(() => {})) as typeof fetch;

try {
  // 1) The owner: an unresolved request terminates named at the deadline and
  //    the abort reached the running request (the adapter can stop the body).
  let aborted = false;
  const wait = withWaitLimit('wait-config', 25, (signal) => {
    signal.addEventListener('abort', () => {
      aborted = true;
    });
    return new Promise<string>(() => {});
  });
  let rule = '';
  let kind = '';
  try {
    await wait;
  } catch (error) {
    if (error instanceof WaitTimeoutError) {
      rule = error.rule;
      kind = error.kind;
    }
  }
  console.log(`deadline: rule=${rule} kind=${kind} aborted=${aborted}`);

  // 2) The catalog loader: the deadline covers the whole document; the
  //    canonical limits live in NETWORK_WAIT_LIMITS (recorded in results).
  const loader = createOriginCatalogLoader('https://catalog.example.invalid', {
    waitLimitMs: NETWORK_WAIT_LIMITS.catalogMs >= 25 ? 25 : NETWORK_WAIT_LIMITS.catalogMs,
  });
  let catalogRule = '';
  try {
    await loader('catalog.json');
  } catch (error) {
    if (error instanceof WaitTimeoutError) catalogRule = error.rule;
  }
  console.log(`catalog loader: ${catalogRule}`);

  // 3) The grant byte source: the grant itself mints normally, then the byte
  //    transfer stalls — the deadline rejects redacted; the named diagnostic
  //    line carries the rule, never the URL.
  const deps: GrantFetchDeps = {
    transport: async (request) => ({
      status: 200,
      headers: {},
      body: {
        lock_url: 'https://files.example.invalid/demo-lock.json',
        urls: request.body.paths.map((path, index) => ({
          path,
          url: `https://files.example.invalid/private/${index}`,
          expires_at: 600_000,
        })),
      },
    }),
    credential: async () => 'synthetic-demo-credential',
    fetchBytes: async () => new Promise(() => {}),
    delay: async () => {},
    now: () => 0,
    onDiagnostics: (line) => console.log(`diagnostic: ${line}`),
    waitLimits: { bytesMs: 25 },
  };
  const fetch = createGrantFetchSource(
    {
      key: { routeId: 'route-demo', version: '1', locale: 'be', tier: 'base' },
      entries: [{ path: 'stops.json', bytes: 1, sha256: 'a'.repeat(64) }],
    },
    deps,
  );
  let reply = '';
  try {
    await fetch('stops.json');
  } catch (error) {
    reply = error instanceof Error ? error.message : 'unknown';
  }
  console.log(`bytes reply: ${reply}`);
} finally {
  globalThis.fetch = originalFetch;
}
