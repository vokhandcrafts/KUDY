// G08.04 — the shared scripted grant fake: the signed-URL source both the
// acceptance suite (purchase-chain.test.ts) and the demo (demo-g0804.ts)
// drive, so the two cannot drift (implementation-rules 3: a sibling copy of
// the same idiom is a finding). Every POST /v1/grant mints fresh tokens over
// the currently served sources; a re-grant mints fresh, valid URLs — only
// `expireFirstMint` expires the FIRST batch, so the recovery the grant fetch
// source owns (09 §5.1: re-mint near expiry, re-grant a 403 url_expired)
// is exercised against honest server behavior.
import type { GrantTransport } from '../download/grant.ts';
import { utf8 } from '../download/test-fixture.ts';

export interface ScriptedGrant {
  transport: GrantTransport;
  fetchBytes: (url: string) => Promise<{ status: number; body: Uint8Array | null }>;
  // The requested paths of every POST /v1/grant, in order.
  readonly requested: string[][];
  // Swap the bytes the next mints serve (the hash-mismatch scenario).
  serve(sources: Record<string, Uint8Array>): void;
  // Turn the next fetches into interrupted transfers (the partial outcome).
  failNextFetches(count: number): void;
}

export function scriptedGrant(options: {
  sources?: Record<string, Uint8Array>;
  expireFirstMint?: boolean;
  now: number;
}): ScriptedGrant {
  let sources = options.sources ?? {};
  const requested: string[][] = [];
  const tokens = new Map<string, { bytes: Uint8Array; expired: boolean }>();
  let seq = 0;
  let failBudget = 0;
  return {
    requested,
    serve(next) {
      sources = next;
    },
    failNextFetches(count) {
      failBudget = count;
    },
    transport: async (request) => {
      requested.push(request.body.paths);
      const expiredBatch = options.expireFirstMint === true && requested.length === 1;
      return {
        status: 200,
        headers: {},
        body: {
          lock_url: 'https://cdn.test/lock.json',
          urls: request.body.paths.map((path) => {
            const url = `https://cdn.test/${String(++seq)}`;
            tokens.set(url, { bytes: sources[path] ?? utf8(''), expired: expiredBatch });
            return { path, url, expires_at: options.now + 600_000 };
          }),
        },
      };
    },
    fetchBytes: async (url) => {
      if (failBudget > 0) {
        failBudget -= 1;
        throw new Error('transfer interrupted');
      }
      const token = tokens.get(url);
      if (token === undefined) return { status: 403, body: utf8('{"error":{"code":"url_invalid"}}') };
      if (token.expired) {
        token.expired = false;
        return { status: 403, body: utf8('{"error":{"code":"url_expired"}}') };
      }
      return { status: 200, body: token.bytes };
    },
  };
}
