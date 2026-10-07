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

// Minimal driver surface (execSql + prepared statements). The production
// adapter (expo-sqlite or whatever the stack baseline pins) implements this;
// nothing in services/db imports a driver package. The method runs a raw SQL
// script against the driver's store — SQL only, never a shell.
export interface SqlDriver {
  execSql(sql: string): void;
  prepare(sql: string): SqlStatement;
}

export type SessionState = 'active' | 'paused' | 'finished';

// ADR G01.03 §3.1 durable session row, verbatim field set. auto_fired, heard
// and tier are JSON arrays in the TEXT column and string arrays here; one
// walk = one row, a repeated walk inserts a new row and history is never
// deleted or overwritten.
// G21.21 (ADR G21.20 §3.4): audioLocale is the Start-pinned audio locale,
// immutable like the rest of the pin. NULL is the stored shape of a
// monolingual session (the audio layer is the text layer) and of a text-only
// one — the restore resolves the two against the pinned version's audio
// availability; a non-NULL value never equals the row's locale by contract of
// the writer (the controller stores the pin only for a cross-locale selection).
export interface SessionRow {
  sessionId: string;
  routeId: string;
  version: string;
  locale: string;
  audioLocale: string | null;
  tier: string[];
  state: SessionState;
  startedAt: number;
  finishedAt: number | null;
  autoFired: string[];
  heard: string[];
  lastStopId: string | null;
  playSeq: number;
}

// G22.06 (spec E6): the completed-history page read. The cursor is the keyset
// key of the last row of the previous page — (started_at, session_id), the
// same pair the page order sorts by — never an offset. The summary carries the
// row's identity/state/timing facts plus the derived heardCount; the progress
// arrays themselves stay in the store and are read separately when a surface
// needs the full walk. Projections only: nothing here is new stored progress.
export interface SessionHistoryCursor {
  startedAt: number;
  sessionId: string;
}

export interface SessionHistorySummary {
  sessionId: string;
  routeId: string;
  version: string;
  locale: string;
  state: SessionState;
  startedAt: number;
  finishedAt: number | null;
  heardCount: number;
}

export interface SessionHistoryPage {
  /** The app's one live walk (active/paused), read separately from the pages. */
  live: SessionRow | null;
  /** Completed summaries of this page, `started_at DESC, session_id DESC`. */
  rows: SessionHistorySummary[];
  /** Key of the next page; null when the read reached the end of the history. */
  nextCursor: SessionHistoryCursor | null;
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
// G21.21 (ADR G21.20 §3.4): audioLocale is the resolved audio pin of this
// walk — undefined/null both store NULL (a monolingual or text-only session,
// per the writer's contract on SessionRow), a locale string stores the pin.
export interface SessionStartInput {
  sessionId: string;
  routeId: string;
  version: string;
  locale: string;
  audioLocale?: string | null;
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

// A stored event_queue row (G09.01): EventInput plus the sent flag and the
// durable enqueue_seq insertion key (G22.03). sent is flush bookkeeping — 0
// until a sender resolves for the batch, 1 after the mark; neither the flag
// nor the key ever leaves the device (the key orders bounded pages, spec E3).
export interface EventQueueRow extends EventInput {
  enqueueSeq: number;
  sent: boolean;
}

// R07 hint limits (ADR G01.03 §3.9, ADR G07.04): one record per factually
// presented guide_id. `scope='session'` requires the sessionId (the schema
// CHECK says the same); `foreground` rows carry the window's facts while
// `guide_hint_last` holds the cross-opening cooldown.
export interface GuideHintRecordInput {
  readonly guideIds: readonly string[];
  readonly scope: 'session' | 'foreground';
  readonly sessionId?: string;
  readonly at: number;
}

// One guide_hint_state row read back for the limits: dismissed_at is null
// while the guide was only shown.
export interface GuideHintStateRow {
  readonly guideId: string;
  readonly shownAt: number;
  readonly dismissedAt: number | null;
}

// `09` §7 bundle_asset (zone A): the resume registry of the download channel
// (G04.02.a). One row per file of a layer, status pending/partial/complete;
// the registry is derived state, rebuilt by re-hashing what lies on disk.
// bytes_done is the honest disk fact — staged-but-unverified bytes stay
// 'partial', never 'complete'.
export type BundleAssetStatus = 'pending' | 'partial' | 'complete';

export interface AssetKey {
  routeId: string;
  version: string;
  locale: string;
  tier: string;
}

export interface BundleAssetRow extends AssetKey {
  path: string;
  status: BundleAssetStatus;
  bytesTotal: number;
  bytesDone: number;
  sha256: string;
}
