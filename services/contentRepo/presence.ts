// G04.04.c — presence re-check after restart (`09` §7 «Пасля абнаўлення
// дадатку», ADR G01.03 §3.7): SQLite survives while iOS may orphan files, so
// every layer the app considers ready is re-derived from the disk before the
// content can play. The default is the cheap level-2 check of `09` §4 — the
// layer's lock.json declares every file; JSON entries are parsed (they are
// small and parsed at start anyway), media entries get presence and size via
// statSize, never a byte read of the 50–300 MB the level forbids. The full
// re-hash runs only on the three contract conditions (RecheckTrigger) — an
// ordinary restart never hashes. The check is read-only: recovery goes
// through a repair request to services/download, and every fault becomes a
// verdict the composition can show, never a throw (implementation-rules 14).
// Non-goals: the transfer itself (G04.02), the bundle_asset registry
// (rebuildBundleAssets — a write concern), background scheduling and UI.
import { readLayerFacts, validateLayerKey } from './inventory.ts';
import type {
  BundlesStore,
  LayerKey,
  LockEntry,
  PresenceVerdict,
  RecheckTrigger,
  Sha256,
} from './types.ts';

// The three conditions of `09` §4 that justify the full re-hash; anything
// else (the ordinary restart) stays at the metadata level.
const FULL_TRIGGERS: readonly RecheckTrigger[] = [
  'app-version-changed',
  'decode-error',
  'user-requested',
];

function layerRel(layer: LayerKey): string {
  return `bundles/${layer.routeId}/${layer.version}/${layer.locale}/${layer.tier}`;
}

// Reads one lock-declared file for the parse/hash passes; a read fault is
// registered as a recovery path — the same vocabulary the size walk uses —
// and the caller skips the entry.
async function readFileOrRegister(
  store: BundlesStore,
  rel: string,
  entry: LockEntry,
  missing: string[],
  failed: Set<string>,
  diagnostics: string[],
): Promise<Uint8Array | null> {
  const file = await store.readFile(`${rel}/${entry.path}`);
  if (file.kind === 'present') return file.bytes;
  missing.push(entry.path);
  failed.add(entry.path);
  diagnostics.push(`${entry.path}#${file.kind === 'absent' ? 'missing-file' : 'unreadable'}`);
  return null;
}

async function checkLayer(
  store: BundlesStore,
  layer: LayerKey,
  trigger: RecheckTrigger,
  sha256: Sha256,
): Promise<PresenceVerdict> {
  // Segments are checked on input, before any filesystem call (`09` §7).
  const invalid = validateLayerKey(layer);
  if (invalid.length > 0) return { status: 'invalid-input', layer, diagnostics: invalid };

  const rel = layerRel(layer);
  const facts = await readLayerFacts(store, rel);
  const checked = FULL_TRIGGERS.includes(trigger) ? 'full' : 'metadata';

  if (facts.declaredBytes === null) {
    // No readable lock: the file set is unknowable locally, so the recovery
    // offer carries no paths — the lock must come from the grant source
    // (G04.02.b), not from guesswork.
    return { status: 'needs-recovery', layer, checked, missing: [], diagnostics: facts.diagnostics };
  }

  const diagnostics = [...facts.diagnostics];
  const missing = [...facts.missingPaths];
  const failed = new Set(missing);

  // JSON entries (`09` §4 level 2: «их мы парсим»): a size-verified JSON that
  // no longer parses is a recovery path like a missing file — the repair
  // re-fetches it. Entries that already failed the size check are skipped:
  // they carry their own fault.
  for (const entry of facts.entries) {
    if (!entry.path.endsWith('.json') || failed.has(entry.path)) continue;
    const bytes = await readFileOrRegister(store, rel, entry, missing, failed, diagnostics);
    if (bytes === null) continue;
    try {
      JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      missing.push(entry.path);
      failed.add(entry.path);
      diagnostics.push(`${entry.path}#invalid-json`);
    }
  }

  // Level 3 — only on the trigger conditions: every remaining entry is read
  // and hashed; a same-size corruption that the metadata check cannot see
  // fails here (`09` §4: the size check does not see a flipped byte).
  if (checked === 'full') {
    for (const entry of facts.entries) {
      if (failed.has(entry.path)) continue;
      const bytes = await readFileOrRegister(store, rel, entry, missing, failed, diagnostics);
      if (bytes === null) continue;
      if ((await sha256(bytes)) !== entry.sha256) {
        missing.push(entry.path);
        failed.add(entry.path);
        diagnostics.push(`${entry.path}#sha256-mismatch`);
      }
    }
  }

  return missing.length === 0 && diagnostics.length === 0
    ? { status: 'verified', layer, checked }
    : { status: 'needs-recovery', layer, checked, missing, diagnostics };
}

/**
 * Re-check the presence of every layer the app considers ready (the caller
 * passes them — the inventory, the DB registry or the session's pinned
 * package). Returns one verdict per layer in input order; a damaged layer
 * reads as needs-recovery, never as playable (ADR G01.03 §3.7). The sha256
 * port is required even for metadata runs: a missing digest must fail
 * loudly at composition, not silently disable the full level.
 */
export async function checkPresence(
  store: BundlesStore,
  input: { layers: readonly LayerKey[]; trigger: RecheckTrigger; sha256: Sha256 },
): Promise<PresenceVerdict[]> {
  const verdicts: PresenceVerdict[] = [];
  for (const layer of input.layers) {
    verdicts.push(await checkLayer(store, layer, input.trigger, input.sha256));
  }
  return verdicts;
}
