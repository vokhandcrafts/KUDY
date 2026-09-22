// G04.01 — schema of the two SQLite zones. Zone A (derived — `09` §7) is
// rebuildable from disk and catalogue; drop-and-recreate is allowed only
// there. Zone B (durable — `09` §7, ADR G01.03 §3.8/§3.9, `21` §5.4) is
// migrations-only: never an automatic delete, a failed migration never wipes
// it. Migrations follow ADR G01.03 §3.8: PRAGMA user_version is the schema
// number, one step = one migration = one transaction, steps only add tables
// or columns.
import type { SqlDriver } from './types.ts';

export const ZONE_A_TABLES = ['bundle_asset', 'catalog_cache', 'discovery_cache'] as const;

// zone B inventory: session (ADR G01.03 §3.1), guide_hint_state +
// guide_hint_last (ADR §3.9), migration_log (ADR §3.8, `09` §7),
// event_queue + settings + device (`09` §7), feedback_local +
// feedback_outbox (`21` §5.4).
export const ZONE_B_TABLES = [
  'session',
  'guide_hint_state',
  'guide_hint_last',
  'migration_log',
  'event_queue',
  'settings',
  'device',
  'feedback_local',
  'feedback_outbox',
] as const;

export type ZoneATable = (typeof ZONE_A_TABLES)[number];
export type ZoneBTable = (typeof ZONE_B_TABLES)[number];

// DDL is the single source used by both migration step 1 and the zone A
// rebuild, so the two can never drift apart.
export const ZONE_A_DDL: Record<ZoneATable, string> = {
  // `09` §7: key (route_id, version, locale, tier, path); status
  // pending/partial/complete; bytes_total, bytes_done, sha256. The resume
  // registry — rebuilt by re-hashing what is on disk.
  bundle_asset: `CREATE TABLE bundle_asset (
  route_id TEXT NOT NULL,
  version TEXT NOT NULL,
  locale TEXT NOT NULL,
  tier TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'partial', 'complete')),
  bytes_total INTEGER NOT NULL,
  bytes_done INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (route_id, version, locale, tier, path)
)`,
  // `09` §7: a copy of catalog.json for offline start, keyed by route_id.
  catalog_cache: `CREATE TABLE catalog_cache (
  route_id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL
)`,
  // `21` §5.4 fixes the table's name and zone ("discovery_cache —
  // аднаўляльная зона A"); the key/payload shape belongs to the discovery
  // controller (G15.03) and may only grow through a later migration step.
  discovery_cache: `CREATE TABLE discovery_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  revision TEXT,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`,
};

export const ZONE_B_DDL: Record<ZoneBTable, string> = {
  // ADR G01.03 §3.1 — verbatim field set and types; one walk = one row; the
  // live-session invariant below is fixed by the partial unique index at the
  // schema level ("спробы Start або switch адначасова вырашаюцца базай").
  session: `CREATE TABLE session (
  session_id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL,
  version TEXT NOT NULL,
  locale TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT '["base"]',
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'finished')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  auto_fired TEXT NOT NULL DEFAULT '[]',
  heard TEXT NOT NULL DEFAULT '[]',
  last_stop_id TEXT,
  play_seq INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX one_live_session ON session(
  (CASE WHEN state IN ('active','paused') THEN 1 END)
)`,
  // ADR G01.03 §3.9: scope session/foreground; session_id NOT NULL for the
  // session scope; uniqueness (scope, session_id, guide_id) for the session
  // scope = one guide hint per session.
  guide_hint_state: `CREATE TABLE guide_hint_state (
  scope TEXT NOT NULL CHECK (scope IN ('session', 'foreground')),
  guide_id TEXT NOT NULL,
  session_id TEXT,
  shown_at INTEGER NOT NULL,
  dismissed_at INTEGER,
  CHECK (scope <> 'session' OR session_id IS NOT NULL)
);
CREATE UNIQUE INDEX guide_hint_session_scope ON guide_hint_state (scope, session_id, guide_id)
  WHERE scope = 'session'`,
  // ADR G01.03 §3.9: foreground cooldown between app openings.
  guide_hint_last: `CREATE TABLE guide_hint_last (
  guide_id TEXT PRIMARY KEY NOT NULL,
  last_shown_at INTEGER NOT NULL,
  last_dismissed_at INTEGER
)`,
  // ADR G01.03 §3.8: the reverse record of zone B transformations ("кожны
  // зыходны stop_id запісваецца ў migration_log"); unresolved stop_ids are
  // flagged legacy. Empty until the first data migration lands.
  migration_log: `CREATE TABLE migration_log (
  version INTEGER NOT NULL,
  applied_at INTEGER NOT NULL,
  session_id TEXT,
  original_stop_id TEXT NOT NULL,
  story_id TEXT,
  legacy INTEGER NOT NULL DEFAULT 0
)`,
  // `09` §10: event_id, type, at, schema version, payload, sent. Local
  // progress never depends on analytics being sent; events are written
  // regardless of consent, sending is consent-gated (G09.02).
  event_queue: `CREATE TABLE event_queue (
  event_id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0
)`,
  // `09` §7: language, permissions shown, analytics consent.
  settings: `CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
)`,
  // `09` §7: one row; device_id only — the secret lives in expo-secure-store,
  // never here.
  device: `CREATE TABLE device (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  device_id TEXT NOT NULL
)`,
  // `21` §5.4: "першае захоўвае target, acknowledged revision/score, чарнавік
  // і стан". The state values are the §5.4 lifecycle draft → pending →
  // sending → sent plus conflict / action_required.
  feedback_local: `CREATE TABLE feedback_local (
  target TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  draft TEXT,
  state TEXT NOT NULL CHECK (state IN ('draft', 'pending', 'sending', 'sent', 'conflict', 'action_required'))
)`,
  // `21` §5.4: "другое — operation/mutation ID, expected_revision, payload,
  // disclosure_version, created_at і transport-state". target is carried as a
  // column (not only inside payload) because §5.4 requires at most one
  // in-flight operation per target.
  feedback_outbox: `CREATE TABLE feedback_outbox (
  mutation_id TEXT PRIMARY KEY NOT NULL,
  target TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  disclosure_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  transport_state TEXT NOT NULL CHECK (transport_state IN ('pending', 'sending', 'sent', 'conflict', 'action_required'))
)`,
};

export const INITIAL_SCHEMA_DDL = [...Object.values(ZONE_A_DDL), ...Object.values(ZONE_B_DDL)].join(
  ';\n',
);

export interface MigrationStep {
  version: number;
  up(driver: SqlDriver): void;
}

export const migrationSteps: MigrationStep[] = [
  {
    version: 1,
    up: (driver) => {
      driver.execSql(INITIAL_SCHEMA_DDL);
    },
  },
];
