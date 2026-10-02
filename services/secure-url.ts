// G20.06 — the one owner of the network-privacy N3 endpoint check
// (docs/specifications/architecture-hardening/network-privacy.md §N3): a
// secret-bearing request validates the parsed URL before the network and
// before authorization is attached — only a parseable https URL without
// embedded credentials passes; HTTP, malformed URLs and URL credentials are
// rejected here, never in a per-transport second copy. Callers fetch the
// returned URL object (what was validated is what is sent) and pass
// redirect: 'error' — a secret-bearing request never follows a redirect;
// a response that was redirected anyway (a platform that ignored the
// option) is rejected by assertNotRedirected before it is accepted.
//
// Messages name the violation and the calling boundary, never the URL: a
// rejected URL may carry credentials and must not reach the log (N3:
// «сакрэты не трапляюць у журнал»).
export class SecureUrlError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SecureUrlError';
  }
}

export function parseSecureEndpointUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new SecureUrlError(`${label}: the endpoint URL is not parseable`, { cause: error });
  }
  if (url.protocol !== 'https:') {
    throw new SecureUrlError(`${label}: the endpoint must use https`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new SecureUrlError(`${label}: the endpoint URL must not embed credentials`);
  }
  return url;
}

// Fail-closed answer to a platform that followed a redirect despite the
// redirect: 'error' option: the final response URL differs from the
// requested one, so the response is not accepted. An empty response.url
// (an adapter that does not report it) is not treated as a redirect.
export function assertNotRedirected(requested: URL, response: { url: string }, label: string): void {
  if (typeof response.url === 'string' && response.url !== '' && response.url !== requested.href) {
    throw new SecureUrlError(`${label}: a redirected response is not accepted`);
  }
}
