// G16.02 — acceptance suite for the feedback delivery sync (issue #73):
// serialized per-target dispatch over the injected transport, the crash
// windows (lost-ACK recovery, late responses, device deletion mid-flight),
// the 409/401/429 outcomes, the bounded transient backoff and the seven-day
// reconfirmation (`21` §5.3/§5.4/§6). The store-side lifecycle lives in
// queue-repository.test.ts; restart durability in queue-durability.test.ts.
import assert from 'node:assert/strict';
import test from 'node:test';

import { clearDeviceAccountState } from '../../services/db/db.ts';
import {
  applyAcknowledgement,
  deleteFeedback,
  formatTargetKey,
  saveDraft,
  sendNow,
} from '../../services/feedbackRepository.ts';
import { createFeedbackSync, FEEDBACK_SYNC_LIMITS, nextDelayS, type FeedbackSync } from '../../services/feedbackSync.ts';
import { stubGlobalFetch } from '../../services/fetch-stub-test-fixture.ts';
import {
  DRAFT,
  GUIDE_TARGET,
  GUIDE_WIRE,
  M1,
  M2,
  NOW,
  PLACE_TARGET,
  deferred,
  err401,
  err409,
  err429,
  err503,
  okDelete,
  okPut,
  okRead,
  openIdentifiedStore,
  openQueueStore,
  rawLocal,
  rawOutbox,
  scriptedTransport,
  secretBox,
} from './queue-fixture.ts';

const SECRET = 'test-device-secret';
const BASE_URL = 'https://functions.example.invalid/functions/v1';

type Driver = ReturnType<typeof openQueueStore>;
type Secrets = ReturnType<typeof secretBox>;
type Transport = ReturnType<typeof scriptedTransport>;

function makeSync(driver: Driver, secrets: Secrets, transport: Transport, clock?: { value: number }): FeedbackSync {
  return createFeedbackSync({
    driver,
    secretStore: secrets,
    baseUrl: BASE_URL,
    transport,
    now: () => clock?.value ?? NOW,
    makeMutationId: () => M2,
  });
}

function queueOne(driver: Driver, now = NOW): void {
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now });
  sendNow(driver, GUIDE_TARGET, { now, mutationId: M1 });
}

test('flush delivers one queued mutation and applies the acknowledgement', async () => {
  const driver = openIdentifiedStore();
  queueOne(driver);
  const transport = scriptedTransport(({ op, body, index }) => {
    assert.equal(op, 'put');
    assert.equal(index, 0);
    assert.deepEqual(body, {
      mutation_id: M1,
      target: GUIDE_WIRE,
      expected_revision: 0,
      score: 2,
      reason_codes: ['audio_problem'],
      disclosure_version: 'feedback-disclosure-1',
    });
    return okPut(1);
  });
  const report = await makeSync(driver, secretBox(SECRET), transport).flush();
  assert.deepEqual(report, {
    skippedNoIdentity: false,
    dispatched: 1,
    acknowledged: 1,
    followUpsQueued: 0,
    conflicts: 0,
    actionRequired: 0,
    requeued: 0,
    lateAcksDropped: 0,
    stoppedStale: 0,
  });
  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(local.state, 'sent');
  assert.equal(local.revision, 1);
  assert.equal(local.score, 2);
  assert.equal(rawOutbox(driver).length, 0);
});

test('flush without a device identity is inert — it never registers and never replays', async () => {
  const driver = openIdentifiedStore();
  queueOne(driver);
  const secrets = secretBox(null);
  const transport = scriptedTransport(() => {
    throw new Error('the transport must not be called without an identity');
  });
  const report = await makeSync(driver, secrets, transport).flush();
  assert.equal(report.skippedNoIdentity, true);
  assert.equal(transport.calls.length, 0);
  assert.equal(secrets.saved, 0, 'no device registration happened behind the sync');
});

test('a crash after the send-commit re-sends the same mutation and recovers', async () => {
  const driver = openIdentifiedStore();
  queueOne(driver);
  // The persistent crash state mid-fetch: the claim marked both rows sending
  // and the process died before the response — recreated verbatim here.
  driver.prepare("UPDATE feedback_outbox SET transport_state = 'sending' WHERE mutation_id = ?").run(M1);
  driver.prepare("UPDATE feedback_local SET state = 'sending' WHERE target = ?").run(formatTargetKey(GUIDE_TARGET));
  const transport = scriptedTransport(({ index }) => {
    assert.ok(index <= 1);
    return okPut(1);
  });
  const report = await makeSync(driver, secretBox(SECRET), transport).flush();
  assert.equal(report.dispatched, 1);
  assert.equal(transport.calls.length, 1);
  assert.equal((transport.calls[0].body as { mutation_id: string }).mutation_id, M1, 'the same mutation id is retried, not a second one');
  assert.equal(rawLocal(driver, GUIDE_TARGET)!.state, 'sent');
  assert.equal(rawOutbox(driver).length, 0);
});

test('a late duplicated acknowledgement is dropped and cannot erase a newer draft', async () => {
  const driver = openIdentifiedStore();
  queueOne(driver);
  saveDraft(driver, GUIDE_TARGET, { ...DRAFT, score: 4 }, { now: NOW + 1 });
  const transport = scriptedTransport(({ index }) => (index === 0 ? okPut(1) : okPut(2)));
  await makeSync(driver, secretBox(SECRET), transport).flush();
  // The ACK applied the queued value and the newer draft flowed as the
  // follow-up in the same round — against the acknowledged revision.
  assert.equal(transport.calls.length, 2);
  assert.equal((transport.calls[0].body as { mutation_id: string }).mutation_id, M1);
  assert.equal((transport.calls[1].body as { mutation_id: string }).mutation_id, M2);
  assert.equal((transport.calls[1].body as { expected_revision: number }).expected_revision, 1);
  assert.equal(rawOutbox(driver).length, 0);
  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(local.revision, 2);
  assert.equal(local.score, 4, 'the newer desired value is the acknowledged truth');
  // The first mutation's response arrives a second time (a duplicated
  // delivery after the crash-retry): the row is gone, the guard drops it.
  assert.deepEqual(applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 2 }), {
    applied: false,
    followUpQueued: false,
  });
  const after = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(after.revision, 2, 'the late duplicate changed nothing');
  assert.equal(after.score, 4);
  // And the next flush has nothing left to send.
  assert.equal((await makeSync(driver, secretBox(SECRET), transport).flush()).dispatched, 0);
});

test('409 stops auto-retry and resolveConflict reads the own state to unlock the target', async () => {
  const driver = openIdentifiedStore();
  queueOne(driver);
  const transport = scriptedTransport(({ index }) => (index === 0 ? err409() : okRead(5, 3, false)));
  const sync = makeSync(driver, secretBox(SECRET), transport);
  const report = await sync.flush();
  assert.equal(report.conflicts, 1);
  assert.equal(rawLocal(driver, GUIDE_TARGET)!.state, 'conflict');
  // Auto-retry never bypasses the conflict: the next flush does not dispatch.
  assert.equal((await sync.flush()).dispatched, 0);
  // The client reads the actual own state and shows the conflict result.
  const resolved = await sync.resolveConflict(GUIDE_TARGET);
  assert.deepEqual(resolved, { status: 'resolved', revision: 5, score: 3, deleted: false });
  assert.equal(rawLocal(driver, GUIDE_TARGET)!.state, 'sent');
  assert.equal(rawOutbox(driver).length, 0);
  // With the actual revision known, a new explicit send CAS-runs against it.
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW + 1 });
  assert.deepEqual(sendNow(driver, GUIDE_TARGET, { now: NOW + 2, mutationId: M2 }).outcome, 'queued');
  assert.equal(rawOutbox(driver)[0].expected_revision, 5);
});

test('401 marks action-required, never registers a device and never replays history', async () => {
  const driver = openIdentifiedStore();
  queueOne(driver);
  const secrets = secretBox(SECRET);
  const transport = scriptedTransport(() => err401());
  const sync = makeSync(driver, secrets, transport);
  const report = await sync.flush();
  assert.equal(report.actionRequired, 1);
  assert.equal(rawLocal(driver, GUIDE_TARGET)!.state, 'action_required');
  assert.equal(secrets.saved, 0, 'a 401 does not auto-register a device');
  assert.equal(secrets.cleared, 0);
  // The stopped queue does not replay: no further dispatch without a human step.
  assert.equal((await sync.flush()).dispatched, 0);
  assert.equal(transport.calls.length, 1);
  // The conflict-resolution read is equally refused — the state stays put.
  assert.deepEqual(await sync.resolveConflict(GUIDE_TARGET), { status: 'unreadable', httpStatus: 401 });
  assert.equal(rawLocal(driver, GUIDE_TARGET)!.state, 'action_required');
});

test('429 honors Retry-After and gates the next dispatch', async () => {
  const driver = openIdentifiedStore();
  queueOne(driver);
  const clock = { value: NOW };
  const transport = scriptedTransport(({ index }) => (index === 0 ? err429(90) : okPut(1)));
  const sync = makeSync(driver, secretBox(SECRET), transport, clock);
  const report = await sync.flush();
  assert.equal(report.requeued, 1);
  clock.value = NOW + 89_000;
  assert.equal((await sync.flush()).dispatched, 0, 'before Retry-After elapses');
  clock.value = NOW + 90_000;
  assert.equal((await sync.flush()).dispatched, 1);
  assert.equal((transport.calls[1].body as { mutation_id: string }).mutation_id, M1, 'the same mutation is retried');
  assert.equal(rawLocal(driver, GUIDE_TARGET)!.state, 'sent');
});

test('a transient failure backs off exponentially with a hard cap, jittered per mutation', async () => {
  const driver = openIdentifiedStore();
  queueOne(driver);
  const clock = { value: NOW };
  const transport = scriptedTransport(({ index }) => (index < 2 ? err503() : okPut(1)));
  const sync = makeSync(driver, secretBox(SECRET), transport, clock);
  assert.equal((await sync.flush()).requeued, 1);
  // The schedule is the §5.4 ladder jittered by the mutation id: the next
  // attempt fires exactly then — not before, not after the window.
  const first = nextDelayS(0, M1);
  clock.value = NOW + first * 1000 - 1;
  assert.equal((await sync.flush()).dispatched, 0, 'inside the first backoff window');
  clock.value = NOW + first * 1000;
  assert.equal((await sync.flush()).requeued, 1, 'second failure doubles the window');
  const second = nextDelayS(1, M1);
  clock.value = NOW + (first + second) * 1000 - 1;
  assert.equal((await sync.flush()).dispatched, 0, 'inside the doubled window');
  clock.value = NOW + (first + second) * 1000;
  const capped = await sync.flush();
  assert.equal(capped.dispatched, 1);
  assert.equal(rawLocal(driver, GUIDE_TARGET)!.state, 'sent');
});

test('the jittered schedule is deterministic per mutation, ladder-shaped and hard-capped', () => {
  // §5.4: «backoff 2, 4, 8… секунд, мяжа 5 хвілін, з jitter» — the same
  // mutation always schedules the same wait, the ladder grows, and no
  // schedule ever exceeds the five-minute cap.
  const first = nextDelayS(0, M1);
  const doubled = nextDelayS(1, M1);
  assert.equal(nextDelayS(0, M1), first, 'same mutation id — same schedule');
  assert.ok(first >= FEEDBACK_SYNC_LIMITS.baseRetryDelayS * 0.8 && first < FEEDBACK_SYNC_LIMITS.baseRetryDelayS * 1.2, 'the first window is the 2 s step jittered');
  assert.equal(doubled, first * 2, 'the ladder doubles within the same mutation');
  assert.ok(nextDelayS(30, M1) <= FEEDBACK_SYNC_LIMITS.maxRetryDelayS, 'the cap holds at five minutes');
  assert.ok(nextDelayS(0, M2) !== first || nextDelayS(1, M2) !== doubled, 'different mutations stagger differently');
});

test('mutations older than seven days stop auto-retry until explicit reconfirmation', async () => {
  const driver = openIdentifiedStore();
  const old = NOW - 8 * 24 * 3600 * 1000;
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: old });
  sendNow(driver, GUIDE_TARGET, { now: old, mutationId: M1 });
  const transport = scriptedTransport(() => okPut(1));
  const sync = makeSync(driver, secretBox(SECRET), transport);
  const report = await sync.flush();
  assert.equal(report.stoppedStale, 1);
  assert.equal(report.dispatched, 0);
  assert.equal(rawLocal(driver, GUIDE_TARGET)!.state, 'action_required');
  // Explicit reconfirmation re-arms the same mutation (idempotent on the server).
  assert.deepEqual(sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M2 }), {
    outcome: 'reconfirmed',
    mutationId: M1,
  });
  assert.equal((await sync.flush()).dispatched, 1);
  assert.equal((transport.calls[0].body as { mutation_id: string }).mutation_id, M1);
});

test('a corrupt stored payload answers action-required instead of crashing the flush', async () => {
  const driver = openIdentifiedStore();
  queueOne(driver);
  driver.prepare('UPDATE feedback_outbox SET payload = ? WHERE mutation_id = ?').run('not-json', M1);
  const transport = scriptedTransport(() => {
    throw new Error('a corrupt payload must not reach the transport');
  });
  const report = await makeSync(driver, secretBox(SECRET), transport).flush();
  assert.equal(report.actionRequired, 1);
  assert.equal(transport.calls.length, 0);
});

test('device deletion mid-flight: the late response is dropped, nothing is resurrected, no re-registration', async () => {
  const driver = openIdentifiedStore();
  queueOne(driver);
  const gate = deferred<undefined>();
  const transport = scriptedTransport(() => gate.promise.then(() => okPut(1)));
  const secrets = secretBox(SECRET);
  const sync = makeSync(driver, secrets, transport);
  const inFlight = sync.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(transport.calls.length, 1, 'the mutation is on the wire');
  // The user deletes the device account while the request is in the air.
  clearDeviceAccountState(driver);
  await secrets.clearSecret();
  gate.resolve(undefined);
  const report = await inFlight;
  assert.equal(report.acknowledged, 0);
  assert.equal(report.lateAcksDropped, 1, 'the response of a deleted device is dropped by the guard');
  assert.equal(Number(driver.prepare('SELECT COUNT(*) AS n FROM feedback_local').get()!.n), 0);
  assert.equal(Number(driver.prepare('SELECT COUNT(*) AS n FROM feedback_outbox').get()!.n), 0);
  // The next flush is inert and never registers a replacement device.
  const after = await sync.flush();
  assert.equal(after.skippedNoIdentity, true);
  assert.equal(transport.calls.length, 1, 'no further dispatch');
  assert.equal(secrets.saved, 0);
});

test('flush delivers several targets one at a time in their queue order', async () => {
  const driver = openIdentifiedStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  saveDraft(driver, PLACE_TARGET, { ...DRAFT, score: 3 }, { now: NOW + 1 });
  sendNow(driver, PLACE_TARGET, { now: NOW + 1, mutationId: M2 });
  const order: string[] = [];
  const transport = scriptedTransport(({ op, body }) => {
    order.push(`${op}:${(body as { target: { kind: string } }).target.kind}`);
    return okPut(1);
  });
  const report = await makeSync(driver, secretBox(SECRET), transport).flush();
  assert.equal(report.dispatched, 2);
  assert.deepEqual(order, ['put:guide', 'put:place']);
});

test('the default transport maps the canonical endpoint, sends the bearer and parses Retry-After', async () => {
  const driver = openIdentifiedStore();
  queueOne(driver);
  const stub = stubGlobalFetch(async (input, init) => {
    assert.equal(String(input), 'https://functions.example.invalid/functions/v1/feedback');
    assert.equal(init?.method, 'PUT');
    assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${SECRET}`);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      mutation_id: M1,
      target: GUIDE_WIRE,
      expected_revision: 0,
      score: 2,
      reason_codes: ['audio_problem'],
      disclosure_version: 'feedback-disclosure-1',
    });
    return {
      status: 429,
      text: async () => '{"error":"feedback_rate_limited"}',
      headers: { get: (name: string) => (name === 'retry-after' ? '7' : null) },
    };
  });
  try {
    const sync = createFeedbackSync({
      driver,
      secretStore: secretBox(SECRET),
      baseUrl: BASE_URL,
      now: () => NOW,
      makeMutationId: () => M2,
    });
    const report = await sync.flush();
    assert.equal(report.requeued, 1);
    assert.equal(stub.requests.length, 1);
    // The scheduled retry honors the server's Retry-After seconds.
    assert.equal(Number(rawOutbox(driver)[0].next_attempt_at), NOW + 7000);
  } finally {
    stub.restore();
  }
});

test('a delete mutation is delivered through the same flush', async () => {
  const driver = openIdentifiedStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 1 });
  deleteFeedback(driver, GUIDE_TARGET, { now: NOW + 2, mutationId: M2 });
  const transport = scriptedTransport(({ op, index }) => {
    if (index === 0) {
      assert.equal(op, 'delete');
      return okDelete(2);
    }
    throw new Error('only the delete is queued here');
  });
  const report = await makeSync(driver, secretBox(SECRET), transport).flush();
  assert.equal(report.acknowledged, 1);
  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(local.score, null);
  assert.equal(local.revision, 2);
  assert.equal(local.state, 'sent');
});
