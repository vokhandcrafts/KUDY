// G09.02 — POST /v1/events core (docs/architecture/09 §5: «Батч падзей
// {event_id (UUID, генеруе кліент), type, at, payload}. Ідэмпатэнтна па
// event_id (unique index)»; `Bearer <device_secret>`). The allowlist and the
// forbidden-content classes are validated against the canonical event table
// (contracts/events/event-table.v1.json, ADR G01.05) — the parsed table is
// injected, this module never restates its field lists (implementation-rules
// 2); the spec-specific violation names its class, the generic unknown-field
// shadows under it (the table header's shadowing rule).
//
// Ownership: this module owns the intake decision — auth, size/rate limits,
// allowlist validation, the idempotent insert. Storage statements are pinned
// constants executed through the injected EventsPort (device-core/grant-core
// idiom); auth is the G08.01 device-core path (bearerSecretHash +
// DEVICE_LOOKUP_SQL — the single device identity system, `21` §2 pattern).
// The batch is all-or-nothing: one statement per request, `on conflict
// (event_id) do nothing` dedupes client retries (`09` §15 replay row); a
// rejected batch stores nothing, the client marks nothing and resends the
// same ids.
//
// Platform-neutral by contract: only `node:crypto` transitively via
// device-core; storage, clock and table injection points are named below —
// the Deno edge function injects the SQL port and the parsed table, tests
// inject fakes or run the real statements against Postgres (PGlite).
import { bearerSecretHash, checkRateLimit, DEVICE_LOOKUP_SQL } from './device-core.ts';

// --- the injected event table (contracts/events/event-table.v1.json) ---

export interface EventTableFieldSpec {
  ref?: string;
  type?: string;
  pattern?: string;
  enum?: readonly string[];
  // A `const` constraint sits on string fields (identifiers, versions) and on
  // integer fields alike — the JSON Schema value it must equal.
  const?: string | number;
  minimum?: number;
  minItems?: number;
  items?: EventTableFieldSpec;
  required?: boolean;
}

export interface EventTableRow {
  type: string;
  fields: Readonly<Record<string, EventTableFieldSpec>>;
  context_required: readonly string[];
  context_optional?: readonly string[];
}

export interface EventTableSpec {
  defs: Readonly<Record<string, EventTableFieldSpec>>;
  common_fields: Readonly<Record<string, EventTableFieldSpec>>;
  context_fields: Readonly<Record<string, EventTableFieldSpec>>;
  events: readonly EventTableRow[];
  rules: readonly { id: string; enforcement?: Readonly<Record<string, unknown>> }[];
}

// The forbidden-content rule's enforcement block, verbatim field-name lists
// and value patterns (table rule `forbidden-content`). Fail-closed: a table
// without the rule is a broken spec, not a pass-through.
export interface ForbiddenEnforcement {
  coordinate_fields: readonly string[];
  free_text_fields: readonly string[];
  url_token_fields: readonly string[];
  feedback_rating_fields: readonly string[];
  url_value_pattern: string;
  coordinate_value_pattern: string;
}

export function forbiddenEnforcement(table: EventTableSpec): ForbiddenEnforcement {
  const rule = table.rules.find((entry) => entry.id === 'forbidden-content');
  const enforcement = rule?.enforcement as ForbiddenEnforcement | undefined;
  if (
    !enforcement ||
    !Array.isArray(enforcement.coordinate_fields) ||
    !Array.isArray(enforcement.free_text_fields) ||
    !Array.isArray(enforcement.url_token_fields) ||
    !Array.isArray(enforcement.feedback_rating_fields) ||
    typeof enforcement.url_value_pattern !== 'string' ||
    typeof enforcement.coordinate_value_pattern !== 'string'
  ) {
    throw new Error('the event table is missing the forbidden-content enforcement block');
  }
  return enforcement;
}

// --- limits (defensive implementation choices, documented in results — no
// --- canonical numbers exist in `09`; the device rate limit is precedent) ---

// The raw request body cap, measured in bytes before decoding (the grant
// idiom). 64 KiB bounds even a full 256-event batch of identifier payloads.
// The cap bounds parsing, not the transport's read — the edge runtime bounds
// the read; a body beyond the cap is rejected before JSON decoding.
export const EVENT_MAX_BODY_BYTES = 65_536;
// Aligned with the client queue's flush chunk (services/eventLog
// FLUSH_CHUNK = 256): one flush call = one request.
export const EVENT_MAX_BATCH_EVENTS = 256;
// Per-device fixed-window request limit; a device flushes when the screen
// wave decides, so one request per minute is generous headroom.
export const EVENT_RATE_WINDOW_MS = 60 * 60 * 1000;
export const EVENT_RATE_LIMIT = 60;

// --- SQL (pinned constants; $n placeholders only — no client value ever
// --- enters the SQL text, the device-core idiom) ---

/** Per-(device, window) counter against `event_send_rate`. `$2` is the window start in epoch ms. */
export const EVENT_RATE_INCREMENT_SQL =
  'insert into event_send_rate (device_id, window_start, attempts) values ($1, to_timestamp($2 / 1000.0), 1) ' +
  'on conflict (device_id, window_start) do update set attempts = event_send_rate.attempts + 1 ' +
  'returning attempts';

/** Multi-row idempotent insert; `returning` yields only the newly stored rows. */
export function eventInsertSql(rowCount: number): string {
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > EVENT_MAX_BATCH_EVENTS) {
    throw new Error(`eventInsertSql: batch size ${rowCount} outside the 1..${EVENT_MAX_BATCH_EVENTS} contract`);
  }
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const b = i * 5;
    rows.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::timestamptz, $${b + 5}::jsonb)`);
  }
  return (
    `insert into event_log (event_id, device_id, type, at, payload) values ${rows.join(', ')} ` +
    'on conflict (event_id) do nothing returning event_id'
  );
}

// --- ports ---

/** One validated wire event: the fields the event_log row stores. */
export interface StoredEvent {
  eventId: string;
  type: string;
  /** ISO-8601 UTC, the event table's timestamp shape. */
  at: string;
  payload: Record<string, unknown>;
}

export interface EventsPort {
  lookupDeviceId(secretHash: string): Promise<string | null>;
  /** Bumps the window counter and returns the new attempt count. */
  incrementEventRate(deviceId: string, windowStartMs: number): number | Promise<number>;
  /** Inserts the batch atomically; returns the newly stored row count. */
  insertEventBatch(deviceId: string, rows: StoredEvent[]): Promise<number>;
}

/** The minimal SQL surface the production port needs (PGlite matches it; the Deno wiring adapts postgres.js). */
export interface EventSqlRunner {
  /** The pinned statements take primitive parameters only (built in place). */
  query(sql: string, params?: ReadonlyArray<string | number | boolean | null>): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Production port over Postgres — the pinned statements, nothing else. */
export function createSqlEventsPort(db: EventSqlRunner): EventsPort {
  return {
    async lookupDeviceId(secretHash) {
      const { rows } = await db.query(DEVICE_LOOKUP_SQL, [secretHash]);
      const candidate = rows[0]?.['device_id'];
      return typeof candidate === 'string' ? candidate : null;
    },
    async incrementEventRate(deviceId, windowStartMs) {
      const { rows } = await db.query(EVENT_RATE_INCREMENT_SQL, [deviceId, windowStartMs]);
      // The raw cell is returned unvalidated on purpose: checkRateLimit owns
      // the counter validation, so a missing or malformed reply fails closed
      // instead of counting as 0 (spec N1).
      return rows[0]?.['attempts'] as number;
    },
    async insertEventBatch(deviceId, rows) {
      if (rows.length === 0) return 0;
      const params: string[] = [];
      for (const row of rows) {
        params.push(row.eventId, deviceId, row.type, row.at, JSON.stringify(row.payload));
      }
      const { rows: inserted } = await db.query(eventInsertSql(rows.length), params);
      return inserted.length;
    },
  };
}

// --- validation: the batch walk against the injected table ---

export type EventBatchValidation = { ok: true; events: StoredEvent[] } | { ok: false; reason: string };

export function validateEventBatch(table: EventTableSpec, body: unknown, maxBatchEvents: number): EventBatchValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, reason: 'request body: must be a JSON object' };
  }
  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    return { ok: false, reason: 'events: must be an array' };
  }
  if (events.length === 0) {
    return { ok: false, reason: 'events: batch must not be empty' };
  }
  if (events.length > maxBatchEvents) {
    return { ok: false, reason: `events: batch exceeds the ${maxBatchEvents} event limit` };
  }
  const forbidden = forbiddenEnforcement(table);
  const known: Readonly<Record<string, EventTableRow>> = Object.fromEntries(table.events.map((row) => [row.type, row]));
  const validated: StoredEvent[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const verdict = validateEvent(table, known, forbidden, events[i], `events[${i}]`);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    validated.push(verdict.event);
  }
  return { ok: true, events: validated };
}

type EventVerdict = { ok: true; event: StoredEvent } | { ok: false; reason: string };

function validateEvent(
  table: EventTableSpec,
  known: Readonly<Record<string, EventTableRow>>,
  forbidden: ForbiddenEnforcement,
  candidate: unknown,
  path: string,
): EventVerdict {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { ok: false, reason: `${path}: must be a JSON object` };
  }
  const event = candidate as Record<string, unknown>;

  const common = ['event_id', 'type', 'at', 'schema_version'] as const;
  for (const field of common) {
    const spec = resolveSpec(table.defs, table.common_fields[field] ?? {});
    const verdict = checkValue(table.defs, spec, event[field]);
    if (verdict !== null) return { ok: false, reason: `${path}.${field}: ${verdict}` };
  }
  const type = event['type'];
  if (typeof type !== 'string' || !(type in known)) {
    return { ok: false, reason: `${path}.type: unknown event type` };
  }
  const row = known[type]!;

  if (typeof event['payload'] !== 'object' || event['payload'] === null || Array.isArray(event['payload'])) {
    return { ok: false, reason: `${path}.payload: must be a JSON object` };
  }
  const payload = event['payload'] as Record<string, unknown>;
  const contextAllowed = new Set([...row.context_required, ...(row.context_optional ?? [])]);

  for (const [key, value] of Object.entries(payload)) {
    const violation = forbiddenClass(forbidden, key, value);
    if (violation !== null) return { ok: false, reason: `${path}.payload.${key}: ${violation}` };
    const spec = row.fields[key] ?? (contextAllowed.has(key) ? table.context_fields[key] : undefined);
    if (spec === undefined) {
      return { ok: false, reason: `${path}.payload.${key}: unknown-field` };
    }
    const resolved = resolveSpec(table.defs, spec);
    if (typeof value === 'string' && /\s/.test(value) && isIdentifierSpec(table.defs, resolved)) {
      // The table's whitespace_value_rule: an identifier-typed string value
      // with whitespace is free text — the specific class, not invalid-value.
      return { ok: false, reason: `${path}.payload.${key}: forbidden-free-text` };
    }
    const verdict = checkValue(table.defs, resolved, value);
    if (verdict !== null) return { ok: false, reason: `${path}.payload.${key}: ${verdict}` };
  }
  for (const [key, spec] of Object.entries(row.fields)) {
    if (spec.required === true && !(key in payload)) {
      return { ok: false, reason: `${path}.payload.${key}: required field missing` };
    }
  }
  for (const key of row.context_required) {
    if (!(key in payload)) {
      return { ok: false, reason: `${path}.payload.${key}: required context missing` };
    }
  }
  return { ok: true, event: { eventId: event['event_id'] as string, type, at: event['at'] as string, payload } };
}

// The shadowing rule: a field that falls under a forbidden class is named by
// its class, never by unknown-field (the event table header).
function forbiddenClass(forbidden: ForbiddenEnforcement, key: string, value: unknown): string | null {
  if (forbidden.coordinate_fields.includes(key)) return 'forbidden-coordinates';
  if (forbidden.free_text_fields.includes(key)) return 'forbidden-free-text';
  if (forbidden.url_token_fields.includes(key)) return 'forbidden-url-token';
  if (forbidden.feedback_rating_fields.includes(key)) return 'forbidden-feedback-rating';
  if (typeof value === 'string') {
    if (new RegExp(forbidden.url_value_pattern).test(value)) return 'forbidden-url-token';
    if (new RegExp(forbidden.coordinate_value_pattern).test(value)) return 'forbidden-coordinates';
  }
  return null;
}

// `ref` resolves verbatim against the table's defs (the contract suite's
// fieldSpec idiom): the referenced def's constraints merge under the field's
// own, so a field may narrow (e.g. required) but never widen its def.
function resolveSpec(defs: Readonly<Record<string, EventTableFieldSpec>>, spec: EventTableFieldSpec): EventTableFieldSpec {
  if (spec.ref === undefined) return spec;
  const def = defs[spec.ref];
  if (def === undefined) throw new Error(`the event table references an unknown def: ${spec.ref}`);
  return { ...def, ...spec, ref: undefined };
}

function isIdentifierSpec(defs: Readonly<Record<string, EventTableFieldSpec>>, spec: EventTableFieldSpec): boolean {
  const identifier = defs['identifier'];
  return identifier !== undefined && spec.pattern === identifier.pattern;
}

// Value check against a resolved spec; null means valid, a string names the
// violation. Structurally the contract suite's checkValue — integer, array,
// string/pattern/enum/const. `defs` resolves `ref`s the same way at every
// nesting level (array items included).
function checkValue(defs: Readonly<Record<string, EventTableFieldSpec>>, spec: EventTableFieldSpec, value: unknown): string | null {
  if (spec.type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'must be an integer';
    if (spec.minimum !== undefined && value < spec.minimum) return 'must not be negative';
    if (spec.const !== undefined && value !== spec.const) return `must equal ${spec.const}`;
    return null;
  }
  if (spec.type === 'array') {
    if (!Array.isArray(value)) return 'must be an array';
    if (spec.minItems !== undefined && value.length < spec.minItems) {
      return `must hold at least ${spec.minItems} item(s)`;
    }
    if (spec.items !== undefined) {
      const itemSpec = resolveSpec(defs, spec.items);
      for (const item of value) {
        const verdict = checkValue(defs, itemSpec, item);
        if (verdict !== null) return `item violation: ${verdict}`;
      }
    }
    return null;
  }
  if (spec.type === 'string' || spec.enum !== undefined || spec.pattern !== undefined || spec.const !== undefined) {
    if (typeof value !== 'string') return 'must be a string';
    if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) return 'invalid identifier value';
    if (spec.enum !== undefined && !spec.enum.includes(value)) return 'outside the closed list';
    if (spec.const !== undefined && value !== spec.const) return `must equal ${spec.const}`;
    return null;
  }
  return null;
}

// --- the intake decision ---

export interface EventsRequestLike {
  method: string;
  authorization: string | null | undefined;
  /** The raw request body bytes, bounded by the caller's read. */
  rawBody: Uint8Array;
}

export interface EventsConfig {
  nowMs: number;
  maxBodyBytes: number;
  maxBatchEvents: number;
  rateLimit: number;
  rateWindowMs: number;
}

export type EventsAnswer =
  | { status: 200; body: { accepted: number } }
  | { status: 400; code: 'invalid_event'; reason: string }
  | { status: 403; code: 'device_auth_failed' }
  | { status: 404; code: 'not_found' }
  | { status: 429; code: 'event_rate_limited'; retryAfterSeconds: number };

// A port fault (storage unreachable) is deliberately not caught here: it is
// a server fault, and mapping it to a closed-list answer is the wiring's
// job (the device/grant idiom) — the core must not swallow it into a 400.
export async function handleEventsRequest(
  req: EventsRequestLike,
  port: EventsPort,
  table: EventTableSpec,
  config: EventsConfig,
): Promise<EventsAnswer> {
  if (req.method !== 'POST') {
    return { status: 404, code: 'not_found' };
  }
  // The G08.01 module stays the single auth path (criterion 4): no other
  // identity exists, no user identity is accepted.
  const secretHash = bearerSecretHash(req.authorization);
  if (secretHash === null) {
    return { status: 403, code: 'device_auth_failed' };
  }
  const deviceId = await port.lookupDeviceId(secretHash);
  if (deviceId === null) {
    return { status: 403, code: 'device_auth_failed' };
  }

  if (req.rawBody.byteLength > config.maxBodyBytes) {
    return { status: 400, code: 'invalid_event', reason: `request body exceeds the ${config.maxBodyBytes} byte limit` };
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(req.rawBody));
  } catch {
    return { status: 400, code: 'invalid_event', reason: 'request body: not valid JSON' };
  }
  const validation = validateEventBatch(table, body, config.maxBatchEvents);
  if (!validation.ok) {
    return { status: 400, code: 'invalid_event', reason: validation.reason };
  }

  // The limit bounds stored batches: counted after validation, before the
  // insert — the same fixed-window idiom device-core pins for registrations.
  // The decision awaits the atomic SQL increment (spec N1); a storage fault
  // or an invalid counter throws past the closed-list answers — the wiring
  // maps it to the internal-failure diagnostic and 500.
  const rate = await checkRateLimit(
    { increment: (key, windowStartMs) => port.incrementEventRate(key, windowStartMs) },
    deviceId,
    config.nowMs,
    config.rateLimit,
    config.rateWindowMs,
  );
  if (!rate.allowed) {
    return { status: 429, code: 'event_rate_limited', retryAfterSeconds: rate.retryAfterSeconds };
  }

  const accepted = await port.insertEventBatch(deviceId, validation.events);
  return { status: 200, body: { accepted } };
}

// The wiring's config from the pinned constants (tests pass their own).
export function defaultEventsConfig(nowMs: number): EventsConfig {
  return {
    nowMs,
    maxBodyBytes: EVENT_MAX_BODY_BYTES,
    maxBatchEvents: EVENT_MAX_BATCH_EVENTS,
    rateLimit: EVENT_RATE_LIMIT,
    rateWindowMs: EVENT_RATE_WINDOW_MS,
  };
}
