// G16.01 — the committed behavioral contract, executed: every case of
// fixtures/discovery-contract/feedback-cases.json (the G01.06 output this
// task consumes) runs through the production edge wiring
// (feedback-wire.handleFeedbackEdgeRequest) against real Postgres (PGlite),
// with the registry seeded through the production import+publish path.
//
// The device-delete case drives the production DELETE /v1/device handler
// (device-wire). G09.03 pinned that endpoint's success code to 204; the
// fixture row `cas-delete-device` predates the pin and says 200 — this
// suite asserts the production contract's 204 (the drift is recorded in
// docs/agent-tasks/results/G16.01.md), then verifies the fixture's actual
// point: the next feedback call on the deleted device answers 401 and
// cannot re-register.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { handleDeviceRequest } from '../../functions/_shared/device-wire.ts';
import { handleFeedbackEdgeRequest } from '../../functions/feedback/feedback-wire.ts';
import {
  FEEDBACK_CASES_PATH,
  feedbackRequest,
  freshFeedbackDatabase,
  pgliteFeedbackClient,
  publishFixtureTargets,
  registerFeedbackDevice,
  testFeedbackConfig,
} from './test-support.ts';

interface FixtureCase {
  id: string;
  request: { method: string; device: string; body: Record<string, unknown> };
  expected: { status: number; body?: Record<string, unknown> };
}

const fixture = JSON.parse(readFileSync(FEEDBACK_CASES_PATH, 'utf8')) as {
  disclosure_version: string;
  targets: Array<Record<string, unknown>>;
  cases: FixtureCase[];
};

test('every feedback-cases.json case passes through the production wiring', async () => {
  const db = await freshFeedbackDatabase();
  const client = pgliteFeedbackClient(db);
  const config = testFeedbackConfig();

  const devices = new Map<string, { deviceId: string; secret: string }>();
  for (const name of ['device-a', 'device-b']) {
    devices.set(name, await registerFeedbackDevice(db));
  }
  await publishFixtureTargets(db, fixture.targets);

  const outcomes: Array<{ id: string; status: number; body: unknown }> = [];
  for (const entry of fixture.cases) {
    const device = devices.get(entry.request.device)!;
    if (entry.request.method === 'DELETE /v1/device') {
      const response = await handleDeviceRequest(
        { method: 'DELETE', headers: { get: (name) => (name === 'authorization' ? `Bearer ${device.secret}` : null) } },
        client,
      );
      assert.equal(response.status, 204, `${entry.id}: the production device delete answers 204 (G09.03 closed list)`);
      outcomes.push({ id: entry.id, status: response.status, body: null });
      continue;
    }
    const [method, urlPath] = entry.request.method.split(' ');
    const response = await handleFeedbackEdgeRequest(
      feedbackRequest({
        method: method!,
        url: `https://feedback.test${urlPath}`,
        body: entry.request.body,
        secret: device.secret,
      }),
      client,
      config,
    );
    const body = response.status === 204 ? null : await response.json();
    assert.equal(response.status, entry.expected.status, `${entry.id}: status`);
    if (entry.expected.body !== undefined) {
      assert.deepEqual(body, entry.expected.body, `${entry.id}: body`);
    }
    outcomes.push({ id: entry.id, status: response.status, body });
  }
  assert.equal(outcomes.length, fixture.cases.length);
});

test('rejected writes leave no data and the ledger dedupes replays (fixture companions)', async () => {
  const db = await freshFeedbackDatabase();
  const client = pgliteFeedbackClient(db);
  const config = testFeedbackConfig();
  const deviceA = await registerFeedbackDevice(db);
  const deviceB = await registerFeedbackDevice(db);
  await publishFixtureTargets(db, fixture.targets);

  const call = (device: { secret: string }, method: string, urlPath: string, body: unknown) =>
    handleFeedbackEdgeRequest(
      feedbackRequest({ method, url: `https://feedback.test${urlPath}`, body, secret: device.secret }),
      client,
      config,
    );

  // cas-create + cas-edit + cas-delete for device A (fixture ids 1, 3, 5).
  const target = { kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' };
  assert.deepEqual(
    await (await call(deviceA, 'PUT', '/v1/feedback', {
      mutation_id: '00000000-0000-4000-8000-000000000001',
      target,
      expected_revision: 0,
      score: 2,
      reason_codes: ['audio_problem'],
      disclosure_version: fixture.disclosure_version,
    })).json(),
    { revision: 1, saved: true },
  );
  assert.deepEqual(
    await (await call(deviceA, 'PUT', '/v1/feedback', {
      mutation_id: '00000000-0000-4000-8000-000000000002',
      target,
      expected_revision: 1,
      score: 4,
      reason_codes: ['interesting_stories', 'audio_problem'],
      disclosure_version: fixture.disclosure_version,
    })).json(),
    { revision: 2, saved: true },
  );

  // Invalid scores change nothing: the place target stays unrateated.
  for (const score of [0, 6, 3.5]) {
    const response = await call(deviceB, 'PUT', '/v1/feedback', {
      mutation_id: '00000000-0000-4000-8000-0000000000f0',
      target: { kind: 'place', place_id: 'place-a1', content_version: '1', locale: 'be' },
      expected_revision: 0,
      score,
      reason_codes: [],
      disclosure_version: fixture.disclosure_version,
    });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: 'invalid_scale' });
  }
  const placeRow = await db.query(
    "select count(*)::int as c from feedback_current where target_id = 'place-a1'",
  );
  assert.equal(placeRow.rows[0]?.c, 0, 'invalid scores must leave no rows (acceptance 2)');

  // The mutation ledger holds exactly the committed mutations: the lost-ACK
  // retry (fixture case 2) replays without a second ledger row.
  const replay = await call(deviceA, 'PUT', '/v1/feedback', {
    mutation_id: '00000000-0000-4000-8000-000000000001',
    target,
    expected_revision: 0,
    score: 2,
    reason_codes: ['audio_problem'],
    disclosure_version: fixture.disclosure_version,
  });
  assert.deepEqual(await replay.json(), { revision: 1, saved: true });
  const ledger = await db.query(
    "select count(*)::int as c from feedback_mutations where mutation_id = '00000000-0000-4000-8000-000000000001'",
  );
  assert.equal(ledger.rows[0]?.c, 1, 'an identical retry must not append a second mutation');
});
