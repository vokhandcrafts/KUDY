// Named collection transports (G17.19, docs/24_web_collection.md «Кампанія»):
// a campaign parses with transport 'direct' — the default, today's behavior —
// or 'tor'. Under 'tor' every collection channel goes through the user's own
// tor daemon exposed as a SOCKS5 proxy on the pinned address below; the
// address is part of the contract (spec .scratch/collector-transport/spec.md:
// deliberately not user-configurable — one simple model for a human). The
// daemon itself is raised by the human; when it is down, channel failures
// carry the torDownDiagnostic hint and the error series stops the run
// (crawler.mjs ERROR_SERIES_LIMIT).
export const TRANSPORTS = ['direct', 'tor'];

export const TOR_SOCKS5_PROXY = 'socks5://127.0.0.1:9050';
// yt-dlp spells remote-DNS SOCKS5 as socks5h — the proxy resolves hostnames,
// so DNS never reaches the local resolver. The browser gets the plain socks5
// scheme plus a host-resolver rule that forbids local DNS (netfetch.mjs).
export const TOR_SOCKS5H_PROXY = 'socks5h://127.0.0.1:9050';

// The campaign's Tor proxy for channels that take a proxy URL (the browser);
// null means today's direct behavior — the campaign file carries the choice.
export function transportProxy(campaign) {
  return campaign.transport === 'tor' ? TOR_SOCKS5_PROXY : null;
}

// Undici dispatcher over the SOCKS5 proxy for node's builtin fetch (the wiki
// API client and the robots.txt gate — both plain-fetch channels of the crawl
// path). fetch-socks is imported on the first tor use: direct and file://
// campaigns never load it, mirroring netfetch's lazy playwright import.
export async function createTorDispatcher() {
  let socksDispatcher;
  try {
    ({ socksDispatcher } = await import('fetch-socks'));
  } catch {
    throw new Error(
      'fetch-socks is not installed — the Tor transport needs: npm install (direct and file:// campaigns work without it)'
    );
  }
  const proxy = new URL(TOR_SOCKS5_PROXY);
  return socksDispatcher({ type: 5, host: proxy.hostname, port: Number(proxy.port) });
}

// Wrap a channel's connection-level failure with the transport context: with
// every channel behind SOCKS5, a dead daemon is the first suspect. Call sites
// wrap connection-level errors only — site-level failures (HTTP ≥ 400) mean
// the proxy worked and keep their plain message. The original message survives
// the wrapping.
export function torDownDiagnostic(error) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${message} — Tor transport: is the tor daemon running (SOCKS5 127.0.0.1:9050)?`);
}
