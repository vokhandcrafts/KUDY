// G20.11 — deterministic demo of the URL TTL policy boundary (issue #482).
// The core refuses any URL TTL outside the canonical short-lived policy
// (N5; 09 §2, private-zone TTL 10 min) before any port runs. The round runs
// on the shared demo harness (demo-grant-harness.ts): real Postgres
// (PGlite), production SQL ports, faked provider/manifest/signer on a fixed
// clock. Device and product identifiers are seeded at runtime and never
// printed.
import { createGrantDemoHarness } from './demo-grant-harness.ts';
import { GRANT_URL_TTL_SECONDS, handleGrant } from './grant-core.ts';

const harness = await createGrantDemoHarness(['audio/story-01.mp3']);
try {

  const request = { route_id: 'demo-route', version: 'v1', locale: 'be', tier: 'extended', paths: ['audio/story-01.mp3'] };
  const sandbox = { environment: 'sandbox' as const };

  // 1. The canonical 600 s mints exactly 600 s.
  const canonical = await handleGrant(request, harness.deviceId, { ...sandbox, urlTtlSeconds: GRANT_URL_TTL_SECONDS }, harness.deps);
  console.log('600 s →', JSON.stringify(canonical));

  // 2. One second over the cap: the round fails closed — no mint call, and the
  // gate fires before the positive cache or the provider could answer.
  const oversized = await handleGrant(request, harness.deviceId, { ...sandbox, urlTtlSeconds: 601 }, harness.deps);
  console.log('601 s →', JSON.stringify(oversized), '/ mints', harness.mintCalls, '/ provider calls', harness.providerCalls);

  // 3. Zero, fractional and non-finite TTLs are refused the same way.
  for (const ttl of [0, 0.5, NaN]) {
    const answer = await handleGrant(request, harness.deviceId, { ...sandbox, urlTtlSeconds: ttl }, harness.deps);
    console.log(`ttl ${ttl} →`, JSON.stringify(answer.status === 200 ? answer : { status: answer.status, code: answer.code }), '/ mints', harness.mintCalls);
  }

  // 4. Absent configuration is the 600 s default — and it still mints.
  const absent = await handleGrant(request, harness.deviceId, sandbox, harness.deps);
  console.log('absent config → status', absent.status, '/ mints', harness.mintCalls, '/ canonical ttl', GRANT_URL_TTL_SECONDS);
} finally {
  await harness.close();
}
