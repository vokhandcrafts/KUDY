// G16.01 — the private feedback API core (docs/architecture/21 §5): POST
// /v1/feedback/read, PUT /v1/feedback and POST /v1/feedback/delete over the
// RLS tables of migration 20261004000000_feedback_tables_rls.sql. The
// behavioral contract is fixtures/discovery-contract/feedback-cases.json
// (the G01.06 output this task consumes) — supabase/tests/feedback/ drives
// every case through the production wire handler, and
// supabase/tests/feedback/feedback-core.test.ts guards the closed lists
// below against the committed contract files.
//
// Response codes follow 21 §5.3 verbatim: 401 wrong/deleted device, 409
// revision or idempotency conflict, 413 size, 422 scale/target/reason/
// disclosure, 429 rate limit with Retry-After, 503 temporary inability to
// verify or save. This mapping is deliberately NOT the events intake's
// (400/500): the feedback contract pins 503 for a storage fault, so a port
// fault is the wiring's 503, not a swallowed 400 — and success is answered
// only after the transaction commits (no 200 for in-memory queues).
//
// Platform-neutral by contract (the device-core/events-core idiom): only
// node:crypto transitively via device-core; storage, clock and registry
// injection points are named below — the Deno edge function injects the SQL
// port, tests inject fakes or run the real statements against Postgres
// (PGlite).
import { createHash } from 'node:crypto';

import { bearerSecretHash, DEVICE_LOOKUP_SQL } from '../_shared/device-core.ts';

// --- limits (21 §5.3 «Пачатковыя тэхнічныя ліміты» — the contract's own ---
// --- numbers, not implementation choices) ---

export const FEEDBACK_MAX_BODY_BYTES = 8 * 1024;
export const FEEDBACK_RATE_WINDOW_MS = 60 * 1000;
export const FEEDBACK_DEVICE_RATE_LIMIT = 30;
export const FEEDBACK_IP_RATE_LIMIT = 120;

// --- closed lists ---

// 21 §5.1, verbatim: guide reasons and place reasons are separate closed
// lists — "Прычына пра гук адносіцца да гіда, не псуе ацэнку фізічнага
// месца" — at most 3 unique reasons per submission.
export const GUIDE_REASON_CODES: readonly string[] = [
  'interesting_stories',
  'clear_delivery',
  'too_long',
  'hard_to_navigate',
  'audio_problem',
  'description_mismatch',
];
export const PLACE_REASON_CODES: readonly string[] = [
  'worth_visiting',
  'description_mismatch',
  'hard_to_reach',
  'access_problem',
];
export const MAX_REASON_CODES = 3;

// 21 §6: the server checks disclosure_version against the allowed versions;
// deprecated text requires a new confirmation. The initial allowed set is
// the fixture's pinned version; a future disclosure amends this list (the
// old entries stay — old queues carry the version they consented to).
export const DISCLOSURE_VERSIONS: readonly string[] = ['feedback-disclosure-1'];

// --- the FeedbackTarget wire shape → registry key mapping ---
// contracts/schemas/feedback-target.schema.json is canonical: guide carries
// route_id+version, place carries place_id+content_version. The registry
// key columns (target_kind, target_id, target_version, locale) are the
// single mapping point: id = route_id | place_id, version = version |
// content_version. The schema's locale enum {be,en,uk} is the REGISTRY
// contract (registry-import validates it against the schema file); request
// validation stays structural — a well-formed but unregistered locale
// (e.g. the fixture's reserved `pl`) reaches the registry check and fails
// closed as unknown_target, exactly the fixture's cas-unpublished-locale.

export interface FeedbackTargetKey {
  kind: 'guide' | 'place';
  /** route_id (guide) or place_id (place). */
  id: string;
  /** guide.version or place.content_version. */
  version: string;
  locale: string;
}

// contracts/schemas/identifier.schema.json verbatim (the drift guard in the
// core suite compares both files against these two patterns).
export const IDENTIFIER_PATTERN = '^[a-z0-9._-]{1,64}$';
// feedback-target.schema.json: "^[0-9]+$" plus maxLength 64.
export const TARGET_VERSION_PATTERN = '^[0-9]{1,64}$';
// Request-side locale shape (structural only — see the mapping note above):
// a lowercase language tag, never a free-text or coordinate value.
export const REQUEST_LOCALE_PATTERN = '^[a-z][a-z0-9-]{0,34}$';

export type TargetVerdict = { ok: true; key: FeedbackTargetKey } | { ok: false; reason: string };

export function validateTarget(candidate: unknown): TargetVerdict {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { ok: false, reason: 'target: must be a JSON object' };
  }
  const target = candidate as Record<string, unknown>;
  const kind = target['kind'];
  if (kind !== 'guide' && kind !== 'place') {
    return { ok: false, reason: 'target.kind: must be guide or place' };
  }
  const idField = kind === 'guide' ? 'route_id' : 'place_id';
  const versionField = kind === 'guide' ? 'version' : 'content_version';
  const allowed = new Set(['kind', idField, versionField, 'locale']);
  for (const field of Object.keys(target)) {
    if (!allowed.has(field)) return { ok: false, reason: `target.${field}: unknown field` };
  }
  const missing = [...allowed].filter((field) => !(field in target));
  if (missing.length > 0) return { ok: false, reason: `target.${missing[0]}: required field missing` };
  const id = target[idField];
  if (typeof id !== 'string' || !new RegExp(IDENTIFIER_PATTERN).test(id)) {
    return { ok: false, reason: `target.${idField}: invalid identifier value` };
  }
  const version = target[versionField];
  if (typeof version !== 'string' || !new RegExp(TARGET_VERSION_PATTERN).test(version)) {
    return { ok: false, reason: `target.${versionField}: invalid version` };
  }
  const locale = target['locale'];
  if (typeof locale !== 'string' || !new RegExp(REQUEST_LOCALE_PATTERN).test(locale)) {
    return { ok: false, reason: 'target.locale: invalid locale' };
  }
  return { ok: true, key: { kind, id, version, locale } };
}

// --- payload validation ---

export const MUTATION_ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

export type PutVerdict =
  | {
      ok: true;
      key: FeedbackTargetKey;
      mutationId: string;
      expectedRevision: number;
      score: number;
      reasonCodes: string[];
      disclosureVersion: string;
      payloadHash: string;
    }
  | { ok: false; error: 'invalid_request' | 'invalid_target' | 'invalid_scale' | 'invalid_reason' | 'invalid_disclosure' };

type EnvelopeVerdict =
  | { ok: true; key: FeedbackTargetKey; mutationId: string; expectedRevision: number }
  | { ok: false; error: 'invalid_request' | 'invalid_target' };

const PUT_REQUIRED_FIELDS = ['mutation_id', 'target', 'expected_revision', 'score', 'reason_codes', 'disclosure_version'];
const DELETE_REQUIRED_FIELDS = ['mutation_id', 'target', 'expected_revision'];

/** The shared mutation envelope: closed fields, target shape, mutation id, revision (21 §5.3 request tables). */
function validateMutationEnvelope(body: unknown, required: readonly string[]): EnvelopeVerdict {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'invalid_request' };
  }
  const record = body as Record<string, unknown>;
  for (const field of Object.keys(record)) {
    if (!required.includes(field)) return { ok: false, error: 'invalid_request' };
  }
  for (const field of required) {
    if (!(field in record)) return { ok: false, error: 'invalid_request' };
  }
  const target = validateTarget(record['target']);
  if (!target.ok) return { ok: false, error: 'invalid_target' };
  const mutationId = record['mutation_id'];
  if (typeof mutationId !== 'string' || !new RegExp(MUTATION_ID_PATTERN).test(mutationId)) {
    return { ok: false, error: 'invalid_request' };
  }
  const expectedRevision = record['expected_revision'];
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return { ok: false, error: 'invalid_request' };
  }
  return { ok: true, key: target.key, mutationId, expectedRevision };
}

/**
 * Canonical PUT /v1/feedback payload (21 §5.3). Unknown or missing envelope
 * fields fail closed (invalid_request); score, reasons and disclosure fail
 * under their own contract codes. Reasons are a set — the canonical form
 * sorts them, so a retry that reorders reasons replays as the identical
 * mutation rather than a conflict.
 */
export function validatePutBody(body: unknown): PutVerdict {
  const envelope = validateMutationEnvelope(body, PUT_REQUIRED_FIELDS);
  if (!envelope.ok) return envelope;
  const record = body as Record<string, unknown>;
  const score = record['score'];
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
    return { ok: false, error: 'invalid_scale' };
  }
  const reasonVerdict = validateReasonCodes(envelope.key.kind, record['reason_codes']);
  if (reasonVerdict !== null) return { ok: false, error: 'invalid_reason' };
  const reasonCodes = normalizeReasonCodes(record['reason_codes']);
  const disclosureVersion = record['disclosure_version'];
  if (typeof disclosureVersion !== 'string' || !DISCLOSURE_VERSIONS.includes(disclosureVersion)) {
    return { ok: false, error: 'invalid_disclosure' };
  }
  return {
    ok: true,
    key: envelope.key,
    mutationId: envelope.mutationId,
    expectedRevision: envelope.expectedRevision,
    score,
    reasonCodes,
    disclosureVersion,
    payloadHash: mutationPayloadHash('put', envelope.key, {
      expectedRevision: envelope.expectedRevision,
      score,
      reasonCodes,
      disclosureVersion,
    }),
  };
}

export type DeleteVerdict =
  | { ok: true; key: FeedbackTargetKey; mutationId: string; expectedRevision: number; payloadHash: string }
  | { ok: false; error: 'invalid_request' | 'invalid_target' };

export function validateDeleteBody(body: unknown): DeleteVerdict {
  const envelope = validateMutationEnvelope(body, DELETE_REQUIRED_FIELDS);
  if (!envelope.ok) return envelope;
  return {
    ok: true,
    key: envelope.key,
    mutationId: envelope.mutationId,
    expectedRevision: envelope.expectedRevision,
    payloadHash: mutationPayloadHash('delete', envelope.key, { expectedRevision: envelope.expectedRevision }),
  };
}

export type ReadVerdict = { ok: true; key: FeedbackTargetKey } | { ok: false; error: 'invalid_request' | 'invalid_target' };

export function validateReadBody(body: unknown): ReadVerdict {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'invalid_request' };
  }
  const record = body as Record<string, unknown>;
  for (const field of Object.keys(record)) {
    if (field !== 'target') return { ok: false, error: 'invalid_request' };
  }
  if (!('target' in record)) return { ok: false, error: 'invalid_request' };
  const target = validateTarget(record['target']);
  if (!target.ok) return { ok: false, error: 'invalid_target' };
  return { ok: true, key: target.key };
}

/** null means valid — a string names the violated closed-list rule. */
export function validateReasonCodes(kind: 'guide' | 'place', value: unknown): string | null {
  if (!Array.isArray(value)) return 'reason_codes: must be an array';
  if (value.length > MAX_REASON_CODES) return `reason_codes: at most ${MAX_REASON_CODES} unique reasons`;
  const allowed = kind === 'guide' ? GUIDE_REASON_CODES : PLACE_REASON_CODES;
  const seen = new Set<string>();
  for (const reason of value) {
    if (typeof reason !== 'string') return 'reason_codes: must hold strings';
    if (!allowed.includes(reason)) return 'reason_codes: outside the closed list';
    if (seen.has(reason)) return 'reason_codes: at most 3 unique reasons';
    seen.add(reason);
  }
  return null;
}

function normalizeReasonCodes(value: unknown): string[] {
  return [...(value as string[])].sort();
}

/**
 * The idempotency fingerprint (21 §5.3: identical mutation_id + payload
 * replays, a different payload under the same id conflicts). Built from the
 * validated fields — never the raw JSON — so key order and reason order
 * cannot fork the hash.
 */
export function mutationPayloadHash(
  operation: 'put' | 'delete',
  key: FeedbackTargetKey,
  fields: {
    expectedRevision: number;
    score?: number;
    reasonCodes?: readonly string[];
    disclosureVersion?: string;
  },
): string {
  const parts = [
    operation,
    key.kind,
    key.id,
    key.version,
    key.locale,
    `rev=${fields.expectedRevision}`,
  ];
  if (operation === 'put') {
    parts.push(`score=${fields.score}`, `reasons=${(fields.reasonCodes ?? []).join(',')}`, `disclosure=${fields.disclosureVersion}`);
  }
  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex');
}

// --- SQL (pinned constants; $n placeholders only — the device-core idiom) ---

export const FEEDBACK_DEVICE_RATE_INCREMENT_SQL =
  'insert into feedback_send_rate (device_id, window_start, attempts) values ($1, to_timestamp($2 / 1000.0), 1) ' +
  'on conflict (device_id, window_start) do update set attempts = feedback_send_rate.attempts + 1 ' +
  'returning attempts';

export const FEEDBACK_IP_RATE_INCREMENT_SQL =
  'insert into feedback_ip_rate (ip_hash, window_start, attempts) values ($1, to_timestamp($2 / 1000.0), 1) ' +
  'on conflict (ip_hash, window_start) do update set attempts = feedback_ip_rate.attempts + 1 ' +
  'returning attempts';

/** The live-device check inside the feedback transaction (21 §5.2: parallel device deletion leaves no orphans). */
export const FEEDBACK_DEVICE_EXISTS_SQL = 'select device_id from devices where device_id = $1';

export const FEEDBACK_REGISTRY_STATUS_SQL =
  'select status from feedback_target_registry ' +
  'where target_kind = $1 and target_id = $2 and target_version = $3 and locale = $4';

export const FEEDBACK_CURRENT_READ_SQL =
  'select revision, score, reason_codes, deleted_at from feedback_current ' +
  'where device_id = $1 and target_kind = $2 and target_id = $3 and target_version = $4 and locale = $5';

/** The CAS lock: `for update` serializes same-key writers (21 §5.3 «lock current/unique-key»). */
export const FEEDBACK_CURRENT_LOCK_SQL =
  'select revision from feedback_current ' +
  'where device_id = $1 and target_kind = $2 and target_id = $3 and target_version = $4 and locale = $5 ' +
  'for update';

/**
 * Create under expected_revision 0. `on conflict do nothing` makes the
 * concurrent-create race a 0-row answer — the loser's expected_revision 0
 * no longer matches the winner's revision ≥ 1, so the loser conflicts.
 */
export const FEEDBACK_CURRENT_INSERT_SQL =
  'insert into feedback_current (device_id, target_kind, target_id, target_version, locale, revision, score, reason_codes) ' +
  'values ($1, $2, $3, $4, $5, 1, $6, $7::jsonb) ' +
  'on conflict (device_id, target_kind, target_id, target_version, locale) do nothing returning revision';

export const FEEDBACK_CURRENT_UPDATE_SQL =
  'update feedback_current set score = $6, reason_codes = $7::jsonb, deleted_at = null, revision = revision + 1, updated_at = now() ' +
  'where device_id = $1 and target_kind = $2 and target_id = $3 and target_version = $4 and locale = $5 and revision = $8 ' +
  'returning revision';

/** Tombstone: score null, no reasons (the schema check pins the shape), revision still advances. */
export const FEEDBACK_CURRENT_TOMBSTONE_SQL =
  "update feedback_current set score = null, reason_codes = '[]'::jsonb, deleted_at = now(), revision = revision + 1, updated_at = now() " +
  'where device_id = $1 and target_kind = $2 and target_id = $3 and target_version = $4 and locale = $5 and revision = $6 ' +
  'returning revision';

export const FEEDBACK_MUTATION_FIND_SQL =
  'select payload_hash, result_revision from feedback_mutations where device_id = $1 and mutation_id = $2';

export const FEEDBACK_MUTATION_INSERT_SQL =
  'insert into feedback_mutations (device_id, mutation_id, payload_hash, target_kind, target_id, target_version, locale, result_revision) ' +
  'values ($1, $2, $3, $4, $5, $6, $7, $8)';

// --- ports ---

/**
 * One transaction-scoped view of the storage. Every method runs on the same
 * connection inside the caller's transaction; the SQL adapters below build
 * them from the pinned statements.
 */
export interface FeedbackTx {
  deviceExists(deviceId: string): Promise<boolean>;
  registryStatus(key: FeedbackTargetKey): Promise<'prepared' | 'published' | null>;
  /** `for update` — locks the current row for the CAS compare. */
  lockCurrentRevision(deviceId: string, key: FeedbackTargetKey): Promise<number | null>;
  /** Returns 0 when a concurrent create already won the unique key. */
  insertCurrentRating(deviceId: string, key: FeedbackTargetKey, score: number, reasonCodes: readonly string[]): Promise<0 | 1>;
  updateCurrentRating(deviceId: string, key: FeedbackTargetKey, expectedRevision: number, score: number, reasonCodes: readonly string[]): Promise<number>;
  tombstoneCurrent(deviceId: string, key: FeedbackTargetKey, expectedRevision: number): Promise<number>;
  findMutation(deviceId: string, mutationId: string): Promise<{ payloadHash: string; resultRevision: number } | null>;
  insertMutation(deviceId: string, mutationId: string, payloadHash: string, key: FeedbackTargetKey, resultRevision: number): Promise<void>;
}

export interface CurrentFeedbackRow {
  revision: number;
  score: number | null;
  reasonCodes: string[];
  deleted: boolean;
}

export interface FeedbackPort {
  lookupDeviceId(secretHash: string): Promise<string | null>;
  incrementDeviceRate(deviceId: string, windowStartMs: number): number | Promise<number>;
  incrementIpRate(ipHash: string, windowStartMs: number): number | Promise<number>;
  readCurrent(deviceId: string, key: FeedbackTargetKey): Promise<CurrentFeedbackRow | null>;
  transaction<T>(work: (tx: FeedbackTx) => Promise<T>): Promise<T>;
}

/**
 * The minimal SQL surface (PGlite matches it directly; the Deno wiring
 * adapts postgres.js). `transaction` runs the work on one connection — the
 * CAS read-compare-write is only atomic inside it — and the work sees the
 * statement surface only: the runner inside a transaction never opens a
 * nested one (postgres.js `begin` hands back a TransactionSql without
 * `begin`, the Deno typecheck's own contract).
 */
export interface FeedbackSqlStatements {
  query(sql: string, params?: ReadonlyArray<string | number | boolean | null>): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface FeedbackSqlRunner extends FeedbackSqlStatements {
  transaction<T>(work: (runner: FeedbackSqlStatements) => Promise<T>): Promise<T>;
}

const keyParams = (key: FeedbackTargetKey): string[] => [key.kind, key.id, key.version, key.locale];

function reasonCodesCell(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  }
  return [];
}

/** Production transaction view — the pinned statements, nothing else. */
function createSqlFeedbackTx(db: FeedbackSqlStatements): FeedbackTx {
  return {
    async deviceExists(deviceId) {
      const { rows } = await db.query(FEEDBACK_DEVICE_EXISTS_SQL, [deviceId]);
      return rows.length > 0;
    },
    async registryStatus(key) {
      const { rows } = await db.query(FEEDBACK_REGISTRY_STATUS_SQL, keyParams(key));
      const status = rows[0]?.['status'];
      return status === 'prepared' || status === 'published' ? status : null;
    },
    async lockCurrentRevision(deviceId, key) {
      const { rows } = await db.query(FEEDBACK_CURRENT_LOCK_SQL, [deviceId, ...keyParams(key)]);
      const revision = rows[0]?.['revision'];
      return typeof revision === 'number' ? revision : null;
    },
    async insertCurrentRating(deviceId, key, score, reasonCodes) {
      const { rows } = await db.query(FEEDBACK_CURRENT_INSERT_SQL, [deviceId, ...keyParams(key), score, JSON.stringify(reasonCodes)]);
      return rows.length > 0 ? 1 : 0;
    },
    async updateCurrentRating(deviceId, key, expectedRevision, score, reasonCodes) {
      const { rows } = await db.query(FEEDBACK_CURRENT_UPDATE_SQL, [
        deviceId,
        ...keyParams(key),
        score,
        JSON.stringify(reasonCodes),
        expectedRevision,
      ]);
      return rows.length;
    },
    async tombstoneCurrent(deviceId, key, expectedRevision) {
      const { rows } = await db.query(FEEDBACK_CURRENT_TOMBSTONE_SQL, [deviceId, ...keyParams(key), expectedRevision]);
      return rows.length;
    },
    async findMutation(deviceId, mutationId) {
      const { rows } = await db.query(FEEDBACK_MUTATION_FIND_SQL, [deviceId, mutationId]);
      const row = rows[0];
      if (!row) return null;
      return {
        payloadHash: String(row['payload_hash']),
        resultRevision: Number(row['result_revision']),
      };
    },
    async insertMutation(deviceId, mutationId, payloadHash, key, resultRevision) {
      await db.query(FEEDBACK_MUTATION_INSERT_SQL, [deviceId, mutationId, payloadHash, ...keyParams(key), resultRevision]);
    },
  };
}

/** Production port over Postgres — the pinned statements, nothing else. */
export function createSqlFeedbackPort(db: FeedbackSqlRunner): FeedbackPort {
  return {
    async lookupDeviceId(secretHash) {
      const { rows } = await db.query(DEVICE_LOOKUP_SQL, [secretHash]);
      const candidate = rows[0]?.['device_id'];
      return typeof candidate === 'string' ? candidate : null;
    },
    async incrementDeviceRate(deviceId, windowStartMs) {
      const { rows } = await db.query(FEEDBACK_DEVICE_RATE_INCREMENT_SQL, [deviceId, windowStartMs]);
      // Raw cell on purpose: checkRateLimit owns the counter validation and
      // fails closed on a malformed reply (the events-wire idiom, spec N1).
      return rows[0]?.['attempts'] as number;
    },
    async incrementIpRate(ipHash, windowStartMs) {
      const { rows } = await db.query(FEEDBACK_IP_RATE_INCREMENT_SQL, [ipHash, windowStartMs]);
      return rows[0]?.['attempts'] as number;
    },
    async readCurrent(deviceId, key) {
      const { rows } = await db.query(FEEDBACK_CURRENT_READ_SQL, [deviceId, ...keyParams(key)]);
      const row = rows[0];
      if (!row) return null;
      return {
        revision: Number(row['revision']),
        score: row['score'] === null ? null : Number(row['score']),
        reasonCodes: reasonCodesCell(row['reason_codes']),
        deleted: row['deleted_at'] !== null,
      };
    },
    transaction(work) {
      return db.transaction((runner) => work(createSqlFeedbackTx(runner)));
    },
  };
}

// --- the intake decision ---

export interface FeedbackRequestLike {
  method: string;
  /** Canonical operation resolved from the path by the wiring. */
  operation: 'read' | 'put' | 'delete';
  authorization: string | null | undefined;
  /** sha256 of the client address (device-core hashIp) — never the raw IP. */
  ipHash: string;
  /** The raw request body bytes, bounded by the caller's read. */
  rawBody: Uint8Array;
}

export interface FeedbackConfig {
  nowMs: number;
  maxBodyBytes: number;
  deviceRateLimit: number;
  ipRateLimit: number;
  rateWindowMs: number;
}

export type FeedbackAnswer =
  | { status: 200; body: { revision: number; score: number | null; reason_codes: string[]; deleted: boolean } }
  | { status: 200; body: { revision: number; saved: true } }
  | { status: 200; body: { revision: number; deleted: true } }
  | { status: 401; error: 'unknown_device' }
  | { status: 409; error: 'revision_conflict' | 'mutation_conflict' }
  | { status: 413; error: 'payload_too_large' }
  | { status: 422; error: 'invalid_request' | 'invalid_target' | 'unknown_target' | 'invalid_scale' | 'invalid_reason' | 'invalid_disclosure' }
  | { status: 429; error: 'feedback_rate_limited'; retryAfterSeconds: number }
  | { status: 503; error: 'target_not_published' | 'feedback_unavailable' };

type MutationOutcome =
  | { kind: 'answer'; answer: FeedbackAnswer }
  | { kind: 'committed'; revision: number };

interface CasPlan {
  mutationId: string;
  payloadHash: string;
  key: FeedbackTargetKey;
  expectedRevision: number;
  /** PUT only: the revision-1 insert of the missing row (returns 0 when a concurrent create won). */
  create?: (tx: FeedbackTx, deviceId: string) => Promise<number>;
  /** The CAS write at the locked current revision; returns the rows written. */
  apply: (tx: FeedbackTx, deviceId: string) => Promise<number>;
}

async function parseJson(rawBody: Uint8Array, config: FeedbackConfig): Promise<{ ok: true; body: unknown } | { ok: false; answer: FeedbackAnswer }> {
  if (rawBody.byteLength > config.maxBodyBytes) {
    return { ok: false, answer: { status: 413, error: 'payload_too_large' } };
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(rawBody)) };
  } catch {
    return { ok: false, answer: { status: 422, error: 'invalid_request' } };
  }
}

function windowDecision(counter: unknown, limit: number, config: FeedbackConfig): FeedbackAnswer | null {
  if (typeof counter !== 'number' || !Number.isInteger(counter) || counter < 0) {
    throw new Error('rate counter: the storage did not return a valid attempt count');
  }
  if (counter > limit) {
    const windowEnd = (Math.floor(config.nowMs / config.rateWindowMs) + 1) * config.rateWindowMs;
    return { status: 429, error: 'feedback_rate_limited', retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - config.nowMs) / 1000)) };
  }
  return null;
}

/**
 * The shared preamble (auth → size → parse) before the per-operation
 * decisions. Auth uses the G08.01 bearer verification (bearerSecretHash +
 * the single devices lookup) mapped to THIS contract's 401 unknown_device —
 * the identity system is shared, the answer codes are the feedback
 * endpoint's own (21 §5.3, fixture cas-deleted-device).
 */
async function feedbackPreamble(
  req: FeedbackRequestLike,
  port: FeedbackPort,
  config: FeedbackConfig,
): Promise<{ ok: true; deviceId: string } | { ok: false; answer: FeedbackAnswer }> {
  const secretHash = bearerSecretHash(req.authorization);
  if (secretHash !== null) {
    const deviceId = await port.lookupDeviceId(secretHash);
    if (deviceId !== null) return { ok: true, deviceId };
  }
  return { ok: false, answer: { status: 401, error: 'unknown_device' } };
}

/**
 * The feedback request decision (21 §5.3): one transaction per write —
 * live-device → idempotency lookup → registry check → lock current → CAS →
 * mutation write → commit; the answer is built only from the committed
 * outcome. A port fault is deliberately not caught here: the wiring maps it
 * to the contract's 503 and logs the diagnostic (the events-core idiom, the
 * feedback-specific code list).
 */
export async function handleFeedbackRequest(
  req: FeedbackRequestLike,
  port: FeedbackPort,
  config: FeedbackConfig,
): Promise<FeedbackAnswer> {
  const methodOk =
    (req.operation === 'read' && req.method === 'POST') ||
    (req.operation === 'put' && req.method === 'PUT') ||
    (req.operation === 'delete' && req.method === 'POST');
  if (!methodOk) {
    return { status: 422, error: 'invalid_request' };
  }
  // The per-IP bucket counts every request that reaches the handler —
  // including ones that fail auth or validation — the service-protection
  // half of 21 §5.3 (120/min per IP); the raw address is already hashed by
  // the wiring.
  const ipLimited = windowDecision(await port.incrementIpRate(req.ipHash, windowStart(config)), config.ipRateLimit, config);
  if (ipLimited) return ipLimited;
  const auth = await feedbackPreamble(req, port, config);
  if (!auth.ok) return auth.answer;
  const deviceId = auth.deviceId;

  const parsed = await parseJson(req.rawBody, config);
  if (!parsed.ok) return parsed.answer;

  if (req.operation === 'read') {
    const verdict = validateReadBody(parsed.body);
    if (!verdict.ok) return { status: 422, error: verdict.error };
    const limited = await enforceFeedbackLimits(deviceId, port, config);
    if (limited) return limited;
    const row = await port.readCurrent(deviceId, verdict.key);
    const current = row ?? { revision: 0, score: null, reasonCodes: [], deleted: false };
    return { status: 200, body: { revision: current.revision, score: current.score, reason_codes: current.reasonCodes, deleted: current.deleted } };
  }

  if (req.operation === 'put' || req.operation === 'delete') {
    return mutationAnswer(req.operation, parsed.body, deviceId, req, port, config);
  }
  return { status: 422, error: 'invalid_request' };
}

/** The mutation-plan head shared by both verdict shapes (identity, hash, target, revision). */
function planHead(verdict: { key: FeedbackTargetKey; mutationId: string; expectedRevision: number; payloadHash: string }): Omit<CasPlan, 'apply'> {
  return {
    mutationId: verdict.mutationId,
    payloadHash: verdict.payloadHash,
    key: verdict.key,
    expectedRevision: verdict.expectedRevision,
  };
}

/**
 * The PUT/DELETE request pipeline (21 §5.3): validate → limits → the CAS
 * mutation transaction → the operation's own success shape.
 */
async function mutationAnswer(
  operation: 'put' | 'delete',
  body: unknown,
  deviceId: string,
  req: FeedbackRequestLike,
  port: FeedbackPort,
  config: FeedbackConfig,
): Promise<FeedbackAnswer> {
  if (operation === 'put') {
    const verdict = validatePutBody(body);
    if (!verdict.ok) return { status: 422, error: verdict.error };
    return committedAnswer('put', deviceId, port, config, {
      ...planHead(verdict),
      create: (tx, deviceId) => tx.insertCurrentRating(deviceId, verdict.key, verdict.score, verdict.reasonCodes),
      apply: (tx, deviceId) => tx.updateCurrentRating(deviceId, verdict.key, verdict.expectedRevision, verdict.score, verdict.reasonCodes),
    });
  }
  const verdict = validateDeleteBody(body);
  if (!verdict.ok) return { status: 422, error: verdict.error };
  return committedAnswer('delete', deviceId, port, config, {
    ...planHead(verdict),
    apply: (tx, deviceId) => tx.tombstoneCurrent(deviceId, verdict.key, verdict.expectedRevision),
  });
}

async function committedAnswer(
  operation: 'put' | 'delete',
  deviceId: string,
  port: FeedbackPort,
  config: FeedbackConfig,
  plan: CasPlan,
): Promise<FeedbackAnswer> {
  const limited = await enforceFeedbackLimits(deviceId, port, config);
  if (limited) return limited;
  const outcome = await port.transaction((tx) => runCasMutation(tx, deviceId, plan));
  if (outcome.kind !== 'committed') return outcome.answer;
  if (operation === 'put') {
    return { status: 200, body: { revision: outcome.revision, saved: true } };
  }
  return { status: 200, body: { revision: outcome.revision, deleted: true } };
}

/**
 * The 21 §5.3 request limits — the per-device half; every authenticated
 * feedback request counts, reads included. The counters live in the database
 * and persist across rejected requests: the request did arrive, whatever the
 * answer. (The per-IP half counts in `handleFeedbackRequest` before auth, so
 * forged-bearer floods are bucketed too.)
 */
async function enforceFeedbackLimits(deviceId: string, port: FeedbackPort, config: FeedbackConfig): Promise<FeedbackAnswer | null> {
  return windowDecision(await port.incrementDeviceRate(deviceId, windowStart(config)), config.deviceRateLimit, config);
}

/**
 * One CAS mutation, PUT or DELETE (21 §5.3): live-device → idempotency
 * lookup → registry check → lock current/unique-key → CAS write at the
 * expected revision → revision + 1 → mutation ledger row, all inside the
 * caller's transaction. The plan's `create` hook is present only for PUT —
 * expected_revision 0 creates the missing row at revision 1; a delete (and
 * a put without the hook) conflicts on a missing row.
 */
async function runCasMutation(tx: FeedbackTx, deviceId: string, plan: CasPlan): Promise<MutationOutcome> {
  if (!(await tx.deviceExists(deviceId))) {
    return { kind: 'answer', answer: { status: 401, error: 'unknown_device' } };
  }
  const existing = await tx.findMutation(deviceId, plan.mutationId);
  if (existing !== null) {
    return existing.payloadHash === plan.payloadHash
      ? { kind: 'committed', revision: existing.resultRevision }
      : { kind: 'answer', answer: { status: 409, error: 'mutation_conflict' } };
  }
  const status = await tx.registryStatus(plan.key);
  if (status === null) {
    return { kind: 'answer', answer: { status: 422, error: 'unknown_target' } };
  }
  if (status === 'prepared') {
    return { kind: 'answer', answer: { status: 503, error: 'target_not_published' } };
  }
  const current = await tx.lockCurrentRevision(deviceId, plan.key);
  // READ COMMITTED: the lock wait re-reads the winner's committed row, so a
  // duplicate that raced the original transaction re-checks its ledger here —
  // the pre-lock lookup (21 §5.3 step 2) cannot see it yet. An identical
  // retry replays the stored result, a different payload conflicts, and the
  // ledger PK can no longer explode inside this transaction as a 503.
  const raced = await tx.findMutation(deviceId, plan.mutationId);
  if (raced !== null) {
    return raced.payloadHash === plan.payloadHash
      ? { kind: 'committed', revision: raced.resultRevision }
      : { kind: 'answer', answer: { status: 409, error: 'mutation_conflict' } };
  }
  if (current === null) {
    if (!plan.create || plan.expectedRevision !== 0) {
      return { kind: 'answer', answer: { status: 409, error: 'revision_conflict' } };
    }
    if ((await plan.create(tx, deviceId)) === 0) {
      // The `for update` lock holds no row here, so the earlier re-check
      // could still have missed an uncommitted winner; this one catches the
      // committed winner: the same mutation_id replays its stored result, a
      // different id stays a plain CAS conflict.
      const raced = await tx.findMutation(deviceId, plan.mutationId);
      if (raced !== null) {
        return raced.payloadHash === plan.payloadHash
          ? { kind: 'committed', revision: raced.resultRevision }
          : { kind: 'answer', answer: { status: 409, error: 'mutation_conflict' } };
      }
      return { kind: 'answer', answer: { status: 409, error: 'revision_conflict' } };
    }
    await tx.insertMutation(deviceId, plan.mutationId, plan.payloadHash, plan.key, 1);
    return { kind: 'committed', revision: 1 };
  }
  if (current !== plan.expectedRevision) {
    return { kind: 'answer', answer: { status: 409, error: 'revision_conflict' } };
  }
  if ((await plan.apply(tx, deviceId)) !== 1) {
    return { kind: 'answer', answer: { status: 409, error: 'revision_conflict' } };
  }
  const newRevision = plan.expectedRevision + 1;
  await tx.insertMutation(deviceId, plan.mutationId, plan.payloadHash, plan.key, newRevision);
  return { kind: 'committed', revision: newRevision };
}

function windowStart(config: FeedbackConfig): number {
  return Math.floor(config.nowMs / config.rateWindowMs) * config.rateWindowMs;
}

/** The wiring's config from the contract limits (tests pass their own). */
export function defaultFeedbackConfig(nowMs: number): FeedbackConfig {
  return {
    nowMs,
    maxBodyBytes: FEEDBACK_MAX_BODY_BYTES,
    deviceRateLimit: FEEDBACK_DEVICE_RATE_LIMIT,
    ipRateLimit: FEEDBACK_IP_RATE_LIMIT,
    rateWindowMs: FEEDBACK_RATE_WINDOW_MS,
  };
}
