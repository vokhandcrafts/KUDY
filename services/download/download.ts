// G04.02.a — services/download activation core: staging → per-file sha256 →
// atomic rename. The crash chain is ADR G01.03 §3.7: staging sits beside the
// final directory on the same volume, every file is hash-verified on the fly,
// the layer becomes final through one rename, and only a complete layer can
// yield ready — partial never does, and a failed upgrade never deletes the
// old layer. Readiness is derived from the disk, so no separate ready flag
// exists to lag behind (§3.2, §3.6). The core is platform-neutral: the
// filesystem, the byte source and the digest enter as ports (TR-10), and
// bundle_asset goes through the services/db public API (zone A only).
import { parseLockEntry, validateLayerKey } from '../contentRepo/inventory.ts';
import type { Tier } from '../contentRepo/types.ts';
import { replaceBundleAssets, upsertBundleAsset } from '../db/db.ts';
import type { BundleAssetRow } from '../db/types.ts';
import { emitAccessReady } from './access.ts';
import type {
  ActivateDeps,
  ActivateInput,
  ActivationResult,
  DownloadStore,
  LayerKey,
  LockEntry,
  RebuildDeps,
  RebuildResult,
  RecoveryResult,
  Sha256,
} from './types.ts';

// The canonical layer-key check lives in contentRepo/inventory.ts (shared
// with the restart presence check); re-exported under the historical name so
// the activation surface and grant.ts keep their import path.
export { validateLayerKey as validateKey } from '../contentRepo/inventory.ts';

// `09` §7: the staging directory sits beside the final layout under the
// route, as a sibling of the versions — the library inventory (G04.04.a)
// already skips it there as "not a version". Same volume as the final layer,
// so the activation rename is atomic.
export const STAGING = 'staging';

export function layerPath(key: LayerKey): string {
  return `bundles/${key.routeId}/${key.version}/${key.locale}/${key.tier}`;
}

// The package root the layer belongs to: the shared package files
// (route.json) sit beside the locale directories (09 §7 layout). Used by the
// emission reader in both complete paths of activate() and by the deletion of
// the whole package (G04.04.b delete.ts).
export function packagePath(routeId: string, version: string): string {
  return `bundles/${routeId}/${version}`;
}

// The staging tree of one package version: every layer's staging directory
// and its rename trash live inside it, so the deletion of a package removes
// the whole tree in one remove() (G04.04.b criterion 4 — staging cancelled).
export function stagingVersionPath(routeId: string, version: string): string {
  return `bundles/${routeId}/${STAGING}/${version}`;
}

export function stagingLayerPath(key: LayerKey): string {
  return `bundles/${key.routeId}/${STAGING}/${key.version}/${key.locale}/${key.tier}`;
}

// The parsed lock.json — every entry through the shared shape guard. An empty
// layer cannot be a real layer (a layer carries at least its stops.json), so
// an empty lock is a fault, not a vacuous success.
export function parseLock(lock: unknown): { entries: LockEntry[]; diagnostics: string[] } {
  if (!Array.isArray(lock)) return { entries: [], diagnostics: ['lock.json#type'] };
  const diagnostics: string[] = [];
  const entries: LockEntry[] = [];
  const seen = new Set<string>();
  lock.forEach((entry, index) => {
    const checked = parseLockEntry(entry, `lock.json[${index}]`);
    if (!checked.ok) {
      diagnostics.push(checked.diagnostic);
      return;
    }
    if (seen.has(checked.entry.path)) {
      diagnostics.push(`lock.json[${index}]#duplicate:${checked.entry.path}`);
      return;
    }
    seen.add(checked.entry.path);
    entries.push(checked.entry);
  });
  if (diagnostics.length === 0 && entries.length === 0) diagnostics.push('lock.json#empty');
  return { entries, diagnostics };
}

export function completeRow(key: LayerKey, entry: LockEntry): BundleAssetRow {
  return {
    routeId: key.routeId,
    version: key.version,
    locale: key.locale,
    tier: key.tier,
    path: entry.path,
    status: 'complete',
    bytesTotal: entry.bytes,
    bytesDone: entry.bytes,
    sha256: entry.sha256,
  };
}

// The registry starts from disk presence: a staged file of this layer is
// 'partial' with its honest size, an absent one is 'pending' (09 §7 — the
// registry is rebuilt from the disk, it never invents progress).
async function initialRows(key: LayerKey, entries: LockEntry[], deps: ActivateDeps): Promise<BundleAssetRow[]> {
  const stagingLayer = stagingLayerPath(key);
  const rows: BundleAssetRow[] = [];
  for (const entry of entries) {
    const size = await deps.store.statSize(`${stagingLayer}/${entry.path}`);
    rows.push({
      routeId: key.routeId,
      version: key.version,
      locale: key.locale,
      tier: key.tier,
      path: entry.path,
      status: size === null ? 'pending' : 'partial',
      bytesTotal: entry.bytes,
      bytesDone: size ?? 0,
      sha256: entry.sha256,
    });
  }
  return rows;
}

// Level-2 metadata check (09 §4 — presence and size from lock.json): the
// repeated-request fast path. The full per-file hash already happened when
// this layer was first activated; a deeper re-hash on demand is the open/
// verify level (09 §4), not an activation concern.
async function layerComplete(deps: ActivateDeps, finalLayer: string, entries: LockEntry[]): Promise<boolean> {
  for (const entry of entries) {
    if ((await deps.store.statSize(`${finalLayer}/${entry.path}`)) !== entry.bytes) return false;
  }
  return true;
}

function remainingMissing(entries: LockEntry[], from: number, kept: Set<string>): string[] {
  return entries.slice(from).map((entry) => entry.path).filter((path) => !kept.has(path));
}

// The shared request prologue: build the layer key and validate every input
// unit — segments and lock entries — before either entry point touches the
// filesystem (criterion 4). Also the prologue of the repair request
// (repair.ts): one input contract for both.
export function parseActivationInput(input: ActivateInput): {
  key: LayerKey;
  entries: LockEntry[];
  diagnostics: string[];
  invalid: boolean;
} {
  const key: LayerKey = { routeId: input.routeId, version: input.version, locale: input.locale, tier: input.tier };
  const diagnostics = validateLayerKey(key);
  const lock = parseLock(input.lock);
  diagnostics.push(...lock.diagnostics);
  return { key, entries: lock.entries, diagnostics, invalid: diagnostics.length > 0 };
}

// The size-then-sha256 ladder one transferred file must climb (`09` §4):
// the named fault, or null when the bytes verify. Shared by the activation
// and the repair request so the verification order cannot drift.
export async function verifyFetched(bytes: Uint8Array, entry: LockEntry, sha256: Sha256): Promise<string | null> {
  if (bytes.length !== entry.bytes) return `${entry.path}#size-mismatch`;
  if ((await sha256(bytes)) !== entry.sha256) return `${entry.path}#sha256-mismatch`;
  return null;
}

// The .part + rename idiom (ADR G01.03 §3.7): a crash mid-write leaves an
// ambiguous .part that the next run discards and re-fetches — never a
// truncated file that looks complete. Both the .part's parent in staging and
// the rename target's parent are ensured first — activation renames inside
// staging, repair renames onto the final file, and an orphaned final
// subdirectory (the 09 §7 scenario repair exists for) must not turn the
// rename into an ENOENT throw. Both same-volume, hence atomic.
export async function stageAndRename(
  store: DownloadStore,
  stagingLayer: string,
  entryPath: string,
  bytes: Uint8Array,
  targetRel: string,
): Promise<void> {
  const slash = entryPath.lastIndexOf('/');
  if (slash !== -1) await store.ensureDir(`${stagingLayer}/${entryPath.slice(0, slash)}`);
  const targetSlash = targetRel.lastIndexOf('/');
  if (targetSlash !== -1) await store.ensureDir(targetRel.slice(0, targetSlash));
  await store.writeFile(`${stagingLayer}/${entryPath}.part`, bytes);
  await store.rename(`${stagingLayer}/${entryPath}.part`, targetRel);
}

/**
 * Verify and activate one layer (19 §3.5 activate()). Idempotent: a repeated
 * request for a complete layer returns complete with zero fetches; every
 * failure category leaves the old layer untouched and partial never counts as
 * ready (ADR G01.03 §3.7).
 */
export async function activate(input: ActivateInput, deps: ActivateDeps): Promise<ActivationResult> {
  const { key, entries, diagnostics, invalid } = parseActivationInput(input);
  if (invalid) return { status: 'invalid-input', key, diagnostics };

  // The shared deletion gate (G04.04.b criterion 4): with a gate present the
  // activation takes the package's current epoch and stops named the moment
  // a deletePackage() of the same package has bumped it — checked after
  // every await boundary below, with the rename tail re-read against the
  // gate (a deletion racing the final rename is the named cancelled outcome,
  // not a raw store error). Without the optional dep this is exactly the
  // pre-G04.04.b behavior.
  const gate = deps.cancel ?? null;
  const activation = gate?.beginActivation(key) ?? null;
  const cancelled = (): boolean =>
    gate !== null && activation !== null && !gate.isActive(key, activation);

  const finalLayer = layerPath(key);
  const stagingLayer = stagingLayerPath(key);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);

  // Trash of a replace that crashed between its two renames — unambiguous
  // garbage, removed before anything else reads the layout.
  await deps.store.remove(`${stagingLayer}.old`);

  const initial = await initialRows(key, entries, deps);
  if (cancelled()) return { status: 'cancelled', key, fetched: 0 };
  await replaceBundleAssets(deps.driver, key, initial);

  const alreadyComplete = await layerComplete(deps, finalLayer, entries);
  if (cancelled()) return { status: 'cancelled', key, fetched: 0 };
  if (alreadyComplete) {
    await replaceBundleAssets(deps.driver, key, entries.map((entry) => completeRow(key, entry)));
    await deps.store.remove(stagingLayer);
    if (cancelled()) return { status: 'cancelled', key, fetched: 0 };
    // The repeated request commits the complete state again (a no-op for an
    // already complete layer); the emission dedupes the identity per run.
    const accessDiagnostics = await emitAccessReady(deps.access, key, (rel) =>
      deps.store.readFile(`${packagePath(key.routeId, key.version)}/${rel}`),
    );
    return { status: 'complete', key, verified: entries.length, bytes: totalBytes, fetched: 0, diagnostics: accessDiagnostics };
  }

  // Resume pass (criterion 2): staging files that hash-verify are kept and
  // never re-fetched; a stale or .part leftover is ambiguous (ADR G01.03
  // §3.7) and is re-fetched below.
  const kept = new Set<string>();
  let keptBytes = 0;
  for (const entry of entries) {
    const bytes = await deps.store.readFile(`${stagingLayer}/${entry.path}`);
    if (bytes === null || bytes.length !== entry.bytes) continue;
    if ((await deps.sha256(bytes)) !== entry.sha256) continue;
    kept.add(entry.path);
    keptBytes += entry.bytes;
  }

  const needed = totalBytes - keptBytes;
  const free = await deps.store.freeBytes();
  if (free !== null && free < needed) {
    return { status: 'insufficient-space', key, needed, free };
  }

  // The staged layer and the final layer's parent exist before any write:
  // the per-file writes land inside staging, and the activation rename needs
  // the destination parent in place (rename moves, it does not create).
  await deps.store.ensureDir(stagingLayer);
  await deps.store.ensureDir(finalLayer.slice(0, finalLayer.lastIndexOf('/')));

  let fetched = 0;
  for (const [index, entry] of entries.entries()) {
    if (cancelled()) return { status: 'cancelled', key, fetched };
    if (kept.has(entry.path)) {
      await upsertBundleAsset(deps.driver, completeRow(key, entry));
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await deps.fetch(entry.path);
    } catch (error) {
      return {
        status: 'partial',
        key,
        missing: remainingMissing(entries, index, kept),
        fetched,
        diagnostics: [
          `${entry.path}#fetch-failed`,
          // The port's message is diagnostic-safe by contract (types.ts) and
          // names the grant-level reason; surfaced, never swallowed.
          error instanceof Error && error.message !== '' ? error.message : 'fetch#unknown-error',
        ],
      };
    }
    // The fetch was the await boundary: a deletion that completed while the
    // transfer was parked stops the download here, before any write could
    // recreate staging the user has already deleted (criterion 4).
    if (cancelled()) return { status: 'cancelled', key, fetched };
    fetched += 1;
    const fault = await verifyFetched(bytes, entry, deps.sha256);
    if (fault !== null) {
      return { status: 'hash-mismatch', key, paths: [entry.path], fetched, diagnostics: [fault] };
    }
    await stageAndRename(deps.store, stagingLayer, entry.path, bytes, `${stagingLayer}/${entry.path}`);
    await upsertBundleAsset(deps.driver, completeRow(key, entry));
  }

  // Every file verified — activation is one rename. A final layer that
  // exists here failed the level-2 check above (a damaged install being
  // repaired): it moves into staging trash first, so a crash between the two
  // renames leaves the layer old or new, never a mix (criterion 3).
  if (cancelled()) return { status: 'cancelled', key, fetched };
  // The rename tail is the one window the per-await checks cannot split
  // further: a deletion may sweep the staging tree while a rename is in
  // flight. A failure here is re-read against the gate — a marked deletion
  // is the named cancelled outcome (the package is already gone, so there is
  // nothing to commit), any other store failure keeps propagating.
  try {
    if (await deps.store.exists(finalLayer)) {
      await deps.store.rename(finalLayer, `${stagingLayer}.old`);
    }
    await deps.store.rename(stagingLayer, finalLayer);
    await deps.store.remove(`${stagingLayer}.old`);
  } catch (error) {
    if (cancelled()) return { status: 'cancelled', key, fetched };
    throw error;
  }
  if (cancelled()) return { status: 'cancelled', key, fetched };

  // The commit is done — only now does the AccessReady event exist
  // (ADR G01.03 §3.7: rename → only then AccessReady; 19 §3.5: successful
  // activation is the single emission site). A crash above this line leaves
  // the layer on disk with no event — recovery on open derives readiness
  // from the disk, no flag to lag behind. A deletion marked between the
  // check above and the emission resolves the read against a swept package
  // (null route.json → empty payload + diagnostic) — the disk truth wins on
  // the next readiness derivation, and the accepted window ends with the
  // emission itself.
  const accessDiagnostics = await emitAccessReady(
    deps.access,
    key,
    (rel) => deps.store.readFile(`${packagePath(key.routeId, key.version)}/${rel}`),
  );
  return { status: 'complete', key, verified: entries.length, bytes: totalBytes, fetched, diagnostics: accessDiagnostics };
}

/**
 * Rebuild the bundle_asset registry of a layer by re-hashing the final layer
 * on disk (09 §7: the registry is derived state). Verified files read as
 * complete, present-but-wrong bytes as partial with their honest size,
 * absent files as pending.
 */
export async function rebuildBundleAssets(input: ActivateInput, deps: RebuildDeps): Promise<RebuildResult> {
  const { key, entries, diagnostics, invalid } = parseActivationInput(input);
  if (invalid) return { status: 'invalid-input', key, diagnostics };

  const finalLayer = layerPath(key);
  const rows: BundleAssetRow[] = [];
  for (const entry of entries) {
    const bytes = await deps.store.readFile(`${finalLayer}/${entry.path}`);
    let status: BundleAssetRow['status'] = 'pending';
    let bytesDone = 0;
    if (bytes !== null) {
      bytesDone = bytes.length;
      status =
        bytes.length === entry.bytes && (await deps.sha256(bytes)) === entry.sha256 ? 'complete' : 'partial';
    }
    rows.push({
      routeId: key.routeId,
      version: key.version,
      locale: key.locale,
      tier: key.tier,
      path: entry.path,
      status,
      bytesTotal: entry.bytes,
      bytesDone,
      sha256: entry.sha256,
    });
  }
  await replaceBundleAssets(deps.driver, key, rows);
  return { status: 'rebuilt', key, rows };
}

/**
 * Recovery on open (G04.02.c, ADR G01.03 §3.7): after a restart the layer's
 * readiness is derived from the disk — the bundle_asset registry is rebuilt
 * by re-hashing the final layer, and the disk facts alone answer whether the
 * layer is ready. Nothing is emitted here: the activation commit is the
 * single emission site (19 §3.5), and zone B holds no ready column or flag
 * that could go stale (ADR G01.03 §3.2, §3.6) — the crash row "between
 * rename and AccessReady" self-heals through this derivation.
 */
export async function recoverOnOpen(input: ActivateInput, deps: RebuildDeps): Promise<RecoveryResult> {
  const rebuilt = await rebuildBundleAssets(input, deps);
  if (rebuilt.status === 'invalid-input') return rebuilt;
  return {
    status: rebuilt.rows.every((row) => row.status === 'complete') ? 'ready' : 'not-ready',
    key: rebuilt.key,
  };
}
