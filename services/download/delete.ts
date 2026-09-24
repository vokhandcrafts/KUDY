// G04.04.b — services/download package deletion: the guarded cleanup of a
// downloaded bundle. Canonical anchors, copied not paraphrased
// (implementation-rules 2): ADR G01.03 §3.4 (the version is immutable for its
// session's lifetime: «ачыстка пакета ў My KUDY адмаўляе выдаленне, пакуль
// існуе не-`finished` сесія з гэтай версіяй» — the named refusal below),
// §4 walkthrough («Выдаленне выкарыстоўванага пакета»), `09` §7 (zone A vs
// zone B: a deletion removes the package files and its bundle_asset rows —
// derived, rebuildable — and never touches session, settings, events, hints
// or feedback), `09` §17 (no automatic cleanup or storage budgets — deletion
// happens only through this explicit call), `19` §2.2 (useLibraryController
// must not delete a pinned version — the guard lives here, not in the UI).
import { isSafeSegment } from '../contentRepo/inventory.ts';
import { deletePackageAssets, listUnfinishedSessions } from '../db/db.ts';
import { packagePath, stagingVersionPath } from './download.ts';
import type { DeletionGate, DeleteDeps, DeleteResult, PackageKey } from './types.ts';

// The gate factory (types.ts): an epoch counter per package identity.
// beginActivation hands the current epoch to a starting activation;
// markCancelled (deletePackage, before any removal) bumps it, which turns
// every in-flight activation of that package inactive at its next check.
export function createDeletionGate(): DeletionGate {
  const epochs = new Map<string, number>();
  const identityOf = (key: PackageKey) => JSON.stringify([key.routeId, key.version]);
  const epochOf = (key: PackageKey): number => epochs.get(identityOf(key)) ?? 0;
  return {
    beginActivation: (key) => epochOf(key),
    isActive: (key, activation) => epochOf(key) === activation,
    markCancelled: (key) => {
      const identity = identityOf(key);
      epochs.set(identity, (epochs.get(identity) ?? 0) + 1);
    },
  };
}

// `09` §7: identifiers reaching the filesystem are untrusted input and are
// checked as safe units before any filesystem or db call (criterion 5) — the
// same whole-segment guard validateKey() applies to activation keys.
export function validatePackageKey(key: PackageKey): string[] {
  const diagnostics: string[] = [];
  for (const [name, value] of [
    ['route_id', key.routeId],
    ['version', key.version],
  ] as const) {
    if (typeof value !== 'string') diagnostics.push(`${name}#type`);
    else if (!isSafeSegment(value)) diagnostics.push(`${name}#unsafe-path:${value}`);
  }
  return diagnostics;
}

/**
 * Delete one downloaded package (route_id@version, every locale and tier).
 * The pinned-version guard runs first (ADR G01.03 §3.4): any session row of
 * this version that is not 'finished' refuses the deletion with the named
 * reason and the blocking session ids. Otherwise the gate is marked before
 * any removal (criterion 4), then the package directory, its staging tree of
 * the same version (an in-flight download's staging is cancelled with it)
 * and its bundle_asset rows are removed — zone A only (criterion 2).
 * Nothing here reads or writes entitlement or the grant client: a later
 * re-download runs through requestGrant() like any first download
 * (criterion 3). Deletion of a package with nothing on disk is still
 * 'deleted' — remove() is idempotent, the already-desired state is not a
 * fault.
 */
export async function deletePackage(input: PackageKey, deps: DeleteDeps): Promise<DeleteResult> {
  const diagnostics = validatePackageKey(input);
  if (diagnostics.length > 0) return { status: 'invalid-input', key: input, diagnostics };

  // The driver surface is synchronous, so the guard read and the gate mark
  // happen in one turn: once the guard passes, no activation can start or
  // pass a gate check before the mark is in (criterion 4).
  const pinned = listUnfinishedSessions(deps.driver, input.routeId, input.version);
  if (pinned.length > 0) {
    return {
      status: 'refused',
      key: input,
      reason: 'pinned-by-unfinished-session',
      sessionIds: pinned.map((session) => session.sessionId),
    };
  }

  deps.gate.markCancelled(input);
  await deps.store.remove(stagingVersionPath(input.routeId, input.version));
  await deps.store.remove(packagePath(input.routeId, input.version));
  return {
    status: 'deleted',
    key: input,
    removedAssetRows: deletePackageAssets(deps.driver, input.routeId, input.version),
  };
}
