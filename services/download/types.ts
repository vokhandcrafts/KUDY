// G04.02.a — services/download contract types: staging, per-file verification,
// atomic activation. Canonical anchors, copied not paraphrased
// (implementation-rules 2): `09` §4 (lock.json [{path, bytes, sha256}], the
// three-level sha256 policy), `09` §7 (layout
// bundles/<route_id>/<version>/<locale>/<tier>/ with staging/ beside it, safe
// path segments checked on input, bundle_asset states pending/partial/
// complete), ADR G01.03 §3.5–§3.7 (download is the only AccessReady issuer —
// emitted through the typed channel of access.ts after the activation commit;
// staging → per-file hash → atomic rename → only then AccessReady; resume by
// hash, never by offset; partial never counts as ready; a failed upgrade
// never deletes the old layer), `19` §3.5 (activate() and the local
// activation result categories). Non-goals: the grant and HTTP transfer
// (G04.02.b), the expo-file-system adapter (TR-10 — no driver is pinned),
// the library UI and deletion (G04.04).
import type { LockEntry, Tier } from '../contentRepo/types.ts';
import type { BundleAssetRow, SqlDriver } from '../db/types.ts';
import type { DownloadAccessPort } from './access.ts';

export type { LockEntry, Tier };

// One layer of one bundle: the delivery unit `locale × tier` of
// route_id@version (`09` §4).
export interface LayerKey {
  routeId: string;
  version: string;
  locale: string;
  tier: Tier;
}

// The injected filesystem port over the bundles root (`09` §7 layout). All
// rel paths are '/'-separated (validate-package idiom — the fs APIs accept
// '/' on every platform). The adapter owns confinement to the root; the core
// additionally validates every segment and lock path on input, before the
// first call (criterion 4). remove() is idempotent — an absent target is
// already the desired state.
export interface DownloadStore {
  ensureDir(rel: string): Promise<void>;
  writeFile(rel: string, bytes: Uint8Array): Promise<void>;
  rename(fromRel: string, toRel: string): Promise<void>;
  remove(rel: string): Promise<void>;
  exists(rel: string): Promise<boolean>;
  readFile(rel: string): Promise<Uint8Array | null>;
  statSize(rel: string): Promise<number | null>;
  // Bytes available on the volume; null when the host cannot say — the core
  // then never claims insufficient space (it cannot know).
  freeBytes(): Promise<number | null>;
}

// SHA-256 over raw bytes, hex-encoded. A port because the digest API is a
// platform facility (node:crypto in the test adapter here, expo-crypto on the
// device — TR-10). Raw bytes only: EOL conversion between checkout and hash
// is the AR-1 defect class (implementation-rules 4).
export type Sha256 = (bytes: Uint8Array) => Promise<string>;

// The byte source of the transfer (the grant-backed source of G04.02.b, or a
// plain test fake; the production HTTP adapter is out of scope — TR-10).
// Resolves with the full file bytes; a rejection is an interrupted transfer.
// A rejection message is surfaced in the activation diagnostics, so a source
// over signed URLs keeps it named and redacted — never a URL or a credential.
export type FetchPort = (path: string) => Promise<Uint8Array>;

// One activation request: the layer key plus the parsed lock.json of the
// layer. The lock is validated here on input (criterion 4): a corrupt lock
// yields diagnostics in the result, never a thrown error.
export interface ActivateInput extends LayerKey {
  lock: unknown;
}

export interface ActivateDeps {
  store: DownloadStore;
  fetch: FetchPort;
  sha256: Sha256;
  // bundle_asset goes through the services/db public API (zone A only).
  driver: SqlDriver;
  // The AccessReady channel (19 §3.2): activate() delivers the event after
  // the commit through this port; the composition root passes the same
  // instance the controller subscribes to. Required — a silent absence would
  // drop the notification of every commit instead of failing loudly.
  access: DownloadAccessPort;
}

// The local activation result of `19` §3.5: поўны / частковы / хэш-
// несупадзенне / недаступнае месца — complete / partial / hash-mismatch /
// insufficient-space. 'invalid-input' extends the four for locally rejected
// requests (unsafe segments, a corrupt lock): §3.5 closes the server codes,
// not the local transfer outcomes, and criterion 4 needs diagnostics without
// a throw. None of the failure statuses yields ready (ADR G01.03 §3.7:
// partial ніколі не лічыцца ready).
export type ActivationResult =
  | {
      status: 'complete';
      key: LayerKey;
      verified: number;
      bytes: number;
      // Files fetched by this call — 0 on a repeated request for an already
      // complete layer (ADR G01.03 §3.5: a repeated activation is a no-op).
      fetched: number;
      diagnostics: string[];
    }
  | {
      status: 'partial';
      key: LayerKey;
      // Lock paths not verified at the point the transfer stopped.
      missing: string[];
      fetched: number;
      diagnostics: string[];
    }
  | {
      status: 'hash-mismatch';
      key: LayerKey;
      paths: string[];
      fetched: number;
      diagnostics: string[];
    }
  | {
      status: 'insufficient-space';
      key: LayerKey;
      needed: number;
      free: number | null;
    }
  | {
      status: 'invalid-input';
      key: LayerKey;
      diagnostics: string[];
    };

export interface RebuildDeps {
  store: DownloadStore;
  sha256: Sha256;
  driver: SqlDriver;
}

// The disk-derived answer of recoverOnOpen (G04.02.c): readiness computed
// from the disk facts on every open, never persisted — no ready column or
// flag exists in zone B (ADR G01.03 §3.2, §3.6).
export type RecoveryResult =
  | { status: 'ready'; key: LayerKey }
  | { status: 'not-ready'; key: LayerKey }
  | { status: 'invalid-input'; key: LayerKey; diagnostics: string[] };

// `09` §7: bundle_asset can be rebuilt by re-hashing the disk. A corrupt key
// or lock is diagnosed the same way as in activate().
export type RebuildResult =
  | { status: 'rebuilt'; key: LayerKey; rows: BundleAssetRow[] }
  | { status: 'invalid-input'; key: LayerKey; diagnostics: string[] };
