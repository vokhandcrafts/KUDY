// G16.02 — shared arrange for the feedback queue suites: an open store, the
// fixture-contract targets (fixtures/discovery-contract/feedback-cases.json),
// a scripted transport with parked responses for the crash-window scenarios
// and a fixed clock. Test-only module — imported by the tests/feedback
// suites, never by production code (the jscpd gate: one variant).
import { openDatabase, setDeviceId } from '../../services/db/db.ts';
import { nodeSqliteDriver } from '../../services/db/test-fixture.ts';
import type { SqlDriver } from '../../services/db/types.ts';
import type { FeedbackDeleteRequest, FeedbackPutRequest, FeedbackTargetWire, FeedbackTransport, FeedbackTransportResponse } from '../../services/feedbackSync.ts';
import { formatTargetKey, type FeedbackTarget } from '../../services/feedbackRepository.ts';

// The fixed epoch every scenario's clock is deterministic against.
export const NOW = 1_770_000_000_000;

// Targets from the behavioral fixture (feedback-cases.json targets[]).
export const GUIDE_TARGET: FeedbackTarget = { kind: 'guide', id: 'guide-route-a1', version: '1', locale: 'be' };
export const PLACE_TARGET: FeedbackTarget = { kind: 'place', id: 'place-a1', version: '1', locale: 'en' };
export const GUIDE_WIRE: FeedbackTargetWire = { kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' };

// Deterministic mutation ids (the fixture's UUID shape).
export const M1 = '00000000-0000-4000-8000-000000000001';
export const M2 = '00000000-0000-4000-8000-000000000002';
export const M3 = '00000000-0000-4000-8000-000000000003';

export const DRAFT = { score: 2, reasonCodes: ['audio_problem'], disclosureVersion: 'feedback-disclosure-1' };

export function openQueueStore(): SqlDriver {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  return driver;
}

// An open store with a registered device identity — the sync requires one
// and is inert without it by design.
export function openIdentifiedStore(): SqlDriver {
  const driver = openQueueStore();
  setDeviceId(driver, '11111111-1111-4111-8111-111111111111');
  return driver;
}

export function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export interface RecordedCall {
  op: 'put' | 'delete' | 'read';
  body: unknown;
}

export interface ScriptedTransport extends FeedbackTransport {
  calls: RecordedCall[];
}

// Wraps a per-call test handler (an answer or a parked promise), recording
// every wire call in order for the verbatim body assertions.
export function scriptedTransport(
  handler: (call: { op: RecordedCall['op']; body: unknown; index: number }) =>
    FeedbackTransportResponse | Promise<FeedbackTransportResponse>,
): ScriptedTransport {
  const calls: RecordedCall[] = [];
  const respond = async (op: RecordedCall['op'], body: unknown): Promise<FeedbackTransportResponse> => {
    calls.push({ op, body });
    return handler({ op, body, index: calls.length - 1 });
  };
  return {
    calls,
    put: (body: FeedbackPutRequest) => respond('put', body),
    deleteFeedback: (body: FeedbackDeleteRequest) => respond('delete', body),
    read: (target: FeedbackTargetWire) => respond('read', { target }),
  };
}

export const okPut = (revision: number): FeedbackTransportResponse => ({ status: 200, body: { revision, saved: true } });
export const okDelete = (revision: number): FeedbackTransportResponse => ({ status: 200, body: { revision, deleted: true } });
export const okRead = (revision: number, score: number | null, deleted: boolean): FeedbackTransportResponse => ({
  status: 200,
  body: { revision, score, reason_codes: [], deleted },
});
export const err409 = (): FeedbackTransportResponse => ({ status: 409, body: { error: 'revision_conflict' } });
export const err401 = (): FeedbackTransportResponse => ({ status: 401, body: { error: 'unknown_device' } });
export const err429 = (retryAfterSeconds?: number): FeedbackTransportResponse => ({
  status: 429,
  body: { error: 'feedback_rate_limited' },
  retryAfterSeconds,
});
export const err503 = (): FeedbackTransportResponse => ({ status: 503, body: { error: 'feedback_unavailable' } });

export interface SecretBox {
  getSecret(): Promise<string | null>;
  saveSecret(value: string): Promise<void>;
  clearSecret(): Promise<void>;
}

export function secretBox(initial: string | null): SecretBox & { readonly saved: number; readonly cleared: number } {
  let secret = initial;
  const counters = { saved: 0, cleared: 0 };
  return {
    get saved() {
      return counters.saved;
    },
    get cleared() {
      return counters.cleared;
    },
    async getSecret() {
      return secret;
    },
    async saveSecret(value: string) {
      counters.saved++;
      secret = value;
    },
    async clearSecret() {
      counters.cleared++;
      secret = null;
    },
  };
}

export function rawLocal(driver: SqlDriver, target: FeedbackTarget): Record<string, unknown> | undefined {
  return driver.prepare('SELECT * FROM feedback_local WHERE target = ?').get(formatTargetKey(target));
}

export function rawOutbox(driver: SqlDriver): Array<Record<string, unknown>> {
  return driver.prepare('SELECT * FROM feedback_outbox ORDER BY created_at, mutation_id').all();
}
