// G08.02 — deterministic demo of the /v1/grant server boundaries (issue
// #289). The gate matrix runs on the shared demo harness
// (demo-grant-harness.ts): real Postgres (PGlite), production SQL ports,
// faked provider/manifest/signer on a fixed clock. Device and product
// identifiers are seeded at runtime and never printed.
import { createGrantDemoHarness } from './demo-grant-harness.ts';
import { GRANT_RETRY_AFTER_SECONDS, GRANT_URL_TTL_SECONDS, handleGrant } from './grant-core.ts';

const harness = await createGrantDemoHarness(['audio/story-01.mp3', 'audio/story-02.mp3']);
try {
  const { deviceId, deps } = harness;
  const sandbox = { environment: 'sandbox' as const };

  const request = (paths: string[]) => ({
    route_id: 'demo-route',
    version: 'v1',
    locale: 'be',
    tier: 'extended',
    paths,
  });

  // 1. A path outside the manifest → refused before the entitlement check.
  console.log('foreign path →', JSON.stringify(await handleGrant(request(['audio/other.mp3']), deviceId, sandbox, deps)));

  // 2. No purchase → 403; the refusal is never cached.
  harness.setVerdict({ ok: true, entitled: false, environment: null });
  console.log('not entitled →', JSON.stringify(await handleGrant(request(['audio/story-01.mp3']), deviceId, sandbox, deps)));

  // 3. Provider outage → 503 with Retry-After, not a denial.
  harness.setVerdict({ ok: false, reason: 'unavailable' });
  console.log('provider down →', JSON.stringify(await handleGrant(request(['audio/story-01.mp3']), deviceId, sandbox, deps)));

  // 4. A sandbox entitlement never opens the production server.
  harness.setVerdict({ ok: true, entitled: true, environment: 'sandbox' });
  console.log(
    'sandbox → production:',
    JSON.stringify(await handleGrant(request(['audio/story-01.mp3']), deviceId, { environment: 'production' }, deps)),
  );

  // 5. Entitled on the matching environment → exactly the requested members.
  const granted = await handleGrant(request(['audio/story-02.mp3']), deviceId, sandbox, deps);
  console.log(
    'entitled → status',
    granted.status,
    'members',
    granted.status === 200 ? JSON.stringify(granted.body.urls.map((grantedUrl) => grantedUrl.path)) : '-',
  );
  console.log('url ttl seconds', GRANT_URL_TTL_SECONDS, '/ retry-after seconds', GRANT_RETRY_AFTER_SECONDS);

  // 6. The positive cache answers the repeated request without the provider.
  const before = harness.providerCalls;
  const again = await handleGrant(request(['audio/story-02.mp3']), deviceId, sandbox, deps);
  console.log('cache hit skips provider:', again.status === 200 && harness.providerCalls === before);
} finally {
  await harness.close();
}
