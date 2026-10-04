// G16.02 — acceptance suite for the own-feedback repository (issue #73):
// the transactional draft→outbox write over the durable zone B tables
// (services/db/schema.ts, `21` §5.4), one in-flight operation per target,
// edit/delete while an operation is in flight, late-ACK guards and the
// acknowledged-read store. Wire-level delivery lives in queue-sync.test.ts;
// crash/restart durability in queue-durability.test.ts.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAcknowledgement,
  deleteFeedback,
  FeedbackError,
  formatTargetKey,
  getFeedbackState,
  parseTargetKey,
  saveDraft,
  sendNow,
  storeAcknowledgedRead,
  type FeedbackDraftInput,
  type FeedbackTarget,
} from '../../services/feedbackRepository.ts';
import {
  DRAFT,
  GUIDE_TARGET,
  M1,
  M2,
  M3,
  NOW,
  PLACE_TARGET,
  openQueueStore,
  rawLocal,
  rawOutbox,
} from './queue-fixture.ts';

// Corrupt-input fixtures isolate one violation each and the message names it
// (implementation-rules 14).
function invalidDraftOf(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...DRAFT, ...overrides };
}

test('saveDraft rejects an invalid draft, naming the field, without writing', () => {
  const driver = openQueueStore();
  const cases: Array<[Record<string, unknown>, string]> = [
    [invalidDraftOf({ score: 0 }), 'score'],
    [invalidDraftOf({ score: 6 }), 'score'],
    [invalidDraftOf({ score: 2.5 }), 'score'],
    [invalidDraftOf({ reasonCodes: ['a', 'b', 'c', 'd'] }), 'reasonCodes'],
    [invalidDraftOf({ reasonCodes: ['a', 'a'] }), 'reasonCodes'],
    [invalidDraftOf({ reasonCodes: [3] }), 'reasonCodes'],
    [invalidDraftOf({ disclosureVersion: '' }), 'disclosureVersion'],
  ];
  for (const [draft, field] of cases) {
    assert.throws(
      () => saveDraft(driver, GUIDE_TARGET, draft as unknown as FeedbackDraftInput, { now: NOW }),
      (error: unknown) => error instanceof FeedbackError && error.rule === 'feedback-input-invalid' && error.message.includes(field),
      `expected a named diagnostic for ${field}`,
    );
  }
  assert.equal(rawLocal(driver, GUIDE_TARGET), undefined, 'no row is written for invalid input');
});

test('saveDraft rejects a malformed target, naming the target field', () => {
  const driver = openQueueStore();
  const targets: Array<[FeedbackTarget, string]> = [
    [{ kind: 'city', id: 'x', version: '1', locale: 'be' } as never, 'kind'],
    [{ kind: 'guide', id: '', version: '1', locale: 'be' }, 'id'],
    [{ kind: 'guide', id: 'g', version: 'v1', locale: 'be' }, 'version'],
    [{ kind: 'guide', id: 'g', version: '1', locale: 'BE' }, 'locale'],
  ];
  for (const [target, field] of targets) {
    assert.throws(
      () => saveDraft(driver, target, DRAFT, { now: NOW }),
      (error: unknown) => error instanceof FeedbackError && error.message.includes(field),
    );
  }
});

test('saveDraft then sendNow performs the transactional draft→outbox write', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  const view = getFeedbackState(driver, GUIDE_TARGET)!;
  assert.equal(view.state, 'draft');
  assert.equal(view.revision, 0);
  assert.equal(view.score, null);
  assert.deepEqual(view.draft, { op: 'put', ...DRAFT });

  const outcome = sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  assert.deepEqual(outcome, { outcome: 'queued', mutationId: M1 });

  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(local.state, 'pending');
  assert.equal(local.draft, null, 'the draft is consumed into the operation');
  const [op] = rawOutbox(driver);
  assert.equal(op.mutation_id, M1);
  assert.equal(op.target, formatTargetKey(GUIDE_TARGET));
  assert.equal(op.expected_revision, 0);
  assert.deepEqual(JSON.parse(String(op.payload)), { op: 'put', score: 2, reasonCodes: ['audio_problem'] });
  assert.equal(op.disclosure_version, 'feedback-disclosure-1');
  assert.equal(op.created_at, NOW);
  assert.equal(op.transport_state, 'pending');
  assert.equal(op.attempts, 0);
  assert.equal(op.next_attempt_at, null);
});

test('a second operation for a target in flight is refused — by the API and by the schema index', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  assert.deepEqual(sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M2 }), {
    outcome: 'already-in-flight',
    mutationId: M1,
  });
  assert.equal(rawOutbox(driver).length, 1, 'no second mutation was created');
  // The partial unique index is the schema-level backstop (the one_live_session
  // idiom): a direct second pending row for the same target cannot exist.
  assert.throws(
    () =>
      driver
        .prepare(
          "INSERT INTO feedback_outbox (mutation_id, target, expected_revision, payload, disclosure_version, created_at, transport_state) VALUES (?, ?, 0, '{}', '', ?, 'pending')",
        )
        .run(M2, formatTargetKey(GUIDE_TARGET), NOW),
    (error: unknown) => error instanceof Error && error.message.includes('UNIQUE constraint failed'),
  );
  // A different target is never blocked by the first target's operation.
  saveDraft(driver, PLACE_TARGET, DRAFT, { now: NOW });
  assert.deepEqual(sendNow(driver, PLACE_TARGET, { now: NOW, mutationId: M3 }).outcome, 'queued');
});

test('an edit while an operation is in flight waits for the acknowledged revision, then flows as the follow-up', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  saveDraft(driver, GUIDE_TARGET, { ...DRAFT, score: 4 }, { now: NOW + 1 });
  const view = getFeedbackState(driver, GUIDE_TARGET)!;
  assert.equal(view.state, 'pending', 'the target stays with its in-flight operation');
  assert.deepEqual(view.draft, { op: 'put', ...DRAFT, score: 4 }, 'the edit is the next desired value');

  const ack = applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 2, followUpMutationId: M2 });
  assert.deepEqual(ack, { applied: true, followUpQueued: true });
  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(local.revision, 1);
  assert.equal(local.score, 2, 'the acknowledged value is the server truth');
  assert.equal(local.state, 'pending');
  assert.equal(local.draft, null);
  const ops = rawOutbox(driver);
  assert.equal(ops.length, 1, 'the consumed mutation left, the follow-up entered — one in flight');
  assert.equal(ops[0].mutation_id, M2);
  assert.equal(ops[0].expected_revision, 1, 'the follow-up waits for the acknowledged revision');
  assert.deepEqual(JSON.parse(String(ops[0].payload)), { op: 'put', score: 4, reasonCodes: ['audio_problem'] });
});

test('an edit to the same value while in flight resolves without a follow-up', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  saveDraft(driver, GUIDE_TARGET, { ...DRAFT }, { now: NOW + 1 });
  const ack = applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 2, followUpMutationId: M2 });
  assert.deepEqual(ack, { applied: true, followUpQueued: false });
  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(local.state, 'sent');
  assert.equal(local.draft, null);
  assert.equal(rawOutbox(driver).length, 0);
});

test('a late or unknown acknowledgement is dropped without touching any state', () => {
  const driver = openQueueStore();
  assert.deepEqual(applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW }), {
    applied: false,
    followUpQueued: false,
  });
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  assert.deepEqual(applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 1 }), {
    applied: true,
    followUpQueued: false,
  });
  // The same mutation acknowledged again (a duplicated response) finds no row.
  assert.deepEqual(applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 2 }), {
    applied: false,
    followUpQueued: false,
  });
  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(local.state, 'sent');
  assert.equal(local.revision, 1);
});

test('a corrupt stored payload answers with a named diagnostic, not a crash', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  driver.prepare("UPDATE feedback_outbox SET payload = '{oops' , transport_state = 'sending' WHERE mutation_id = ?").run(M1);
  assert.throws(
    () => applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 1 }),
    (error: unknown) => error instanceof FeedbackError && error.rule === 'feedback-input-invalid',
  );
});

test('deleteFeedback: an unsent draft on a never-rated target clears without touching the server', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  assert.deepEqual(deleteFeedback(driver, GUIDE_TARGET, { now: NOW + 1 }), { outcome: 'cleared' });
  assert.equal(rawLocal(driver, GUIDE_TARGET), undefined);
  assert.equal(rawOutbox(driver).length, 0);
});

test('deleteFeedback: an acknowledged value queues a CAS-delete mutation', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 1 });
  assert.deepEqual(deleteFeedback(driver, GUIDE_TARGET, { now: NOW + 2, mutationId: M2 }), {
    outcome: 'queued-delete',
    mutationId: M2,
  });
  const [op] = rawOutbox(driver);
  assert.equal(op.mutation_id, M2);
  assert.equal(op.expected_revision, 1);
  assert.deepEqual(JSON.parse(String(op.payload)), { op: 'delete' });
  assert.equal(rawLocal(driver, GUIDE_TARGET)!.state, 'pending');
});

test('deleteFeedback: a pending un-dispatched operation is cancelled — the edit never reaches the server', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  assert.deepEqual(deleteFeedback(driver, GUIDE_TARGET, { now: NOW + 1, mutationId: M2 }), { outcome: 'cleared' });
  assert.equal(rawOutbox(driver).length, 0, 'the pending PUT left with the draft');
  assert.equal(rawLocal(driver, GUIDE_TARGET), undefined, 'the target has no server value and no draft');
});

test('deleteFeedback: a pending edit on a rated target cancels the edit and queues the tombstone', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 1 });
  saveDraft(driver, GUIDE_TARGET, { ...DRAFT, score: 5 }, { now: NOW + 2 });
  sendNow(driver, GUIDE_TARGET, { now: NOW + 3, mutationId: M2 });
  assert.deepEqual(deleteFeedback(driver, GUIDE_TARGET, { now: NOW + 4, mutationId: M3 }), {
    outcome: 'queued-delete',
    mutationId: M3,
  });
  const ops = rawOutbox(driver);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].mutation_id, M3, 'the cancelled edit left, the tombstone entered');
  assert.deepEqual(JSON.parse(String(ops[0].payload)), { op: 'delete' });
  assert.equal(ops[0].expected_revision, 1, 'the tombstone CAS-runs against the acknowledged revision');
});

test('deleteFeedback: a pending delete operation is kept, not recreated', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 1 });
  deleteFeedback(driver, GUIDE_TARGET, { now: NOW + 2, mutationId: M2 });
  assert.deepEqual(deleteFeedback(driver, GUIDE_TARGET, { now: NOW + 3, mutationId: M3 }), {
    outcome: 'queued-delete',
    mutationId: M2,
  });
  assert.equal(rawOutbox(driver).length, 1);
});

test('deleteFeedback: an in-flight send may have reached the server — the delete waits for its resolution', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  driver.prepare("UPDATE feedback_outbox SET transport_state = 'sending' WHERE mutation_id = ?").run(M1);
  driver.prepare('UPDATE feedback_local SET state = ? WHERE target = ?').run('sending', formatTargetKey(GUIDE_TARGET));
  assert.deepEqual(deleteFeedback(driver, GUIDE_TARGET, { now: NOW + 1 }), { outcome: 'delete-acknowledges-send' });
  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.deepEqual(JSON.parse(String(local.draft)), { op: 'delete' }, 'the delete is the next desired value');
  assert.equal(local.state, 'sending');
  assert.equal(rawOutbox(driver).length, 1, 'the in-flight PUT is untouched');
  // Resolution first, deletion second: the PUT's ACK queues the tombstone.
  const ack = applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 2, followUpMutationId: M2 });
  assert.deepEqual(ack, { applied: true, followUpQueued: true });
  const [op] = rawOutbox(driver);
  assert.equal(op.mutation_id, M2);
  assert.deepEqual(JSON.parse(String(op.payload)), { op: 'delete' });
  assert.equal(op.expected_revision, 1);
});

test('deleteFeedback refuses to act while the stuck operation needs a resolution read first', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  for (const stuck of ['conflict', 'action_required'] as const) {
    driver.prepare('UPDATE feedback_outbox SET transport_state = ? WHERE mutation_id = ?').run(stuck, M1);
    driver.prepare('UPDATE feedback_local SET state = ? WHERE target = ?').run(stuck, formatTargetKey(GUIDE_TARGET));
    assert.throws(
      () => deleteFeedback(driver, GUIDE_TARGET, { now: NOW + 1 }),
      (error: unknown) => error instanceof FeedbackError && error.rule === 'feedback-resolution-required',
      `expected resolution-required for ${stuck}`,
    );
    driver.prepare("UPDATE feedback_outbox SET transport_state = 'sending' WHERE mutation_id = ?").run(M1);
  }
});

test('a delete acknowledgement stores the tombstone revision and clears the score', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  applyAcknowledgement(driver, M1, { revision: 1 }, { now: NOW + 1 });
  deleteFeedback(driver, GUIDE_TARGET, { now: NOW + 2, mutationId: M2 });
  const ack = applyAcknowledgement(driver, M2, { revision: 2 }, { now: NOW + 3 });
  assert.deepEqual(ack, { applied: true, followUpQueued: false });
  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(local.revision, 2);
  assert.equal(local.score, null);
  assert.equal(local.state, 'sent');
  assert.equal(rawOutbox(driver).length, 0);
});

test('storeAcknowledgedRead stores the server truth, drops the stuck mutation and keeps a newer draft', () => {
  const driver = openQueueStore();
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  driver.prepare("UPDATE feedback_outbox SET transport_state = 'conflict' WHERE mutation_id = ?").run(M1);
  driver.prepare("UPDATE feedback_local SET state = 'conflict' WHERE target = ?").run(formatTargetKey(GUIDE_TARGET));
  saveDraft(driver, GUIDE_TARGET, { ...DRAFT, score: 4 }, { now: NOW + 1 });

  storeAcknowledgedRead(driver, GUIDE_TARGET, { revision: 5, score: 3, deleted: false }, { now: NOW + 2 });
  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(local.revision, 5);
  assert.equal(local.score, 3);
  assert.equal(local.state, 'draft', 'the newer draft survives the refresh and may be sent against revision 5');
  assert.equal(rawOutbox(driver).length, 0, 'the conflicting mutation is resolved away');
  const view = getFeedbackState(driver, GUIDE_TARGET)!;
  assert.equal(view.revision, 5);
  assert.deepEqual(view.draft, { op: 'put', ...DRAFT, score: 4 });
});

test('storeAcknowledgedRead of an empty server row writes nothing when there is nothing local', () => {
  const driver = openQueueStore();
  storeAcknowledgedRead(driver, GUIDE_TARGET, { revision: 0, score: null, deleted: false }, { now: NOW });
  assert.equal(rawLocal(driver, GUIDE_TARGET), undefined);
});

test('storeAcknowledgedRead of a tombstoned row stores the null score', () => {
  const driver = openQueueStore();
  storeAcknowledgedRead(driver, GUIDE_TARGET, { revision: 3, score: null, deleted: true }, { now: NOW });
  const local = rawLocal(driver, GUIDE_TARGET)!;
  assert.equal(local.revision, 3);
  assert.equal(local.score, null);
  assert.equal(local.state, 'sent');
});

test('the target key round-trips and rejects corrupt keys', () => {
  const key = formatTargetKey(PLACE_TARGET);
  assert.deepEqual(parseTargetKey(key), PLACE_TARGET);
  for (const corrupt of ['', 'nonsense', '{"kind":"city","id":"x","version":"1","locale":"be"}', '[]']) {
    assert.throws(
      () => parseTargetKey(corrupt),
      (error: unknown) => error instanceof FeedbackError && error.rule === 'feedback-input-invalid',
    );
  }
});

test('getFeedbackState exposes the in-flight operation with its stored value', () => {
  const driver = openQueueStore();
  assert.equal(getFeedbackState(driver, GUIDE_TARGET), null);
  saveDraft(driver, GUIDE_TARGET, DRAFT, { now: NOW });
  sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
  const view = getFeedbackState(driver, GUIDE_TARGET)!;
  assert.equal(view.targetKey, formatTargetKey(GUIDE_TARGET));
  assert.deepEqual(view.target, GUIDE_TARGET);
  assert.deepEqual(view.inFlight, {
    mutationId: M1,
    transportState: 'pending',
    value: { op: 'put', score: 2, reasonCodes: ['audio_problem'] },
  });
});
