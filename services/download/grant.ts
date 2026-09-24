// G04.02.b — services/download grant client: the download side of /v1/grant
// (09 §5). Canonical anchors, copied not paraphrased (implementation-rules 2):
// `09` §5 — POST /v1/grant carries exactly {route_id, version, locale, tier,
// paths[]} with `Bearer <device_secret>` and answers {lock_url,
// urls:[{path,url,expires_at}]}; the client never chooses the product or the
// storage bucket («Мяжа /grant») and the request-size limit is contract-set;
// `09` §5.1 — signed URLs are minted in portions and re-minted when
// expires_at nears, and /v1/grant is fail-closed with the right code;
// `19` §3.6 — the closed server answer list, copied verbatim below;
// `19` §3.5 — requestGrant(): Promise<GrantUrls | GrantError>. The wire is
// snake_case and the service layer is camelCase: the request body and
// parseGrantSuccess are the two declared mapping points. The transport, the
// credential, the clock and the byte source enter as ports — no network, no
// platform API and no writes in the core (the device HTTP adapter is out of
// scope, TR-10), and no secret, token or signed URL is ever logged or
// persisted (criterion 5): diagnostics carry named events only, and error
// messages are constant redacted strings.
import { parseLock, validateKey } from './download.ts';
import type { FetchPort, LayerKey, LockEntry } from './types.ts';

// `19` §3.6 — the closed list, verbatim:
//   type GrantError =
//     | { status: 400; code: 'invalid_request' }                 // форма/памер цела, невалідны JSON
//     | { status: 403; code: 'device_auth_failed' | 'unknown_route_tier' | 'manifest_not_found'
//         | 'path_not_allowed' | 'no_entitlement' | 'environment_mismatch' | 'url_expired' | 'url_invalid' }
//     | { status: 404; code: 'not_found' }
//     | { status: 503; code: 'entitlement_unavailable' };        // + Retry-After; кліент рэтраіць
// Machine projection of the same list: STATUS_OF and OUTCOME_BY_CODE derive
// from it (or fail to compile), and the test fake's list is deep-compared
// against it — a drift on any side fails the suite (implementation-rules 1).
export const GRANT_ERRORS = [
  { status: 400, code: 'invalid_request' },
  { status: 403, code: 'device_auth_failed' },
  { status: 403, code: 'unknown_route_tier' },
  { status: 403, code: 'manifest_not_found' },
  { status: 403, code: 'path_not_allowed' },
  { status: 403, code: 'no_entitlement' },
  { status: 403, code: 'environment_mismatch' },
  { status: 403, code: 'url_expired' },
  { status: 403, code: 'url_invalid' },
  { status: 404, code: 'not_found' },
  { status: 503, code: 'entitlement_unavailable' },
] as const;

export type GrantCode = (typeof GRANT_ERRORS)[number]['code'];

// The status of each closed code — derived, never restated by hand.
const STATUS_OF = Object.fromEntries(GRANT_ERRORS.map((entry) => [entry.code, entry.status])) as Record<
  GrantCode,
  400 | 403 | 404 | 503
>;

function isGrantCode(code: string): code is GrantCode {
  return GRANT_ERRORS.some((entry) => entry.code === code);
}

// The exact wire request of 09 §5 — snake_case on the wire (mapping point 1;
// the service-layer input is the camelCase GrantLayerInput below).
export interface GrantRequestBody {
  route_id: string;
  version: string;
  locale: string;
  tier: string;
  paths: string[];
}

// The injected HTTP port over POST /v1/grant (09 §5). The adapter maps the
// canonical endpoint onto the functions base URL and carries `bearer` as the
// `Authorization: Bearer <value>` header; the device HTTP adapter itself is
// out of scope, so there is no default transport and the core cannot reach
// the network. Headers are a plain lowercase-name record (Retry-After is
// read from it); a body that is not JSON arrives as null. A rejection means
// the request did not complete (offline).
export interface GrantHttpRequest {
  body: GrantRequestBody;
  bearer: string;
}

export interface GrantHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type GrantTransport = (request: GrantHttpRequest) => Promise<GrantHttpResponse>;

// One signed file URL of the success body; expires_at is the server's
// epoch-ms TTL (09 §5).
export interface GrantedUrl {
  path: string;
  url: string;
  expiresAt: number;
}

// `19` §3.5 GrantUrls — the camelCase projection of the success body, built
// only by parseGrantSuccess (mapping point 2).
export interface GrantUrls {
  lockUrl: string;
  urls: GrantedUrl[];
}

// One outcome per code of the closed list (criterion 2). `purchase` —
// no_entitlement: the neighbouring layer offers the purchase path (G08.03
// owns it). `unavailable` — entitlement_unavailable with the Retry-After
// wait already honoured for the bounded retries (19 §3.6: «кліент рэтраіць»);
// retrying again later stays available. `executor-error` — invalid_request
// is a client bug, not a user answer (19 §3.6). `regrant` — url_expired: the
// fetch source answers it by re-granting (criterion 3); the grant endpoint
// itself never sends it, and a server that does gets the same named answer.
// The remaining closed codes are named `failed` answers. Anything outside
// the list — an unknown status or code, or a status↔code pairing the closed
// list does not define, or a malformed success body — is `unknown`: fail
// closed, never ready, never free access (09 §5.1). `invalid-input` is the
// local rejection before any transport call (a corrupt lock, an unsafe key —
// the activation-core idiom); `offline` is a transport rejection — a defined
// outcome, never an exception to the caller (criterion 4).
export type GrantOutcome =
  | { kind: 'granted'; urls: GrantUrls }
  | { kind: 'purchase'; code: 'no_entitlement'; status: 403 }
  | {
      kind: 'unavailable';
      code: 'entitlement_unavailable';
      status: 503;
      retryAfterMs: number;
      retriesUsed: number;
    }
  | { kind: 'executor-error'; code: 'invalid_request'; status: 400 }
  | { kind: 'regrant'; code: 'url_expired'; status: 403 }
  | {
      kind: 'failed';
      status: 403 | 404;
      code: 'device_auth_failed' | 'unknown_route_tier' | 'manifest_not_found' | 'path_not_allowed'
        | 'environment_mismatch' | 'url_invalid' | 'not_found';
    }
  | { kind: 'unknown'; diagnostics: string[] }
  | { kind: 'invalid-input'; diagnostics: string[] }
  | { kind: 'offline' };

// The retry policy for 503 entitlement_unavailable: bounded attempts, the
// delay taken from the Retry-After header (seconds — the wire unit the
// contract reference sends), the documented default when the header is
// absent or unparsable. Removing the Retry-After parsing fails the 503 test
// — that is the task's Proof (implementation-rules 1).
export interface GrantRetryPolicy {
  maxRetries: number;
  defaultRetryAfterMs: number;
}

export const DEFAULT_GRANT_RETRY: GrantRetryPolicy = {
  maxRetries: 2,
  // The contract reference answers 30s (spikes/G00.03-sandbox-grant/server/
  // grant-server.mjs retryAfterSeconds); the default applies only when the
  // header is missing or unparsable.
  defaultRetryAfterMs: 30_000,
};

// All platform concerns are ports: the HTTP transport (required — no
// default), the Bearer credential (expo-secure-store on the device — out of
// scope here), the delay (Retry-After waits; injected so tests are
// deterministic) and the diagnostics sink (named events only — criterion 5;
// absent by default, the client never logs on its own).
export interface GrantDeps {
  transport: GrantTransport;
  credential: () => Promise<string>;
  delay: (ms: number) => Promise<void>;
  policy?: Partial<GrantRetryPolicy>;
  onDiagnostics?: (line: string) => void;
}

// The layer grant request (criterion 1): paths are not an input — they are
// derived from the layer's lock.json through the shared guard (the same
// parseLock the activation core trusts), so a caller cannot ask for a path
// outside the verified lock.
export interface GrantLayerInput extends LayerKey {
  lock: unknown;
}

interface ResolvedDeps {
  transport: GrantTransport;
  credential: () => Promise<string>;
  delay: (ms: number) => Promise<void>;
  policy: GrantRetryPolicy;
  diagnostic: (line: string) => void;
}

function resolveDeps(deps: GrantDeps): ResolvedDeps {
  return {
    transport: deps.transport,
    credential: deps.credential,
    delay: deps.delay,
    policy: {
      maxRetries: deps.policy?.maxRetries ?? DEFAULT_GRANT_RETRY.maxRetries,
      defaultRetryAfterMs: deps.policy?.defaultRetryAfterMs ?? DEFAULT_GRANT_RETRY.defaultRetryAfterMs,
    },
    diagnostic: (line) => deps.onDiagnostics?.(line),
  };
}

function responseCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as Record<string, unknown>)['error'];
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : null;
}

// The single wire→service mapping point of the success body (rule 2: the
// boundary declared once). A body that does not satisfy the documented shape
// yields diagnostics and is never granted (fail closed).
export function parseGrantSuccess(body: unknown): { urls: GrantUrls } | { diagnostics: string[] } {
  if (typeof body !== 'object' || body === null) return { diagnostics: ['grant-response#shape'] };
  const candidate = body as Record<string, unknown>;
  const lockUrl = candidate['lock_url'];
  if (typeof lockUrl !== 'string' || lockUrl === '') return { diagnostics: ['grant-response#lock_url'] };
  const rawUrls = candidate['urls'];
  if (!Array.isArray(rawUrls) || rawUrls.length === 0) return { diagnostics: ['grant-response#urls'] };
  const diagnostics: string[] = [];
  const urls: GrantedUrl[] = [];
  rawUrls.forEach((raw: unknown, index: number) => {
    if (typeof raw !== 'object' || raw === null) {
      diagnostics.push(`grant-response.urls[${index}]#shape`);
      return;
    }
    const entry = raw as Record<string, unknown>;
    const path = entry['path'];
    const url = entry['url'];
    const expiresAt = entry['expires_at'];
    if (
      typeof path !== 'string' ||
      path === '' ||
      typeof url !== 'string' ||
      url === '' ||
      typeof expiresAt !== 'number' ||
      !Number.isFinite(expiresAt)
    ) {
      diagnostics.push(`grant-response.urls[${index}]#shape`);
      return;
    }
    urls.push({ path, url, expiresAt });
  });
  if (diagnostics.length > 0) return { diagnostics };
  return { urls: { lockUrl, urls } };
}

// Retry-After arrives in seconds on this endpoint; an absent, empty or
// unparsable header falls back to the policy default — the wait is honoured
// either way (criterion 2).
function parseRetryAfter(headers: Record<string, string>, fallbackMs: number): number {
  const raw = headers['retry-after'];
  if (raw === undefined || raw.trim() === '') return fallbackMs;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : fallbackMs;
}

type GrantAnswerContext = { retryAfterMs: number; retriesUsed: number };

// One outcome per code of the closed list (criterion 2) — compile-exhaustive
// over GrantCode, so a code added to the closed list without an outcome
// breaks the build. The status is the closed list's own, which the pairing
// check has already matched against the response.
const OUTCOME_BY_CODE: Record<GrantCode, (ctx: GrantAnswerContext) => GrantOutcome> = {
  invalid_request: () => ({ kind: 'executor-error', code: 'invalid_request', status: 400 }),
  no_entitlement: () => ({ kind: 'purchase', code: 'no_entitlement', status: 403 }),
  entitlement_unavailable: (ctx) => ({
    kind: 'unavailable',
    code: 'entitlement_unavailable',
    status: 503,
    retryAfterMs: ctx.retryAfterMs,
    retriesUsed: ctx.retriesUsed,
  }),
  url_expired: () => ({ kind: 'regrant', code: 'url_expired', status: 403 }),
  device_auth_failed: () => ({ kind: 'failed', status: 403, code: 'device_auth_failed' }),
  unknown_route_tier: () => ({ kind: 'failed', status: 403, code: 'unknown_route_tier' }),
  manifest_not_found: () => ({ kind: 'failed', status: 403, code: 'manifest_not_found' }),
  path_not_allowed: () => ({ kind: 'failed', status: 403, code: 'path_not_allowed' }),
  environment_mismatch: () => ({ kind: 'failed', status: 403, code: 'environment_mismatch' }),
  url_invalid: () => ({ kind: 'failed', status: 403, code: 'url_invalid' }),
  not_found: () => ({ kind: 'failed', status: 404, code: 'not_found' }),
};

// The closed-list mapping (criterion 2): a status↔code pair the closed list
// does not define is outside the contract — `unknown`, fail closed.
function mapGrantAnswer(
  response: GrantHttpResponse,
  ctx: GrantAnswerContext,
  deps: ResolvedDeps,
): GrantOutcome {
  if (response.status === 200) {
    const parsed = parseGrantSuccess(response.body);
    if ('urls' in parsed) return { kind: 'granted', urls: parsed.urls };
    deps.diagnostic('grant:unknown-response');
    return { kind: 'unknown', diagnostics: parsed.diagnostics };
  }
  const code = responseCode(response.body);
  if (code === null || !isGrantCode(code) || STATUS_OF[code] !== response.status) {
    deps.diagnostic(`grant:outside-closed-list status=${response.status}`);
    return {
      kind: 'unknown',
      diagnostics: [`grant-answer#outside-closed-list:${response.status}:${code ?? 'none'}`],
    };
  }
  deps.diagnostic(`grant:answer code=${code}`);
  return OUTCOME_BY_CODE[code](ctx);
}

// One POST /v1/grant round trip with the full closed-list mapping. Retries
// only 503 entitlement_unavailable, honouring Retry-After through the
// injected delay (criterion 2, the Proof); any transport rejection is the
// defined offline outcome (criterion 4).
async function grantOnce(key: LayerKey, paths: string[], deps: ResolvedDeps): Promise<GrantOutcome> {
  const body: GrantRequestBody = {
    route_id: key.routeId,
    version: key.version,
    locale: key.locale,
    tier: key.tier,
    paths,
  };
  let retriesUsed = 0;
  let retryAfterMs = deps.policy.defaultRetryAfterMs;
  for (;;) {
    let bearer: string;
    try {
      bearer = await deps.credential();
    } catch {
      // A local credential failure is not a network answer: named and fail
      // closed, still without an exception to the caller (criterion 4).
      deps.diagnostic('grant:credential-unavailable');
      return { kind: 'unknown', diagnostics: ['grant-credential#unavailable'] };
    }
    let response: GrantHttpResponse;
    try {
      response = await deps.transport({ body, bearer });
    } catch {
      deps.diagnostic('grant:offline');
      return { kind: 'offline' };
    }
    if (response.status === 503 && responseCode(response.body) === 'entitlement_unavailable') {
      // The header of every 503 is parsed — including the final one, so the
      // spent outcome carries its own wait for the next attempt.
      retryAfterMs = parseRetryAfter(response.headers, deps.policy.defaultRetryAfterMs);
      if (retriesUsed < deps.policy.maxRetries) {
        retriesUsed += 1;
        deps.diagnostic(`grant:retry entitlement_unavailable delay_ms=${retryAfterMs}`);
        await deps.delay(retryAfterMs);
        continue;
      }
    }
    const outcome = mapGrantAnswer(response, { retryAfterMs, retriesUsed }, deps);
    if (outcome.kind === 'granted') {
      // The grant mirrors the requested portion (09 §5); a silent subset is
      // outside the contract — fail closed here, not mid-activation.
      const covered = new Set(outcome.urls.urls.map((granted) => granted.path));
      const missing = paths.filter((p) => !covered.has(p)).length;
      if (missing > 0) {
        deps.diagnostic('grant:partial-coverage');
        return {
          kind: 'unknown',
          diagnostics: [`grant-response#coverage:${paths.length - missing}/${paths.length}`],
        };
      }
    }
    return outcome;
  }
}

// 09 §5: «Ліміты памеру спіса і запыту задаюцца кантрактам». The read-only
// contract reference pins 20 paths per /v1/grant request
// (spikes/G00.03-sandbox-grant/server/grant-server.mjs, MAX_PATHS) — the
// client stays inside it by minting in portions (09 §5.1).
const MAX_PATHS_PER_GRANT = 20;

/**
 * The `19` §3.5 requestGrant surface: grant every path of the layer's
 * verified lock. The lock is validated through the shared guard before any
 * transport call; paths are batched into contract-size portions; the first
 * non-granted answer aborts and is returned as-is.
 */
export async function requestGrant(input: GrantLayerInput, deps: GrantDeps): Promise<GrantOutcome> {
  const key: LayerKey = {
    routeId: input.routeId,
    version: input.version,
    locale: input.locale,
    tier: input.tier,
  };
  const diagnostics = validateKey(key);
  const lock = parseLock(input.lock);
  diagnostics.push(...lock.diagnostics);
  if (diagnostics.length > 0) return { kind: 'invalid-input', diagnostics };

  const resolved = resolveDeps(deps);
  const urls: GrantedUrl[] = [];
  let lockUrl: string | null = null;
  for (let start = 0; start < lock.entries.length; start += MAX_PATHS_PER_GRANT) {
    const portion = lock.entries.slice(start, start + MAX_PATHS_PER_GRANT).map((entry) => entry.path);
    const outcome = await grantOnce(key, portion, resolved);
    if (outcome.kind !== 'granted') return outcome;
    if (lockUrl === null) lockUrl = outcome.urls.lockUrl;
    else if (outcome.urls.lockUrl !== lockUrl) {
      return { kind: 'unknown', diagnostics: ['grant-response#lock_url-mismatch'] };
    }
    urls.push(...outcome.urls.urls);
  }
  if (lockUrl === null) {
    // Unreachable: parseLock rejects an empty lock, so the loop ran at least
    // once — kept explicit instead of an assertion (fail closed).
    return { kind: 'unknown', diagnostics: ['grant-response#no-portion'] };
  }
  return { kind: 'granted', urls: { lockUrl, urls } };
}

// 09 §5.1: «кліент … пераміньвае іх, калі expires_at наблізіўся» — a URL
// whose remaining TTL falls below this margin is refreshed before the next
// fetch. Default 60s against the reference TTL of 600s.
const DEFAULT_EXPIRY_MARGIN_MS = 60_000;

// The byte source that wires the grant client into activate()'s FetchPort
// (types.ts): signed URLs are minted in contract-size portions and re-minted
// when expiry nears; a 403 url_expired mid-download is answered by
// re-granting the remaining portion and continuing — verified files are kept
// by the activation resume and are never fetched again (criterion 3). Every
// failure is a named, redacted Error message — no URL, no credential
// (criterion 5) — so the activation result keeps its diagnostics honest.
// The fetchBytes port resolves {status, body}; a rejection of it means an
// interrupted transfer and its message must stay redacted too (types.ts).
export interface GrantFetchDeps {
  transport: GrantTransport;
  credential: () => Promise<string>;
  fetchBytes: (url: string) => Promise<{ status: number; body: Uint8Array | null }>;
  delay: (ms: number) => Promise<void>;
  now: () => number;
  policy?: Partial<GrantRetryPolicy>;
  onDiagnostics?: (line: string) => void;
  expiryMarginMs?: number;
}

function decodeJsonBody(bytes: Uint8Array | null): unknown {
  if (bytes === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function createGrantFetchSource(
  input: { key: LayerKey; entries: LockEntry[] },
  deps: GrantFetchDeps,
): FetchPort {
  const paths = input.entries.map((entry) => entry.path);
  const marginMs = deps.expiryMarginMs ?? DEFAULT_EXPIRY_MARGIN_MS;
  const resolved = resolveDeps({
    transport: deps.transport,
    credential: deps.credential,
    delay: deps.delay,
    policy: deps.policy,
    onDiagnostics: deps.onDiagnostics,
  });
  // The current portion of signed URLs, covering paths[start..start+limit).
  let portion: GrantedUrl[] = [];

  const urlOf = (path: string): GrantedUrl | undefined => portion.find((granted) => granted.path === path);

  async function remint(start: number): Promise<void> {
    const window = paths.slice(start, start + MAX_PATHS_PER_GRANT);
    const outcome = await grantOnce(input.key, window, resolved);
    if (outcome.kind !== 'granted') throw new Error(`grant-fetch#grant-${outcome.kind}`);
    portion = outcome.urls.urls;
  }

  async function fetchOnce(path: string): Promise<Uint8Array | 'url_expired'> {
    const granted = urlOf(path);
    if (granted === undefined) throw new Error('grant-fetch#grant-missing-url');
    let response: { status: number; body: Uint8Array | null };
    try {
      response = await deps.fetchBytes(granted.url);
    } catch {
      // Fetch adapters typically put the URL into rejection messages —
      // replace it with the named redacted line (criterion 5).
      throw new Error('grant-fetch#transfer-failed');
    }
    if (response.status === 200 && response.body !== null) return response.body;
    const code = responseCode(decodeJsonBody(response.body));
    if (response.status === 403 && code === 'url_expired') return 'url_expired';
    throw new Error(`grant-fetch#file-denied:${code ?? `status:${response.status}`}`);
  }

  return async (path: string): Promise<Uint8Array> => {
    const index = paths.indexOf(path);
    if (index === -1) throw new Error('grant-fetch#path-not-in-lock');
    const granted = urlOf(path);
    if (granted === undefined || granted.expiresAt - deps.now() < marginMs) {
      deps.onDiagnostics?.(
        `grant-fetch:remint path_index=${index} reason=${granted === undefined ? 'window' : 'expiry'}`,
      );
      await remint(index);
    }
    const first = await fetchOnce(path);
    if (first !== 'url_expired') return first;
    // A signed URL that expired mid-download: re-grant the remaining portion
    // and continue (criterion 3). The activation resume keeps verified files,
    // so they are never fetched again.
    deps.onDiagnostics?.('grant-fetch:regrant url_expired');
    await remint(index);
    const second = await fetchOnce(path);
    if (second !== 'url_expired') return second;
    throw new Error('grant-fetch#file-denied:url_expired:regrant-expired');
  };
}
