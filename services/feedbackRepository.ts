// G16.02 — own-feedback repository over the durable zone B tables
// feedback_local/feedback_outbox (DDL: services/db/schema.ts; canon `21`
// §5.4: feedback_local holds target, acknowledged revision/score, draft and
// state; feedback_outbox holds the mutation id, expected_revision, payload,
// disclosure_version, created_at and transport state). The value lifecycle is
// §5.4 verbatim: draft → pending → sending → sent, a transient failure back
// to pending, 409 → conflict, 401/422 → action_required. The explicit Send
// transactionally persists the draft and the operation before the network; at
// most one in-flight operation per target (schema index one_inflight_feedback);
// an edit during the flight is the next desired value and flows after the ACK;
// a delete of a request that may have reached the server resolves its outcome
// first and CAS-deletes second.
//
// Boundaries: transactions belong to services/db (ADR G01.03 §3.3) — the
// exported inTransaction is reused, not restated. The wire request bodies
// (snake_case, `21` §5.3) are built by services/feedbackSync at the transport
// boundary. The target key and the draft/payload JSON are this module's own
// canonical serializations (sorted-key JSON, one mapping point each).
import { inTransaction } from './db/db.ts';
import type { SqlDriver, SqlValue } from './db/types.ts';

export type FeedbackErrorRule =
  | 'feedback-input-invalid'
  | 'feedback-write-failed'
  | 'feedback-transport-failed'
  | 'feedback-send-no-draft'
  | 'feedback-resolution-required';

export class FeedbackError extends Error {
  rule: FeedbackErrorRule;

  constructor(rule: FeedbackErrorRule, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FeedbackError';
    this.rule = rule;
  }
}

// The target identity the server CAS-runs on (supabase/functions/feedback/
// feedback-core.ts FeedbackTargetKey: kind guide|place; id = route_id or
// place_id; version = guide.version or place.content_version).
export interface FeedbackTarget {
  kind: 'guide' | 'place';
  id: string;
  version: string;
  locale: string;
}

// Verbatim from the canonical request-side patterns (feedback-core.ts
// TARGET_VERSION_PATTERN / REQUEST_LOCALE_PATTERN). The registry allowlist
// and the closed reason-code lists stay the server's authority — here only
// the structural shape is checked.
const TARGET_VERSION_PATTERN = '^[0-9]{1,64}$';
const REQUEST_LOCALE_PATTERN = '^[a-z][a-z0-9-]{0,34}$';

// The user's desired value while it is not the server's: a rating with the
// disclosure it was given under, or the intent to tombstone.
export type FeedbackDesiredValue =
  | { op: 'put'; score: number; reasonCodes: string[]; disclosureVersion: string }
  | { op: 'delete' };

// What the outbox payload column stores: the desired value without the
// disclosure — the disclosure_version column is its single carrier.
export type StoredMutationPayload = { op: 'put'; score: number; reasonCodes: string[] } | { op: 'delete' };

export type FeedbackValueState = 'draft' | 'pending' | 'sending' | 'sent' | 'conflict' | 'action_required';

export interface FeedbackDraftInput {
  score: number;
  reasonCodes: string[];
  disclosureVersion: string;
}

export interface FeedbackStateView {
  targetKey: string;
  target: FeedbackTarget;
  /** Last acknowledged server revision; 0 — nothing acknowledged yet. */
  revision: number;
  /** Last acknowledged score; null — nothing or tombstoned. */
  score: number | null;
  /** The next desired value (an edit made during a flight). */
  draft: FeedbackDesiredValue | null;
  state: FeedbackValueState;
  inFlight: { mutationId: string; value: StoredMutationPayload; transportState: 'pending' | 'sending' } | null;
}

// Canonical JSON: sorted top-level keys, so the same value always produces
// the same stored string (the target key is a PRIMARY KEY — it must be
// byte-stable across restarts).
function canonicalJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, Object.keys(value).sort());
}

function validateTarget(target: FeedbackTarget): void {
  if ((target.kind !== 'guide' && target.kind !== 'place') || typeof target.id !== 'string' || target.id === '') {
    throw new FeedbackError('feedback-input-invalid', 'target.kind/target.id: must be guide|place with a non-empty id');
  }
  if (typeof target.version !== 'string' || !new RegExp(TARGET_VERSION_PATTERN).test(target.version)) {
    throw new FeedbackError('feedback-input-invalid', 'target.version: invalid version');
  }
  if (typeof target.locale !== 'string' || !new RegExp(REQUEST_LOCALE_PATTERN).test(target.locale)) {
    throw new FeedbackError('feedback-input-invalid', 'target.locale: invalid locale');
  }
}

export function formatTargetKey(target: FeedbackTarget): string {
  validateTarget(target);
  return canonicalJson({ id: target.id, kind: target.kind, locale: target.locale, version: target.version });
}

export function parseTargetKey(key: string): FeedbackTarget {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(key) as Record<string, unknown>;
  } catch {
    throw new FeedbackError('feedback-input-invalid', 'target key: not JSON');
  }
  const target: FeedbackTarget = {
    kind: parsed['kind'] as FeedbackTarget['kind'],
    id: parsed['id'] as string,
    version: parsed['version'] as string,
    locale: parsed['locale'] as string,
  };
  validateTarget(target);
  return target;
}

// The score/reasons half of the put-value shape — shared by the draft input
// (which also carries the disclosure) and the stored outbox payload (which
// does not: the disclosure_version column is its carrier).
function validateScoreAndReasons(score: number, reasonCodes: string[]): void {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new FeedbackError('feedback-input-invalid', 'score: must be an integer 1..5');
  }
  if (
    !Array.isArray(reasonCodes) ||
    reasonCodes.length > 3 ||
    reasonCodes.some((code) => typeof code !== 'string' || code === '')
  ) {
    throw new FeedbackError('feedback-input-invalid', 'reasonCodes: at most 3 non-empty strings');
  }
  if (new Set(reasonCodes).size !== reasonCodes.length) {
    throw new FeedbackError('feedback-input-invalid', 'reasonCodes: duplicate reasons are not allowed');
  }
}

// The put-value validation both the form input and the stored serializations
// go through; each diagnostic names the offending field.
function validatePutValue(value: { score: number; reasonCodes: string[]; disclosureVersion: string }): void {
  validateScoreAndReasons(value.score, value.reasonCodes);
  if (typeof value.disclosureVersion !== 'string' || value.disclosureVersion === '') {
    throw new FeedbackError('feedback-input-invalid', 'disclosureVersion: must be a non-empty string');
  }
}

function parseDraftValue(draftJson: string): FeedbackDesiredValue {
  let draft: unknown;
  try {
    draft = JSON.parse(draftJson);
  } catch {
    throw new FeedbackError('feedback-input-invalid', 'stored draft: not JSON');
  }
  if (typeof draft !== 'object' || draft === null || Array.isArray(draft)) {
    throw new FeedbackError('feedback-input-invalid', 'stored draft: not an object');
  }
  const record = draft as Record<string, unknown>;
  if (record['op'] === 'delete') return { op: 'delete' };
  if (record['op'] !== 'put') {
    throw new FeedbackError('feedback-input-invalid', 'stored draft: unknown op');
  }
  const value: FeedbackDesiredValue = {
    op: 'put',
    score: record['score'] as number,
    reasonCodes: record['reasonCodes'] as string[],
    disclosureVersion: record['disclosureVersion'] as string,
  };
  validatePutValue(value);
  return value;
}

export function parseStoredPayload(payload: string): StoredMutationPayload {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    throw new FeedbackError('feedback-input-invalid', 'stored mutation payload: not JSON');
  }
  if (parsed['op'] === 'delete') return { op: 'delete' };
  if (parsed['op'] !== 'put') {
    throw new FeedbackError('feedback-input-invalid', 'stored mutation payload: unknown op');
  }
  const value = { op: 'put' as const, score: parsed['score'] as number, reasonCodes: parsed['reasonCodes'] as string[] };
  validateScoreAndReasons(value.score, value.reasonCodes);
  return value;
}

const OUTBOX_COLUMNS =
  'mutation_id, target, expected_revision, payload, disclosure_version, created_at, transport_state, attempts, next_attempt_at';

function getLocalRow(driver: SqlDriver, key: string): Record<string, SqlValue> | undefined {
  return driver.prepare('SELECT target, revision, score, draft, state FROM feedback_local WHERE target = ?').get(key);
}

// The target's in-flight operation, if any — at most one exists (the schema
// index one_inflight_feedback is the backstop; this read is the decision
// input).
function getInFlightRow(driver: SqlDriver, key: string): Record<string, SqlValue> | undefined {
  return driver
    .prepare(
      `SELECT ${OUTBOX_COLUMNS} FROM feedback_outbox
       WHERE target = ? AND transport_state IN ('pending', 'sending')
       ORDER BY created_at, mutation_id`,
    )
    .get(key);
}

function getStuckRow(driver: SqlDriver, key: string): Record<string, SqlValue> | undefined {
  return driver
    .prepare(
      "SELECT mutation_id, transport_state FROM feedback_outbox WHERE target = ? AND transport_state IN ('conflict', 'action_required')",
    )
    .get(key);
}

function insertPutOp(
  driver: SqlDriver,
  key: string,
  expectedRevision: number,
  payload: string,
  disclosureVersion: string,
  mutationId: string,
  now: number,
): void {
  try {
    driver
      .prepare(
        `INSERT INTO feedback_outbox (mutation_id, target, expected_revision, payload, disclosure_version, created_at, transport_state)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(mutationId, key, expectedRevision, payload, disclosureVersion, now);
  } catch (error) {
    throw new FeedbackError('feedback-write-failed', 'the one-in-flight index rejected a second operation', { cause: error });
  }
}

function insertDeleteOp(driver: SqlDriver, key: string, expectedRevision: number, mutationId: string, now: number): void {
  try {
    driver
      .prepare(
        `INSERT INTO feedback_outbox (mutation_id, target, expected_revision, payload, disclosure_version, created_at, transport_state)
         VALUES (?, ?, ?, ?, '', ?, 'pending')`,
      )
      .run(mutationId, key, expectedRevision, canonicalJson({ op: 'delete' }), now);
  } catch (error) {
    throw new FeedbackError('feedback-write-failed', 'the one-in-flight index rejected a second operation', { cause: error });
  }
}

// Saves (or replaces) the desired value. On a settled target the edit
// reopens 'draft'; during a flight the edit is stored as the next desired
// value and the flight's state stands (`21` §5.4).
export function saveDraft(driver: SqlDriver, target: FeedbackTarget, draft: FeedbackDraftInput, opts: { now: number }): void {
  validateTarget(target);
  validatePutValue(draft);
  const key = formatTargetKey(target);
  const draftJson = canonicalJson({
    disclosureVersion: draft.disclosureVersion,
    op: 'put',
    reasonCodes: [...draft.reasonCodes],
    score: draft.score,
  });
  inTransaction(driver, () => {
    const row = getLocalRow(driver, key);
    try {
      if (!row) {
        driver
          .prepare("INSERT INTO feedback_local (target, revision, score, draft, state) VALUES (?, 0, NULL, ?, 'draft')")
          .run(key, draftJson);
      } else {
        const state = row.state === 'draft' || row.state === 'sent' ? 'draft' : String(row.state);
        driver.prepare('UPDATE feedback_local SET draft = ?, state = ? WHERE target = ?').run(draftJson, state, key);
      }
    } catch (error) {
      throw new FeedbackError('feedback-write-failed', 'draft write failed', { cause: error });
    }
  });
}

export type SendOutcome =
  | { outcome: 'queued'; mutationId: string }
  | { outcome: 'already-in-flight'; mutationId: string }
  | { outcome: 'reconfirmed'; mutationId: string };

// The explicit Send: transactionally consumes the draft into an outbox
// operation BEFORE the network (`21` §5.4). On a target with a stuck
// mutation the outcome decides: a conflict needs the own-state read first;
// an action_required op is explicitly reconfirmed — the SAME mutation id is
// re-armed, because its server outcome is unknown and the idempotent replay
// answers it.
export function sendNow(driver: SqlDriver, target: FeedbackTarget, opts: { now: number; mutationId?: string }): SendOutcome {
  validateTarget(target);
  const key = formatTargetKey(target);
  return inTransaction(driver, () => {
    const stuck = getStuckRow(driver, key);
    if (stuck) {
      if (String(stuck.transport_state) === 'conflict') {
        throw new FeedbackError(
          'feedback-resolution-required',
          'the last mutation conflicted; read the own state first (resolveConflict), then send against the actual revision',
        );
      }
      driver
        .prepare(
          "UPDATE feedback_outbox SET transport_state = 'pending', next_attempt_at = NULL, created_at = ? WHERE mutation_id = ?",
        )
        .run(opts.now, String(stuck.mutation_id));
      driver.prepare("UPDATE feedback_local SET state = 'pending' WHERE target = ?").run(key);
      return { outcome: 'reconfirmed', mutationId: String(stuck.mutation_id) };
    }
    const flight = getInFlightRow(driver, key);
    if (flight) {
      return { outcome: 'already-in-flight', mutationId: String(flight.mutation_id) };
    }
    const local = getLocalRow(driver, key);
    if (!local || local.draft === null || local.draft === undefined) {
      throw new FeedbackError('feedback-send-no-draft', `no draft to send for ${key}`);
    }
    const value = parseDraftValue(String(local.draft));
    const mutationId = opts.mutationId ?? crypto.randomUUID();
    if (value.op === 'put') {
      insertPutOp(
        driver,
        key,
        Number(local.revision),
        canonicalJson({ op: 'put', reasonCodes: [...value.reasonCodes], score: value.score }),
        value.disclosureVersion,
        mutationId,
        opts.now,
      );
    } else {
      insertDeleteOp(driver, key, Number(local.revision), mutationId, opts.now);
    }
    driver.prepare("UPDATE feedback_local SET draft = NULL, state = 'pending' WHERE target = ?").run(key);
    return { outcome: 'queued', mutationId };
  });
}

export type DeleteOutcome =
  | { outcome: 'nothing' }
  | { outcome: 'cleared' }
  | { outcome: 'queued-delete'; mutationId: string }
  | { outcome: 'delete-acknowledges-send' };

// The user removes their feedback (`21` §5.4 delete flow): an unsent draft
// clears; a request that may have reached the server resolves first and the
// CAS-delete flows as the next desired value; a queued tombstone is kept, not
// recreated. A stuck mutation (conflict / action_required) has an unknown
// server outcome — the own-state read must come first.
export function deleteFeedback(driver: SqlDriver, target: FeedbackTarget, opts: { now: number; mutationId?: string }): DeleteOutcome {
  validateTarget(target);
  const key = formatTargetKey(target);
  return inTransaction(driver, () => {
    const local = getLocalRow(driver, key);
    if (!local) return { outcome: 'nothing' };
    if (getStuckRow(driver, key)) {
      throw new FeedbackError(
        'feedback-resolution-required',
        'the stuck mutation must be resolved by the own-state read first (resolveConflict)',
      );
    }
    const flight = getInFlightRow(driver, key);
    if (flight) {
      if (String(flight.transport_state) === 'sending') {
        driver.prepare('UPDATE feedback_local SET draft = ? WHERE target = ?').run(canonicalJson({ op: 'delete' }), key);
        return { outcome: 'delete-acknowledges-send' };
      }
      const payload = parseStoredPayload(String(flight.payload));
      if (payload.op === 'delete') {
        return { outcome: 'queued-delete', mutationId: String(flight.mutation_id) };
      }
      // Not yet dispatched: the operation never reached the network and is
      // cancelled with the draft.
      driver.prepare('DELETE FROM feedback_outbox WHERE mutation_id = ?').run(String(flight.mutation_id));
      return Number(local.revision) > 0
        ? queueTombstone(opts.mutationId ?? crypto.randomUUID())
        : clearTarget();
    }
    return Number(local.revision) > 0 ? queueTombstone(opts.mutationId ?? crypto.randomUUID()) : clearTarget();

    function queueTombstone(mutationId: string): DeleteOutcome {
      insertDeleteOp(driver, key, Number(local!.revision), mutationId, opts.now);
      driver.prepare("UPDATE feedback_local SET draft = NULL, state = 'pending' WHERE target = ?").run(key);
      return { outcome: 'queued-delete', mutationId };
    }

    function clearTarget(): DeleteOutcome {
      driver.prepare('DELETE FROM feedback_local WHERE target = ?').run(key);
      return { outcome: 'cleared' };
    }
  });
}

function sameReasons(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
}

// Applies a 2xx answer to its operation. The late-response guard: only the
// claimed, still-sending row this response belongs to may be acknowledged —
// a duplicated or stale response (re-armed row, deleted device) is dropped
// without touching any state (`21` §5.4: a late ACK never erases a newer
// draft). When the ACK lands on a newer desired value, that value becomes
// the follow-up operation with the acknowledged expected_revision.
export function applyAcknowledgement(
  driver: SqlDriver,
  mutationId: string,
  ack: { revision: number },
  opts: { now: number; followUpMutationId?: string },
): { applied: boolean; followUpQueued: boolean } {
  if (!Number.isInteger(ack.revision) || ack.revision < 1) {
    throw new FeedbackError('feedback-input-invalid', 'ack.revision: must be a positive integer');
  }
  return inTransaction(driver, () => {
    const row = driver.prepare(`SELECT ${OUTBOX_COLUMNS} FROM feedback_outbox WHERE mutation_id = ?`).get(mutationId);
    // The late-response guard: a genuine 2xx answers a dispatched operation —
    // one still queued (pending) or in flight (sending). Terminal states
    // (conflict/action_required) answered once already and a duplicated
    // delivery replays that same answer, so a 2xx here is not genuine; a
    // missing row means the operation is gone (acked, or the device was
    // deleted) — either way the response is dropped without touching state.
    if (!row || (String(row.transport_state) !== 'sending' && String(row.transport_state) !== 'pending')) {
      return { applied: false, followUpQueued: false };
    }
    const key = String(row.target);
    const local = getLocalRow(driver, key);
    if (!local) {
      // The device state was wiped mid-flight (clearDeviceAccountState): the
      // outbox leftover goes with it, nothing is resurrected (`21` §6).
      driver.prepare('DELETE FROM feedback_outbox WHERE mutation_id = ?').run(mutationId);
      return { applied: false, followUpQueued: false };
    }
    const payload = parseStoredPayload(String(row.payload));
    const ackedScore = payload.op === 'put' ? payload.score : null;
    const draft =
      local.draft === null || local.draft === undefined ? null : parseDraftValue(String(local.draft));
    const sameDesired =
      draft === null ||
      (draft.op === 'put' &&
        payload.op === 'put' &&
        draft.score === payload.score &&
        sameReasons(draft.reasonCodes, payload.reasonCodes) &&
        draft.disclosureVersion === String(row.disclosure_version)) ||
      (draft.op === 'delete' && payload.op === 'delete');
    // The consumed mutation leaves before the follow-up enters — the
    // one-in-flight index counts both inside this one transaction.
    driver.prepare('DELETE FROM feedback_outbox WHERE mutation_id = ?').run(mutationId);
    if (sameDesired) {
      driver
        .prepare("UPDATE feedback_local SET revision = ?, score = ?, draft = NULL, state = 'sent' WHERE target = ?")
        .run(ack.revision, ackedScore, key);
      return { applied: true, followUpQueued: false };
    }
    const followUpId = opts.followUpMutationId ?? crypto.randomUUID();
    if (draft!.op === 'put') {
      insertPutOp(
        driver,
        key,
        ack.revision,
        canonicalJson({ op: 'put', reasonCodes: [...draft!.reasonCodes], score: draft!.score }),
        draft!.disclosureVersion,
        followUpId,
        opts.now,
      );
    } else {
      insertDeleteOp(driver, key, ack.revision, followUpId, opts.now);
    }
    driver
      .prepare("UPDATE feedback_local SET revision = ?, score = ?, draft = NULL, state = 'pending' WHERE target = ?")
      .run(ack.revision, ackedScore, key);
    return { applied: true, followUpQueued: true };
  });
}

// Stores the truth of the own-state read (the conflict-resolution primitive
// of `21` §5.3: the client reads the actual own state instead of bypassing
// the conflict) and resolves the stuck mutations away. Pending/sending
// operations are not touched; a newer draft survives and may be sent against
// the actual revision.
export function storeAcknowledgedRead(
  driver: SqlDriver,
  target: FeedbackTarget,
  read: { revision: number; score: number | null; deleted: boolean },
  opts: { now: number },
): void {
  validateTarget(target);
  if (!Number.isInteger(read.revision) || read.revision < 0) {
    throw new FeedbackError('feedback-input-invalid', 'read.revision: must be a non-negative integer');
  }
  if (read.score !== null && (!Number.isInteger(read.score) || read.score < 1 || read.score > 5)) {
    throw new FeedbackError('feedback-input-invalid', 'read.score: must be an integer 1..5 or null');
  }
  if (typeof read.deleted !== 'boolean') {
    throw new FeedbackError('feedback-input-invalid', 'read.deleted: must be a boolean');
  }
  const key = formatTargetKey(target);
  inTransaction(driver, () => {
    const local = getLocalRow(driver, key);
    if (!local && read.revision === 0 && !read.deleted) {
      return; // the server has nothing and nothing is local — no row
    }
    const flight = getInFlightRow(driver, key);
    const state = flight
      ? String(local!.state)
      : local !== undefined && local.draft !== null && local.draft !== undefined
        ? 'draft'
        : 'sent';
    try {
      driver
        .prepare(
          `INSERT INTO feedback_local (target, revision, score, draft, state) VALUES (?, ?, ?, NULL, ?)
           ON CONFLICT(target) DO UPDATE SET revision = excluded.revision, score = excluded.score, state = excluded.state`,
        )
        .run(key, read.revision, read.deleted ? null : read.score, state);
    } catch (error) {
      throw new FeedbackError('feedback-write-failed', 'acknowledged-read write failed', { cause: error });
    }
    driver
      .prepare("DELETE FROM feedback_outbox WHERE target = ? AND transport_state IN ('conflict', 'action_required')")
      .run(key);
  });
}

function viewOf(driver: SqlDriver, key: string): FeedbackStateView | null {
  const local = getLocalRow(driver, key);
  if (!local) return null;
  const flight = getInFlightRow(driver, key);
  return {
    targetKey: key,
    target: parseTargetKey(key),
    revision: Number(local.revision),
    score: local.score === null || local.score === undefined ? null : Number(local.score),
    draft: local.draft === null || local.draft === undefined ? null : parseDraftValue(String(local.draft)),
    state: String(local.state) as FeedbackValueState,
    inFlight: flight
      ? {
          mutationId: String(flight.mutation_id),
          value: parseStoredPayload(String(flight.payload)),
          transportState: String(flight.transport_state) as 'pending' | 'sending',
        }
      : null,
  };
}

export function getFeedbackState(driver: SqlDriver, target: FeedbackTarget): FeedbackStateView | null {
  validateTarget(target);
  return viewOf(driver, formatTargetKey(target));
}

export function listFeedbackStates(driver: SqlDriver): FeedbackStateView[] {
  return driver
    .prepare('SELECT target FROM feedback_local ORDER BY target')
    .all()
    .map((row) => viewOf(driver, String(row.target))!);
}
