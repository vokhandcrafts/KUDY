import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { authenticateBearer, registerDevice } from './device-auth.mjs';
import { mintFileToken, verifyFileToken } from './signed-url.mjs';

function shortHash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

const MAX_BODY_BYTES = 64 * 1024;
// Over-limit bodies are drained (never stored) up to this many received bytes
// before the connection is reset instead of answered.
const DRAIN_LIMIT_BYTES = 1024 * 1024;
const MAX_PATHS = 20;

// Canonical API surface: docs/architecture/09 §5. The error codes form a
// closed list (09 §5.1: "Памылкі — закрыты спіс кодаў, без шляхоў файлаў"):
//   400 invalid_request
//   403 device_auth_failed | unknown_route_tier | manifest_not_found |
//       path_not_allowed | no_entitlement | environment_mismatch |
//       url_expired | url_invalid
//   404 not_found
//   503 entitlement_unavailable (with Retry-After)

// A requested path must be a plain relative member of the manifest: no
// absolute form, no traversal, no drive/scheme prefix, no empty segments.
export function isUnsafePath(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 256) return true;
  if (candidate.includes('\0') || candidate.includes('\\')) return true;
  if (candidate.startsWith('/') || candidate.startsWith('~')) return true;
  if (/^[a-zA-Z]:/.test(candidate) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) return true;
  const segments = candidate.split('/');
  return segments.some((segment) => segment === '' || segment === '.' || segment === '..');
}

function findProduct(catalog, routeId, tier) {
  const matches = Object.entries(catalog.products)
    .filter(([, product]) => product.route_id === routeId && product.tier === tier);
  return matches.length === 1 ? { product_id: matches[0][0], ...matches[0][1] } : null;
}

function manifestBaseOf(routeId, version, locale, tier) {
  return `${routeId}/${version}/${locale}/${tier}`;
}

function tierRoot(storageRoot, manifestBase) {
  return join(storageRoot, ...manifestBase.split('/'));
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function fail(res, log, { status, code, event, deviceHash, detail, headers }) {
  log(event ?? 'request_rejected', { code, device_hash: deviceHash, detail });
  sendJson(res, status, { error: { code } }, headers);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let overflow = false;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // Once over MAX_BODY_BYTES nothing more is buffered, but the remainder is
    // still drained (discarded, never stored) so the client is told
    // 400 invalid_request from the closed list instead of losing the socket
    // mid-request. A client that keeps streaming past DRAIN_LIMIT_BYTES gets
    // the connection reset instead: input stays bounded either way. A client
    // that stalls mid-body cannot hold the handler: 'close' settles the
    // promise when the request dies without 'end'.
    req.on('data', (chunk) => {
      size += chunk.length;
      if (overflow) {
        if (size > DRAIN_LIMIT_BYTES) {
          finish({ error: 'too_large' });
          req.destroy();
        }
        return;
      }
      if (size > MAX_BODY_BYTES) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) return finish({ error: 'too_large' });
      try {
        finish({ body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        finish({ error: 'bad_json' });
      }
    });
    req.on('close', () => {
      if (overflow) finish({ error: 'too_large' });
    });
    req.on('error', () => finish({ error: 'bad_json' }));
  });
}

export function createGrantServer({
  catalog,
  devicesFile,
  storageRoot,
  provider,
  urlSigningKey,
  urlTtlSeconds = 600,
  entitlementCacheTtlSeconds = 86400,
  environment,
  retryAfterSeconds = 30,
  log = (event, fields) => console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields })),
}) {
  // Positive entitlement cache per 09 §5.1: key (device_id, route_id, tier),
  // TTL from env, only positive answers. It never bypasses the environment
  // check and never stores negative answers.
  const positiveEntitlements = new Map();

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://loopback.invalid');
    try {
      if (req.method === 'POST' && url.pathname === '/v1/device') {
        return handleRegisterDevice(res, log, devicesFile);
      }
      if (req.method === 'POST' && url.pathname === '/v1/grant') {
        return await handleGrant(req, res, log, {
          catalog, devicesFile, provider, urlSigningKey, urlTtlSeconds,
          entitlementCacheTtlSeconds, environment, retryAfterSeconds, positiveEntitlements,
        });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/private/')) {
        return handlePrivateFile(res, log, { catalog, storageRoot, urlSigningKey, token: url.pathname.slice('/private/'.length) });
      }
      // Never log a signed URL: the /private/ path is redacted before it can
      // reach the log line.
      const detailPath = url.pathname.startsWith('/private/') ? '<redacted_file_route>' : url.pathname;
      return fail(res, log, { status: 404, code: 'not_found', event: 'route_missed', detail: `${req.method} ${detailPath}` });
    } catch {
      // Keep even the internal fault inside the documented closed list: a
      // client retries it like any other provider outage.
      return fail(res, log, {
        status: 503, code: 'entitlement_unavailable', event: 'internal_error',
        headers: { 'retry-after': String(retryAfterSeconds) },
      });
    }
  });
  return httpServer;
}

function handleRegisterDevice(res, log, devicesFile) {
  const { deviceId, deviceSecret } = registerDevice(devicesFile);
  log('device_registered', { device_hash: shortHash(deviceId) });
  sendJson(res, 200, { device_id: deviceId, device_secret: deviceSecret });
}

async function handleGrant(req, res, log, context) {
  const {
    catalog, devicesFile, provider, urlSigningKey, urlTtlSeconds,
    entitlementCacheTtlSeconds, environment, retryAfterSeconds, positiveEntitlements,
  } = context;

  const auth = authenticateBearer(req.headers.authorization, devicesFile);
  if (!auth.ok) {
    return fail(res, log, { status: 403, code: 'device_auth_failed', event: 'grant_denied', detail: auth.reason });
  }
  const deviceHash = shortHash(auth.deviceId);

  const parsed = await readJsonBody(req);
  if (parsed.error) {
    return fail(res, log, { status: 400, code: 'invalid_request', event: 'grant_denied', deviceHash, detail: parsed.error });
  }
  const request = parsed.body ?? {};
  const { route_id: routeId, version, locale, tier, paths } = request;
  const shapeOk =
    typeof routeId === 'string' &&
    typeof version === 'string' &&
    typeof locale === 'string' &&
    typeof tier === 'string' &&
    Array.isArray(paths) && paths.length > 0 && paths.length <= MAX_PATHS &&
    paths.every((p) => typeof p === 'string');
  if (!shapeOk) {
    return fail(res, log, { status: 400, code: 'invalid_request', event: 'grant_denied', deviceHash, detail: 'shape' });
  }

  // Refuse unsafe paths before any catalog lookup so a malformed path can
  // never probe the mapping or the storage layout.
  if (paths.some((p) => isUnsafePath(p))) {
    return fail(res, log, { status: 403, code: 'path_not_allowed', event: 'grant_denied', deviceHash });
  }
  // The client never chooses the store product or the storage bucket: the
  // server maps route_id × tier → product itself (09 §5 boundary).
  const product = findProduct(catalog, routeId, tier);
  if (!product) {
    return fail(res, log, { status: 403, code: 'unknown_route_tier', event: 'grant_denied', deviceHash });
  }
  const manifestBase = manifestBaseOf(routeId, version, locale, tier);
  const manifest = catalog.manifests[manifestBase];
  if (!manifest) {
    return fail(res, log, { status: 403, code: 'manifest_not_found', event: 'grant_denied', deviceHash });
  }
  if (paths.some((p) => !manifest.paths.includes(p))) {
    return fail(res, log, { status: 403, code: 'path_not_allowed', event: 'grant_denied', deviceHash });
  }

  // Entitlement is verified by the server against the provider for the
  // authenticated device only. A provider outage fails closed with 503 and
  // Retry-After; a client-side "bought" flag never substitutes for this.
  const cacheKey = `${auth.deviceId}|${routeId}|${tier}`;
  const cached = positiveEntitlements.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && cached.environment === environment) {
    log('entitlement_cache_hit', { device_hash: deviceHash, expires_in_s: Math.round((cached.expiresAt - Date.now()) / 1000) });
  } else {
    const verdict = await provider.verifyEntitlement({ deviceId: auth.deviceId, productId: product.product_id });
    if (!verdict.ok) {
      return fail(res, log, {
        status: 503, code: 'entitlement_unavailable', event: 'grant_unavailable',
        deviceHash, detail: verdict.reason, headers: { 'retry-after': String(retryAfterSeconds) },
      });
    }
    if (!verdict.entitled) {
      return fail(res, log, { status: 403, code: 'no_entitlement', event: 'grant_denied', deviceHash });
    }
    if (verdict.environment !== environment) {
      return fail(res, log, {
        status: 403, code: 'environment_mismatch', event: 'grant_denied',
        deviceHash, detail: `provider_${verdict.environment}`,
      });
    }
    if (entitlementCacheTtlSeconds > 0) {
      positiveEntitlements.set(cacheKey, { environment, expiresAt: Date.now() + entitlementCacheTtlSeconds * 1000 });
    }
  }

  const now = Date.now();
  const urls = paths.map((path) => {
    const { token, expiresAt } = mintFileToken({ signingKey: urlSigningKey, manifestBase, path, deviceId: auth.deviceId, ttlSeconds: urlTtlSeconds, now });
    return { path, url: `/private/${token}`, expires_at: expiresAt };
  });
  log('grant_issued', { device_hash: deviceHash, file_count: urls.length, ttl_seconds: urlTtlSeconds });
  sendJson(res, 200, { lock_url: manifest.lock_url, urls });
}

function handlePrivateFile(res, log, context) {
  const { catalog, storageRoot, urlSigningKey, token } = context;
  const verdict = verifyFileToken({ signingKey: urlSigningKey, token });
  if (!verdict.ok) {
    const code = verdict.reason === 'expired' ? 'url_expired' : 'url_invalid';
    return fail(res, log, { status: 403, code, event: 'file_denied', deviceHash: verdict.deviceIdHash });
  }
  // Defence in depth: the token must still point at a manifest member.
  const manifest = catalog.manifests[verdict.manifestBase];
  if (!manifest || !manifest.paths.includes(verdict.path) || isUnsafePath(verdict.path)) {
    return fail(res, log, { status: 403, code: 'url_invalid', event: 'file_denied', deviceHash: verdict.deviceIdHash });
  }
  const root = tierRoot(storageRoot, verdict.manifestBase);
  const filePath = join(root, ...verdict.path.split('/'));
  if (!filePath.startsWith(root + sep) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return fail(res, log, { status: 403, code: 'url_invalid', event: 'file_denied', deviceHash: verdict.deviceIdHash });
  }
  const bytes = readFileSync(filePath);
  log('file_served', { device_hash: verdict.deviceIdHash, byte_count: bytes.length });
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length });
  res.end(bytes);
}
