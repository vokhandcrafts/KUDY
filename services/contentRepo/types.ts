// G04.03 — services/contentRepo contract types.
// Canonical names are copied verbatim from their sources (implementation-rules 2):
// tier ∈ {base, extended}, tier_available and AccessReady from ADR
// G01.03-session-access §3.1–§3.4 (issue #18); route.json field names from the
// G02.01 schemas (contracts/schemas/route.schema.json) and the G02.05 template.
// ContentRepo reads verified packages and derives availability; it never issues
// AccessReady — the only issuer is services/download (09 §6.1) — and never makes
// purchase decisions from client booleans (18_component_blueprint §services).

export type Tier = 'base' | 'extended';

// route.schema.json:13 — access = free_base | paid (verbatim; TR-3: the old
// 'free' spelling was never in the schema, and the old reader read schema-valid
// free_base packages as incomplete).
export type RouteAccess = 'free_base' | 'paid';

export interface PackageKey {
  routeId: string;
  version: string;
}

// One file lookup. 'absent' and 'unreadable' stay distinct: a declared but
// missing/empty/unreadable media file is a media error (G04.03 criterion 4,
// repair offer), while a missing structural file is an incomplete package
// (criterion 1, start locked). A zero-length media file counts as unreadable:
// a silent placeholder cannot play, so treating it as present would start a
// guide with a dead story.
export type FileFacts =
  | { kind: 'present'; bytes: Uint8Array }
  | { kind: 'absent' }
  | { kind: 'unreadable' };

// Storage seam between this module and the host. The device adapter
// (expo-file-system) and the node adapter both implement it; paths are
// package-relative with '/' separators on every platform (validate-package
// idiom: the fs APIs accept '/' on Windows, so the core stays platform-neutral).
// The adapter must confine every read to the package root regardless of
// `rel` — rel values originate in package JSON and are never trusted paths.
// G04.02 activates packages; ContentRepo only reads them.
export interface PackageStore {
  key: PackageKey;
  readFile(rel: string): Promise<FileFacts>;
  exists(rel: string): Promise<boolean>;
}

export interface EvaluateInput {
  locale: string;
  tier: Tier;
  // tier_available per ADR G01.03 §3.1/§3.2: layers the download channel has
  // verified and granted. Consumed as a fact, never decided here.
  grantedTiers?: readonly Tier[];
}

// The readiness card (картка гатоўнасці). Precedence when several apply:
// structural incompleteness first, then media recovery, then access — a
// package whose files are damaged cannot start regardless of grants, and a
// repair offer must not hide behind a purchase prompt.
export type Readiness =
  | {
      status: 'ready';
      routeId: string;
      version: string;
      tier: Tier;
      // Layers whose completeness is confirmed on disk (and granted where the
      // route is paid), limited to this evaluation's layers — a base start
      // evaluates ['base'] only; the card across all tiers is one evaluation
      // per tier. The durable tier_available and the derived
      // accessible_stop_ids stay owned by the DB/engine (ADR §3.2); this is the
      // disk-fact derivation they consume.
      tierAvailable: Tier[];
    }
  | { status: 'incomplete'; missing: string[] }
  | { status: 'needs-recovery'; media: string[] }
  | { status: 'access-locked'; tier: Tier };

// Criterion 5: the discovery index is its own read-through concern, separate
// from AccessReady and from start readiness. A missing or unparseable index
// yields a null result — the guide stays startable, just without discovery
// annotations (no fabricated catalogue).
export interface DiscoveryLookup {
  revision: string | null;
  index: Record<string, unknown> | null;
  fromCache: boolean;
}

export interface DiscoveryCache {
  read(store: PackageStore): Promise<DiscoveryLookup>;
}
