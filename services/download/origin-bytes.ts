// G20.20 — the free byte source. The base layers of free routes live on the
// public origin (09 §3: public/ holds catalog.json and the base layers);
// the paid/extended path is the grant source (services/download/grant.ts)
// and stays outside this composition until G20.21 wires the live store
// path. The wait deadline rides the shared wait-policy owner
// (services/network-wait.ts); failures keep the named rule and the status —
// never a URL (§N3 redaction, the grant source's own discipline).
import { NETWORK_WAIT_LIMITS, withWaitLimit } from '../network-wait.ts';
import type { FetchPort } from './types.ts';

export function createOriginByteSource(origin: string, waitLimitMs: number = NETWORK_WAIT_LIMITS.bundleBytesMs): FetchPort {
  return async (path: string) => {
    return withWaitLimit('wait-bundle-bytes', waitLimitMs, async (signal) => {
      let response: Response;
      try {
        response = await fetch(`${origin}/${path}`, { signal });
      } catch {
        throw new Error('bundle-bytes#fetch-failed');
      }
      if (response.status !== 200) {
        throw new Error(`bundle-bytes#status-${response.status}`);
      }
      try {
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        throw new Error('bundle-bytes#body-failed');
      }
    });
  };
}
