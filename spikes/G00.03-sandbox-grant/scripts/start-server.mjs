import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGrantServer } from '../server/grant-server.mjs';
import { createRevenueCatProvider } from '../server/provider.mjs';

// Live spike server per docs/architecture/09 §5. Env NAMES in .env.example;
// values are never printed. The test transport is not constructible from
// here — live mode always wires the RevenueCat provider, so a test provider
// cannot leak into a live run.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const required = [
  'GRANT_ENVIRONMENT',
  'GRANT_URL_SIGNING_KEY',
  'REVENUECAT_SECRET_API_KEY',
  'GRANT_STORAGE_ROOT',
  'DEVICES_FILE',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`missing required env variables: ${missing.join(', ')}`);
  process.exit(1);
}
const environment = process.env.GRANT_ENVIRONMENT;
if (environment !== 'sandbox' && environment !== 'production') {
  console.error('GRANT_ENVIRONMENT must be "sandbox" or "production"');
  process.exit(1);
}
const port = Number(process.env.PORT ?? 8787);
const urlTtlSeconds = Number(process.env.GRANT_URL_TTL_SECONDS ?? 600);
const entitlementCacheTtlSeconds = Number(process.env.GRANT_ENTITLEMENT_CACHE_TTL_SECONDS ?? 86400);
if (
  !Number.isInteger(port) || port <= 0 ||
  !Number.isInteger(urlTtlSeconds) || urlTtlSeconds <= 0 ||
  !Number.isInteger(entitlementCacheTtlSeconds) || entitlementCacheTtlSeconds < 0
) {
  console.error('PORT and GRANT_URL_TTL_SECONDS must be positive integers, GRANT_ENTITLEMENT_CACHE_TTL_SECONDS a non-negative integer');
  process.exit(1);
}

const catalog = JSON.parse(readFileSync(join(root, 'server', 'catalog.json'), 'utf8'));
const server = createGrantServer({
  catalog,
  devicesFile: process.env.DEVICES_FILE,
  storageRoot: process.env.GRANT_STORAGE_ROOT,
  provider: createRevenueCatProvider({
    secretApiKey: process.env.REVENUECAT_SECRET_API_KEY,
    baseUrl: process.env.REVENUECAT_BASE_URL || undefined,
  }),
  urlSigningKey: process.env.GRANT_URL_SIGNING_KEY,
  urlTtlSeconds,
  entitlementCacheTtlSeconds,
  environment,
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'grant_server_listening', host: '127.0.0.1', port, environment }));
});
