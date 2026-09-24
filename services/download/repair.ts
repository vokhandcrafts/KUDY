// G04.04.c — the re-download request (issue #195 criterion 3): after the
// restart presence check names a layer's missing or short files, this entry
// fetches, hash-verifies and writes back exactly those lock paths — never a
// path the lock does not declare, and never a file of another version: the
// layer key pins route_id@version and the fetch port is bound to that same
// grant source by the composition (G04.02.b). The idiom is the activation's
// own — fetch → size → sha256 → .part + atomic rename into the final layer,
// one complete registry row per repaired file (zone A). Files that already
// verify are never touched and never deleted, so a failed repair leaves the
// old layer byte-identical (ADR G01.03 §3.7). The shared deletion gate
// (G04.04.b) is honored like activate() honors it: a package deleted while
// the repair runs stops named instead of resurrecting files or zone-A rows.
// No AccessReady is emitted: the activation commit is the single emission
// site (19 §3.5) and a repair restores an already-committed layer —
// readiness derives from the disk (§3.2; recoverOnOpen emits nothing for the
// same reason).
import { upsertBundleAsset } from '../db/db.ts';
import {
  completeRow,
  layerPath,
  parseActivationInput,
  stageAndRename,
  stagingLayerPath,
  verifyFetched,
} from './download.ts';
import type { ActivateDeps, ActivateInput, RepairResult } from './types.ts';

/**
 * Repair one layer by re-downloading exactly the requested lock paths
 * (criterion 3). Idempotent per file: every written file is hash-verified
 * first, and a verification failure stops the run with the remaining request
 * in `missing` — the caller re-checks presence and re-requests what is still
 * gone. A requested path outside the lock is rejected before any fetch
 * (criterion 4: the pinned version is never filled from elsewhere).
 */
export async function repairLayer(
  input: ActivateInput,
  deps: ActivateDeps,
  requested: readonly string[],
): Promise<RepairResult> {
  const { key, entries, diagnostics, invalid } = parseActivationInput(input);
  if (invalid) return { status: 'invalid-input', key, diagnostics };

  // The shared deletion gate (G04.04.b criterion 4), read like activate()
  // reads it: a package marked deleted stops this repair at the next
  // boundary — writing files or zone-A rows for a deleted package would
  // resurrect what the user removed.
  const gate = deps.cancel ?? null;
  const repair = gate?.beginActivation(key) ?? null;
  const cancelled = (): boolean =>
    gate !== null && repair !== null && !gate.isActive(key, repair);

  const declared = new Set(entries.map((entry) => entry.path));
  const wanted = [...new Set(requested)];
  const unknown = wanted.filter((path) => !declared.has(path));
  if (wanted.length === 0 || unknown.length > 0) {
    return {
      status: 'invalid-input',
      key,
      // An empty request is a composition bug, not a silent no-op; a path
      // outside the lock is never fetched.
      diagnostics: [
        ...diagnostics,
        ...unknown.map((path) => `repair#not-in-lock:${path}`),
        ...(wanted.length === 0 ? ['repair#empty-request'] : []),
      ],
    };
  }
  if (cancelled()) return { status: 'cancelled', key, repaired: [] };

  const wantedPaths = new Set(wanted);
  // Lock order, not request order: the repair of one layer is deterministic
  // (the same rule as the library inventory listing).
  const selected = entries.filter((entry) => wantedPaths.has(entry.path));
  const free = await deps.store.freeBytes();
  if (cancelled()) return { status: 'cancelled', key, repaired: [] };
  const needed = selected.reduce((sum, entry) => sum + entry.bytes, 0);
  if (free !== null && free < needed) {
    return { status: 'insufficient-space', key, needed, free };
  }

  const finalLayer = layerPath(key);
  const stagingLayer = stagingLayerPath(key);
  await deps.store.ensureDir(stagingLayer);
  await deps.store.ensureDir(finalLayer);
  if (cancelled()) return { status: 'cancelled', key, repaired: [] };

  const repaired: string[] = [];
  for (const [index, entry] of selected.entries()) {
    const remaining = selected.slice(index).map((item) => item.path);
    let bytes: Uint8Array;
    try {
      bytes = await deps.fetch(entry.path);
    } catch (error) {
      return {
        status: 'partial',
        key,
        repaired,
        missing: remaining,
        diagnostics: [
          `${entry.path}#fetch-failed`,
          // The port's message is diagnostic-safe by contract (types.ts);
          // surfaced, never swallowed.
          error instanceof Error && error.message !== '' ? error.message : 'fetch#unknown-error',
        ],
      };
    }
    if (cancelled()) return { status: 'cancelled', key, repaired };
    const fault = await verifyFetched(bytes, entry, deps.sha256);
    if (fault !== null) {
      return { status: 'hash-mismatch', key, repaired, paths: [entry.path], missing: remaining, diagnostics: [fault] };
    }
    // The old final file is overwritten only by a verified one.
    await stageAndRename(deps.store, stagingLayer, entry.path, bytes, `${finalLayer}/${entry.path}`);
    if (cancelled()) return { status: 'cancelled', key, repaired };
    await upsertBundleAsset(deps.driver, completeRow(key, entry));
    repaired.push(entry.path);
  }

  // Leftover .part files of a crashed repair live here; the layer no longer
  // needs its staging once every requested file is in place.
  await deps.store.remove(stagingLayer);
  return { status: 'repaired', key, repaired };
}
