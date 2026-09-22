// G04.01 — services/db: the local SQLite store split into derived (rebuildable)
// and durable zones. Contract sources, copied not paraphrased: `09` §7 (zone A
// tables bundle_asset/catalog_cache, zone B tables session/guide_hint_state/
// guide_hint_last/migration_log/event_queue/settings/device and the
// drop-and-recreate rule), ADR G01.03 §3.1–§3.9 (session fields,
// one_live_session index, transaction boundaries, R07 hint tables),
// `09` §10 (event_queue fields and idempotency), `21` §5.4 (feedback_local/
// feedback_outbox in zone B, discovery_cache in zone A).
// Non-goals: the download pipeline (G04.02), event retry/backoff semantics
// (G09.01), the feedback queue logic (G16.02), the run engine (G05), UI
// screens (G06). The production driver is deliberately not chosen here —
// pinning it is an open stack-baseline row (TR-10, `23`), so this module only
// defines the minimal driver surface and the tests run on the built-in
// node:sqlite adapter (test-fixture.ts).
//
// Naming boundary: SQLite columns and DDL follow the snake_case contract names
// above; TypeScript follows the repo's camelCase. The single mapping point is
// the row mapper in db.ts.

export type SqlValue = null | number | bigint | string | Uint8Array;

export interface SqlStatement {
  run(...params: SqlValue[]): { changes: number | bigint };
  get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
  all(...params: SqlValue[]): Record<string, SqlValue>[];
}

// Minimal driver surface (exec + prepared statements). The production adapter
// (expo-sqlite or whatever the stack baseline pins) implements this; nothing
// in services/db imports a driver package.
export interface SqlDriver {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}

export type SessionState = 'active' | 'paused' | 'finished';

// ADR G01.03 §3.1 durable session row, verbatim field set. auto_fired, heard
// and tier are JSON arrays in the TEXT column and string arrays here; one
// walk = one row, a repeated walk inserts a new row and history is never
// deleted or overwritten.
export interface SessionRow {
  sessionId: string;
  routeId: string;
  version: string;
  locale: string;
  tier: string[];
  state: SessionState;
  startedAt: number;
  finishedAt: number | null;
  autoFired: string[];
  heard: string[];
  lastStopId: string | null;
  playSeq: number;
}

// ADR G01.03 §3.3 checkpoint (PersistProgress): the controller writes the
// sets and last_stop_id after every accepted mutating event, in event order;
// play_seq is written through on PlayStory. Fields are optional — a
// checkpoint carries only what changed; rewriting the same or a newer state
// is idempotent. Monotonicity is the engine reducer's contract (§3.1), the
// store writes verbatim.
export interface SessionProgress {
  autoFired?: string[];
  heard?: string[];
  lastStopId?: string | null;
  playSeq?: number;
}

// ADR G01.03 §3.1/§3.9 Start transaction input. tier defaults to ["base"];
// startedAt is the engine's injected clock, not wall time read here.
// carryGuideHints moves the current foreground window's shown/dismissed
// guide_ids into session scope inside the Start transaction (§3.9).
export interface SessionStartInput {
  sessionId: string;
  routeId: string;
  version: string;
  locale: string;
  tier?: string[];
  startedAt: number;
  carryGuideHints?: string[];
}

// `09` §10 event row. event_id is client-generated (UUID) and carries
// idempotency: one event = one credit on repeated sends. No coordinates, no
// names, no free text (09 §10); the payload holds the event's own contract
// fields as JSON produced by the caller.
export interface EventInput {
  eventId: string;
  type: string;
  at: number;
  schemaVersion: number;
  payload: string;
}
