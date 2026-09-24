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
// the library UI (G06.04) — package deletion itself is G04.04.b (delete.ts),
// guarded by the session table through services/db.
//
// The package identity a deletion targets (G04.04.b) — route_id@version — and
// the layer key plus the digest port are canonical in services/contentRepo
// (one contract, two consumers — implementation-rules 2, 8); download
// re-exports them under the names its activation surface always used.
import type { LayerKey, LockEntry, PackageKey, Sha256, Tier } from '../contentRepo/types.ts';
import type { BundleAssetRow, SqlDriver } from '../db/types.ts';
import type { DownloadAccessPort } from './access.ts';

export type { LayerKey, LockEntry, PackageKey, Sha256, Tier };

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

// SHA-256 over raw bytes, hex-encoded — the port is canonical in
// services/contentRepo/types.ts (platform facility: node:crypto in the test
// adapters, expo-crypto on the device — TR-10).

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
  // The shared deletion gate (criterion 4, G04.04.b): optional so the
  // activation contract is unchanged for callers that never delete; when
  // present, the same instance the composition root handed to deletePackage().
  cancel?: DeletionGate;
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
    }
  // G04.04.b criterion 4: a deletion of the same package raced this
  // activation (the shared DeletionGate is marked). No rename happened, so
  // nothing on disk claims ready for a package the user has deleted; the
  // next activate() for the layer starts a fresh download. Recorded here as
  // the second deliberate extension of the §3.5 four categories (the first
  // is 'invalid-input' above).
  | { status: 'cancelled'; key: LayerKey; fetched: number };

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

// The in-memory cancellation flag shared by activate() and deletePackage()
// (criterion 4). The composition root creates one instance (createDeletionGate())
// and hands the same object to both deps. An activation begins by taking the
// package's current epoch (beginActivation); deletePackage bumps it
// (markCancelled) before removing anything, so every activation already in
// flight turns inactive at its next gate check and stops named instead of
// resurrecting a deleted package. An activation that starts after the delete
// takes the new epoch and runs as a normal fresh download — re-downloading a
// deleted package must work (criterion 3). Purely process-local: nothing is
// persisted, and a run without the optional cancel dep behaves exactly as
// before.
export interface DeletionGate {
  beginActivation(key: PackageKey): number;
  isActive(key: PackageKey, activation: number): boolean;
  markCancelled(key: PackageKey): void;
}

export interface DeleteDeps {
  store: DownloadStore;
  // The pinned-version guard reads zone B through the services/db public API.
  driver: SqlDriver;
  // Required: a deletion that skipped the mark could let a concurrent
  // activation re-create files the caller believes deleted (criterion 4).
  gate: DeletionGate;
}

// The named outcomes of deletePackage(): 'refused' is the pinned-version
// guard of ADR G01.03 §3.4 with its reason carried verbatim in `reason`;
// 'invalid-input' rejects unsafe ids before any filesystem or db call
// (criterion 5). A deleted package that had nothing on disk is still
// 'deleted' — remove() is idempotent, and the already-desired state is not a
// fault.
export type DeleteResult =
  | { status: 'deleted'; key: PackageKey; removedAssetRows: number }
  | { status: 'refused'; key: PackageKey; reason: 'pinned-by-unfinished-session'; sessionIds: string[] }
  | { status: 'invalid-input'; key: PackageKey; diagnostics: string[] };

// The result of a repair request (G04.04.c criterion 3): 'repaired' when
// every requested path was fetched, hash-verified and written back into the
// final layer; 'partial' when the transfer stopped; 'hash-mismatch' when a
// fetched file failed verification. `repaired` and `missing` are exhaustive
// over the request (missing includes the failing file); a 'repaired' result
// must be confirmed by a fresh presence check. 'invalid-input' covers a
// corrupt key or lock and any requested path the lock does not declare —
// fail closed, nothing outside the lock is ever fetched (criterion 4: a
// pinned version is never filled from another version's files).
export type RepairResult =
  | { status: 'repaired'; key: LayerKey; repaired: string[] }
  | {
      status: 'partial';
      key: LayerKey;
      repaired: string[];
      missing: string[];
      diagnostics: string[];
    }
  | {
      status: 'hash-mismatch';
      key: LayerKey;
      repaired: string[];
      paths: string[];
      missing: string[];
      diagnostics: string[];
    }
  | { status: 'insufficient-space'; key: LayerKey; needed: number; free: number | null }
  | { status: 'invalid-input'; key: LayerKey; diagnostics: string[] };
