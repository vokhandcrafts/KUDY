// G16.02 — durability suite for the feedback queue (issue #73): the queue
// survives process restarts and discovery-cache rebuilds, device deletion
// cancels it without touching downloads or run progress, and the v1→v2
// migration is additive on an existing store (`21` §5.4/§6, `09` §5/§7).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  clearDeviceAccountState,
  getDeviceId,
  openDatabase,
  rebuildDerived,
  setDeviceId,
  setSetting,
  startSession,
  upsertBundleAsset,
} from '../../services/db/db.ts';
import { migrationSteps } from '../../services/db/schema.ts';
import { nodeSqliteDriver, nodeSqliteFileDriver } from '../../services/db/test-fixture.ts';
import type { SqlDriver } from '../../services/db/types.ts';
import { applyAcknowledgement, formatTargetKey, saveDraft, sendNow } from '../../services/feedbackRepository.ts';
import { createFeedbackSync } from '../../services/feedbackSync.ts';
import {
  DRAFT,
  GUIDE_TARGET,
  M1,
  M2,
  NOW,
  okPut,
  openIdentifiedStore,
  openQueueStore,
  rawLocal,
  rawOutbox,
  scriptedTransport,
  secretBox,
} from './queue-fixture.ts';

const SECRET = 'test-device-secret';
const BASE_URL = 'https://functions.example.invalid/functions/v1';
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';

test('a restart resumes the queue: the same mutation is delivered once and acknowledged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-g1602-'));
  const file = path.join(dir, 'queue.db');
  try {
    const first = nodeSqliteFileDriver(file);
    openDatabase(first.driver);
    setDeviceId(first.driver, DEVICE_ID);
    saveDraft(first.driver, GUIDE_TARGET, DRAFT, { now: NOW });
    sendNow(first.driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
    const targetKey = formatTargetKey(GUIDE_TARGET);
    // The process dies before the flush; the reopened store holds the queue.
    first.close();
    const second = nodeSqliteFileDriver(file);
    try {
      openDatabase(second.driver);
      const transport = scriptedTransport(({ body }) => {
        assert.equal((body as { mutation_id: string }).mutation_id, M1);
        return okPut(1);
      });
      const report = await createFeedbackSync({
        driver: second.driver,
        secretStore: secretBox(SECRET),
        baseUrl: BASE_URL,
        transport,
        now: () => NOW,
        makeMutationId: () => M2,
      }).flush();
      assert.equal(report.dispatched, 1);
      assert.equal(report.acknowledged, 1);
      assert.equal(rawOutbox(second.driver).length, 0);
      const local = rawLocal(second.driver, GUIDE_TARGET)!;
      assert.equal(local.revision, 1);
      assert.equal(local.state, 'sent');
      assert.equal(local.target, targetKey, 'the target key is unchanged across the restart');
    } finally {
      second.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a discovery-cache rebuild preserves drafts, queued mutations and acknowledged values', async () => {
  const driver = openIdentifiedStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 1 });
  saveDraft(driver, GUIDE_TARGET, { ...DRAFT, score: 4 }, { now: NOW + 2 });

  rebuildDerived(driver);
  rebuildDerived(driver);

  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(local.revision, 1);
  assert.equal(local.score, 2);
  assert.deepEqual(JSON.parse(String(local.draft)), {
    op: 'put',
    score: 4,
    reasonCodes: ['audio_problem'],
    disclosureVersion: 'feedback-disclosure-1',
  });
  assert.equal(local.state, 'draft');
  assert.equal(rawOutbox(driver).length, 0, 'the acknowledged mutation stayed consumed');
  // The queue still delivers after the rebuild.
  sendNow(driver, GUIDE_TARGET, { now: NOW + 3, mutationId: M2 });
  const report = await createFeedbackSync({
    driver,
    secretStore: secretBox(SECRET),
    baseUrl: BASE_URL,
    transport: scriptedTransport(() => okPut(2)),
    now: () => NOW + 3,
    makeMutationId: () => M2,
  }).flush();
  assert.equal(report.acknowledged, 1);
  assert.equal(rawLocal(driver, GUIDE_TARGET)!.revision, 2);
});

test('device deletion cancels the queue and keeps downloaded bundles and run progress', () => {
  const driver = openQueueStore();
  setDeviceId(driver, DEVICE_ID);
  startSession(driver, {
    sessionId: '22222222-2222-4222-8222-222222222222',
    routeId: 'route-x',
    version: '1',
    locale: 'be',
    startedAt: NOW,
  });
  upsertBundleAsset(driver, {
    routeId: 'route-x',
    version: '1',
    locale: 'be',
    tier: 'base',
    path: 'stops.json',
    status: 'complete',
    bytesTotal: 10,
    bytesDone: 10,
    sha256: 'aa',
  });
  setSetting(driver, 'analytics_consent', 'granted');
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });

  clearDeviceAccountState(driver);

  assert.equal(Number(driver.prepare('SELECT COUNT(*) AS n FROM feedback_local').get()!.n), 0);
  assert.equal(Number(driver.prepare('SELECT COUNT(*) AS n FROM feedback_outbox').get()!.n), 0);
  assert.equal(getDeviceId(driver), null);
  assert.equal(Number(driver.prepare('SELECT COUNT(*) AS n FROM bundle_asset').get()!.n), 1, 'downloads stay');
  assert.equal(Number(driver.prepare('SELECT COUNT(*) AS n FROM session').get()!.n), 1, 'run progress stays');
});

test('the v1→v2 migration is additive: existing queue rows survive and the one-in-flight index appears', () => {
  const driver: SqlDriver = nodeSqliteDriver();
  // A genuine v1 store: only the first migration has run.
  openDatabase(driver, [migrationSteps[0]!]);
  assert.equal(Number(driver.prepare('PRAGMA user_version').get()!.user_version), 1);
  // A v1-era row without the v2 columns.
  const targetKey = formatTargetKey(GUIDE_TARGET);
  driver
    .prepare(
      "INSERT INTO feedback_outbox (mutation_id, target, expected_revision, payload, disclosure_version, created_at, transport_state) VALUES (?, ?, 0, '{}', '', ?, 'pending')",
    )
    .run(M1, targetKey, NOW);

  openDatabase(driver); // applies step 2

  assert.equal(Number(driver.prepare('PRAGMA user_version').get()!.user_version), migrationSteps.length);
  const row = driver.prepare('SELECT * FROM feedback_outbox WHERE mutation_id = ?').get(M1)!;
  assert.equal(row.attempts, 0, 'the new column defaults, no data rewritten');
  assert.equal(row.next_attempt_at, null);
  const index = driver.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'one_inflight_feedback'").get();
  assert.ok(index, 'the schema-level one-in-flight backstop exists');
  // The index is live: a second pending mutation for the same target fails.
  assert.throws(() =>
    driver
      .prepare(
        "INSERT INTO feedback_outbox (mutation_id, target, expected_revision, payload, disclosure_version, created_at, transport_state) VALUES (?, ?, 0, '{}', '', ?, 'pending')",
      )
      .run(M2, targetKey, NOW),
  );
});
