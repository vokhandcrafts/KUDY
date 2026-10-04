// G16.02 — feedback delivery sync (`21` §5.3/§5.4/§6): serialized per-target
// dispatch of the feedback_outbox mutations over the injected transport, the
// honest crash-window recovery (the same mutation id replayed — the server's
// idempotency answers it), the outcome mapping (409 → conflict, 401/413/422 →
// action-required, 429 → Retry-After, everything else → bounded transient
// backoff, seven days → auto-retry stops until explicit reconfirmation) and
// the own-state read that resolves a conflict. The sync never registers a
// device: without an identity it is inert, and a 401 stops the queue instead
// of replaying history under a fresh device (`21` §6).
//
// The wire field sets below are the server contract's (`21` §5.3 request
// tables; supabase/functions/feedback/feedback-core.ts PUT_REQUIRED_FIELDS /
// DELETE_REQUIRED_FIELDS / validateReadBody) — copied verbatim at the one
// transport boundary, camelCase ends here.
import { getDeviceId, inTransaction } from './db/db.ts';
import type { SqlDriver, SqlValue } from './db/types.ts';
import type { SecureSecretStore } from './device.ts';
import { withWaitLimit } from './network-wait.ts';
import { assertNotRedirected, parseSecureEndpointUrl, SecureUrlError } from './secure-url.ts';
import {
  applyAcknowledgement,
  FeedbackError,
  parseStoredPayload,
  parseTargetKey,
  storeAcknowledgedRead,
  type FeedbackTarget,
} from './feedbackRepository.ts';

export type FeedbackTargetWire =
  | { kind: 'guide'; route_id: string; version: string; locale: string }
  | { kind: 'place'; place_id: string; content_version: string; locale: string };

export interface FeedbackPutRequest {
  mutation_id: string;
  target: FeedbackTargetWire;
  expected_revision: number;
  score: number;
  reason_codes: string[];
  disclosure_version: string;
}

export interface FeedbackDeleteRequest {
  mutation_id: string;
  target: FeedbackTargetWire;
  expected_revision: number;
}

export interface FeedbackTransportResponse {
  status: number;
  body: unknown;
  retryAfterSeconds?: number;
}

export interface FeedbackTransport {
  put(body: FeedbackPutRequest): Promise<FeedbackTransportResponse>;
  deleteFeedback(body: FeedbackDeleteRequest): Promise<FeedbackTransportResponse>;
  read(target: FeedbackTargetWire): Promise<FeedbackTransportResponse>;
}

// Single mapping point: repository target key ↔ wire object (id = route_id |
// place_id, version = version | content_version — feedback-core.ts
// validateTarget).
function toWireTarget(target: FeedbackTarget): FeedbackTargetWire {
  return target.kind === 'guide'
    ? { kind: 'guide', route_id: target.id, version: target.version, locale: target.locale }
    : { kind: 'place', place_id: target.id, content_version: target.version, locale: target.locale };
}

export const FEEDBACK_SYNC_LIMITS = {
  /** One feedback round-trip including the body (the device idiom). */
  waitMs: 15_000,
  /** First transient backoff window — `21` §5.4 pins the ladder verbatim:
   *  «backoff 2, 4, 8… секунд». */
  baseRetryDelayS: 2,
  /** The hard cap of any backoff schedule — `21` §5.4: «мяжа 5 хвілін». */
  maxRetryDelayS: 300,
  /** `21` §6: auto-retry is limited to seven days, then explicit reconfirmation. */
  reconfirmAfterS: 7 * 24 * 3_600,
} as const;

interface SyncLimits {
  waitMs: number;
  baseRetryDelayS: number;
  maxRetryDelayS: number;
  reconfirmAfterS: number;
}

// `21` §5.4: «з jitter». The factor is derived from the mutation id — stable
// per mutation (evidence and tests stay reproducible) yet different across
// targets, which is what staggers retry herds.
function jitterFactor(mutationId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < mutationId.length; i++) {
    hash ^= mutationId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return 0.8 + (0.4 * (hash / 0x100000000));
}

// The schedule of the next automatic attempt: the §5.4 ladder, jittered per
// mutation and hard-capped. A server-sent Retry-After is honored as given
// (clamped to the cap) — the server asked for that exact wait.
export function nextDelayS(attempts: number, mutationId: string, limits: SyncLimits = FEEDBACK_SYNC_LIMITS): number {
  const base = Math.min(limits.baseRetryDelayS * 2 ** attempts, limits.maxRetryDelayS);
  return Math.min(base * jitterFactor(mutationId), limits.maxRetryDelayS);
}

interface OutboxRow extends Record<string, SqlValue> {
  mutation_id: string;
  target: string;
  expected_revision: number;
  payload: string;
  disclosure_version: string;
  created_at: number;
  transport_state: string;
  attempts: number;
  next_attempt_at: number | null;
}

const OUTBOX_SELECT = `
  SELECT mutation_id, target, expected_revision, payload, disclosure_version, created_at,
         transport_state, attempts, next_attempt_at
  FROM feedback_outbox`;

// The default transport: the canonical /v1/feedback[-read|-delete] suffixes
// mapped onto the functions base (the wiring's path mapping), the device
// bearer, the N3 endpoint validation before the network and the finite wait
// that covers the body — the services/device idiom, one variant.
function defaultTransport(baseUrl: string, limits: SyncLimits, bearer: () => Promise<string | null>): FeedbackTransport {
  const request = async (
    method: 'PUT' | 'POST',
    path: string,
    body: unknown,
    name: string,
  ): Promise<FeedbackTransportResponse> => {
    const secret = await bearer();
    if (secret === null) {
      throw new FeedbackError('feedback-transport-failed', `${name}: no device secret to authenticate with`);
    }
    let endpoint: URL;
    try {
      endpoint = parseSecureEndpointUrl(`${baseUrl}${path}`, name);
    } catch (error) {
      const message = error instanceof SecureUrlError ? error.message : `${name}: the endpoint URL is not parseable`;
      throw new FeedbackError('feedback-transport-failed', message, { cause: error });
    }
    try {
      return await withWaitLimit('wait-feedback', limits.waitMs, async (signal) => {
        const response = await fetch(endpoint, {
          method,
          headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          redirect: 'error',
          signal,
        });
        assertNotRedirected(endpoint, response, name);
        const text = await response.text();
        let parsed: unknown = null;
        try {
          parsed = text === '' ? null : JSON.parse(text);
        } catch {
          parsed = null;
        }
        const header = response.headers?.get?.('retry-after') ?? null;
        const retryAfterSeconds = header === null ? undefined : Number(header);
        return {
          status: response.status,
          body: parsed,
          retryAfterSeconds: retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        };
      });
    } catch (error) {
      if (error instanceof FeedbackError) throw error;
      throw new FeedbackError('feedback-transport-failed', `${name}: the request failed`, { cause: error });
    }
  };
  return {
    put: (body) => request('PUT', '/feedback', body, 'feedback put'),
    deleteFeedback: (body) => request('POST', '/feedback/delete', body, 'feedback delete'),
    read: (target) => request('POST', '/feedback/read', { target }, 'feedback read'),
  };
}

export interface FlushReport {
  skippedNoIdentity: boolean;
  dispatched: number;
  acknowledged: number;
  followUpsQueued: number;
  conflicts: number;
  actionRequired: number;
  requeued: number;
  lateAcksDropped: number;
  stoppedStale: number;
}

export type ResolveOutcome =
  | { status: 'resolved'; revision: number; score: number | null; deleted: boolean }
  | { status: 'unreadable'; httpStatus: number }
  | { status: 'no-identity' };

export interface FeedbackSync {
  /** One dispatch round: every due mutation at most once per call. */
  flush(): Promise<FlushReport>;
  /** The own-state read that resolves a conflicted target (21 §5.3). */
  resolveConflict(target: FeedbackTarget): Promise<ResolveOutcome>;
}

// One flush per store at a time — concurrent callers await the same round
// (the ensureDeviceIdentity memoization idiom).
const inflightFlush = new WeakMap<SqlDriver, Promise<FlushReport>>();

export function createFeedbackSync(deps: {
  driver: SqlDriver;
  secretStore: SecureSecretStore;
  /** Functions base URL, e.g. https://<ref>.supabase.co/functions/v1 */
  baseUrl: string;
  transport?: FeedbackTransport;
  now?: () => number;
  makeMutationId?: () => string;
  limits?: Partial<SyncLimits>;
}): FeedbackSync {
  const limits: SyncLimits = { ...FEEDBACK_SYNC_LIMITS, ...deps.limits };
  const now = deps.now ?? Date.now;
  const makeMutationId = deps.makeMutationId ?? (() => crypto.randomUUID());
  const transport = deps.transport ?? defaultTransport(deps.baseUrl, limits, () => deps.secretStore.getSecret());

  function claimMutation(mutationId: string): boolean {
    return inTransaction(deps.driver, () => {
      const claimed = deps.driver
        .prepare("UPDATE feedback_outbox SET transport_state = 'sending' WHERE mutation_id = ? AND transport_state = 'pending'")
        .run(mutationId);
      if (Number(claimed.changes) === 0) return false;
      deps.driver
        .prepare(
          "UPDATE feedback_local SET state = 'sending' WHERE target = (SELECT target FROM feedback_outbox WHERE mutation_id = ?) AND state = 'pending'",
        )
        .run(mutationId);
      return true;
    });
  }

  // Transient failure / 429: the attempt is recorded and the next dispatch is
  // scheduled — the backoff for transient failures, the server's Retry-After
  // (clamped) for the rate limit; always the same mutation.
  function markAttempt(mutationId: string, targetKey: string, delayS: number): void {
    const at = now();
    inTransaction(deps.driver, () => {
      deps.driver
        .prepare(
          "UPDATE feedback_outbox SET transport_state = 'pending', attempts = attempts + 1, next_attempt_at = ? WHERE mutation_id = ? AND transport_state = 'sending'",
        )
        .run(at + delayS * 1000, mutationId);
      deps.driver
        .prepare("UPDATE feedback_local SET state = 'pending' WHERE target = ? AND state = 'sending'")
        .run(targetKey);
    });
  }

  function markConflict(mutationId: string, targetKey: string): void {
    inTransaction(deps.driver, () => {
      deps.driver
        .prepare("UPDATE feedback_outbox SET transport_state = 'conflict' WHERE mutation_id = ? AND transport_state = 'sending'")
        .run(mutationId);
      deps.driver.prepare("UPDATE feedback_local SET state = 'conflict' WHERE target = ? AND state = 'sending'").run(targetKey);
    });
  }

  function markActionRequired(mutationId: string, targetKey: string): void {
    inTransaction(deps.driver, () => {
      deps.driver
        .prepare(
          "UPDATE feedback_outbox SET transport_state = 'action_required' WHERE mutation_id = ? AND transport_state = 'sending'",
        )
        .run(mutationId);
      deps.driver
        .prepare("UPDATE feedback_local SET state = 'action_required' WHERE target = ? AND state = 'sending'")
        .run(targetKey);
    });
  }

  // `21` §5.3 answer list: success carries {revision, saved|deleted}; the
  // malformed-success corner (a contract violation, not a transient) stops
  // the mutation as action-required instead of looping.
  function validateAck(row: OutboxRow, body: unknown): { ok: true; revision: number } | { ok: false } {
    if (typeof body !== 'object' || body === null) return { ok: false };
    const record = body as Record<string, unknown>;
    const revision = record['revision'];
    if (!Number.isInteger(revision) || (revision as number) < 1) return { ok: false };
    const payload = parseStoredPayload(row.payload);
    if (payload.op === 'put' && record['saved'] !== true) return { ok: false };
    if (payload.op === 'delete' && record['deleted'] !== true) return { ok: false };
    return { ok: true, revision: revision as number };
  }

  function validateReadBody(body: unknown): { revision: number; score: number | null; deleted: boolean } {
    if (typeof body !== 'object' || body === null) {
      throw new FeedbackError('feedback-input-invalid', 'feedback read: the response is not an object');
    }
    const record = body as Record<string, unknown>;
    const revision = record['revision'];
    const score = record['score'];
    const deleted = record['deleted'];
    if (!Number.isInteger(revision) || (revision as number) < 0) {
      throw new FeedbackError('feedback-input-invalid', 'feedback read: revision is missing');
    }
    if (score !== null && (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 5)) {
      throw new FeedbackError('feedback-input-invalid', 'feedback read: score is invalid');
    }
    if (typeof deleted !== 'boolean') {
      throw new FeedbackError('feedback-input-invalid', 'feedback read: deleted is missing');
    }
    return { revision: revision as number, score: score as number | null, deleted };
  }

  function applyResponse(row: OutboxRow, response: FeedbackTransportResponse, report: FlushReport): void {
    if (response.status === 200) {
      const ack = validateAck(row, response.body);
      if (!ack.ok) {
        markActionRequired(row.mutation_id, row.target);
        report.actionRequired++;
        return;
      }
      const result = applyAcknowledgement(deps.driver, row.mutation_id, { revision: ack.revision }, {
        now: now(),
        followUpMutationId: makeMutationId(),
      });
      if (result.applied) {
        report.acknowledged++;
        if (result.followUpQueued) report.followUpsQueued++;
      } else {
        report.lateAcksDropped++;
      }
      return;
    }
    if (response.status === 409) {
      markConflict(row.mutation_id, row.target);
      report.conflicts++;
      return;
    }
    if (response.status === 401 || response.status === 413 || response.status === 422) {
      markActionRequired(row.mutation_id, row.target);
      report.actionRequired++;
      return;
    }
    if (response.status === 429) {
      const serverDelay = Number.isFinite(response.retryAfterSeconds) ? Number(response.retryAfterSeconds) : undefined;
      const delayS = Math.max(1, Math.min(serverDelay ?? nextDelayS(Number(row.attempts), row.mutation_id), limits.maxRetryDelayS));
      markAttempt(row.mutation_id, row.target, delayS);
      report.requeued++;
      return;
    }
    // 503 and everything else: temporary — bounded backoff, same mutation.
    markAttempt(row.mutation_id, row.target, nextDelayS(Number(row.attempts), row.mutation_id));
    report.requeued++;
  }

  async function dispatchOne(row: OutboxRow, report: FlushReport): Promise<void> {
    if (!claimMutation(row.mutation_id)) return; // raced; the row's lifecycle continued elsewhere
    report.dispatched++;
    let request: Promise<FeedbackTransportResponse>;
    try {
      const target = parseTargetKey(row.target);
      const payload = parseStoredPayload(row.payload);
      const wire = toWireTarget(target);
      request =
        payload.op === 'put'
          ? transport.put({
              mutation_id: row.mutation_id,
              target: wire,
              expected_revision: Number(row.expected_revision),
              score: payload.score,
              reason_codes: [...payload.reasonCodes],
              disclosure_version: String(row.disclosure_version),
            })
          : transport.deleteFeedback({
              mutation_id: row.mutation_id,
              target: wire,
              expected_revision: Number(row.expected_revision),
            });
    } catch {
      // Corrupt local data answers action-required (diagnostics, not a crash)
      // — auto-retry cannot fix bytes.
      markActionRequired(row.mutation_id, row.target);
      report.actionRequired++;
      return;
    }
    let response: FeedbackTransportResponse;
    try {
      response = await request;
    } catch {
      markAttempt(row.mutation_id, row.target, nextDelayS(Number(row.attempts), row.mutation_id));
      report.requeued++;
      return;
    }
    applyResponse(row, response, report);
  }

  async function flushOnce(): Promise<FlushReport> {
    const report: FlushReport = {
      skippedNoIdentity: false,
      dispatched: 0,
      acknowledged: 0,
      followUpsQueued: 0,
      conflicts: 0,
      actionRequired: 0,
      requeued: 0,
      lateAcksDropped: 0,
      stoppedStale: 0,
    };
    const secret = await deps.secretStore.getSecret();
    if (secret === null || getDeviceId(deps.driver) === null) {
      // No identity, no queue: registration belongs to ensureDeviceIdentity
      // and is never a side effect of the feedback sync (`21` §6).
      report.skippedNoIdentity = true;
      return report;
    }
    // Restart recovery: within one process the in-flight guard keeps a single
    // flush, so a 'sending' row at this point survived a crash mid-fetch —
    // the honest state is queued, the same mutation is replayed.
    inTransaction(deps.driver, () => {
      deps.driver.execSql("UPDATE feedback_outbox SET transport_state = 'pending' WHERE transport_state = 'sending'");
      deps.driver.execSql("UPDATE feedback_local SET state = 'pending' WHERE state = 'sending'");
    });
    // Seven-day stop (`21` §6): mutations older than the window leave the
    // auto-retry; the explicit reconfirmation (sendNow) re-arms them and
    // restarts their window.
    const staleCut = now() - limits.reconfirmAfterS * 1000;
    for (const stale of deps.driver
      .prepare(`${OUTBOX_SELECT} WHERE transport_state = 'pending' AND created_at < ? ORDER BY created_at, mutation_id`)
      .all(staleCut)) {
      const row = stale as OutboxRow;
      inTransaction(deps.driver, () => {
        deps.driver
          .prepare("UPDATE feedback_outbox SET transport_state = 'action_required' WHERE mutation_id = ? AND transport_state = 'pending'")
          .run(row.mutation_id);
        deps.driver.prepare("UPDATE feedback_local SET state = 'action_required' WHERE target = ?").run(row.target);
      });
      report.stoppedStale++;
    }
    // One dispatch round, in queue order; a requeued mutation waits for its
    // schedule and is picked up by a later flush.
    const attempted = new Set<string>();
    for (;;) {
      const due = (deps.driver.prepare(`${OUTBOX_SELECT} WHERE transport_state = 'pending' ORDER BY created_at, mutation_id`).all() as OutboxRow[]).filter(
        (row) =>
          !attempted.has(row.mutation_id) &&
          (row.next_attempt_at === null || row.next_attempt_at === undefined || now() >= Number(row.next_attempt_at)),
      );
      if (due.length === 0) break;
      for (const row of due) {
        attempted.add(row.mutation_id);
        await dispatchOne(row, report);
      }
    }
    return report;
  }

  return {
    flush(): Promise<FlushReport> {
      const running = inflightFlush.get(deps.driver);
      if (running) return running;
      const promise = flushOnce().finally(() => inflightFlush.delete(deps.driver));
      inflightFlush.set(deps.driver, promise);
      return promise;
    },

    async resolveConflict(target: FeedbackTarget): Promise<ResolveOutcome> {
      const secret = await deps.secretStore.getSecret();
      if (secret === null || getDeviceId(deps.driver) === null) return { status: 'no-identity' };
      let response: FeedbackTransportResponse;
      try {
        response = await transport.read(toWireTarget(target));
      } catch {
        return { status: 'unreadable', httpStatus: 0 };
      }
      if (response.status !== 200) return { status: 'unreadable', httpStatus: response.status };
      const read = validateReadBody(response.body);
      storeAcknowledgedRead(deps.driver, target, read, { now: now() });
      return { status: 'resolved', revision: read.revision, score: read.deleted ? null : read.score, deleted: read.deleted };
    },
  };
}
