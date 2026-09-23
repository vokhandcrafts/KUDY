// G04.04.a — read-only library inventory (My KUDY facts, no UI): one row per
// route_id@version × locale × tier with bytes from the layer's lock.json and
// disk facts. States per 09 §7: not_downloaded → partial (N missing) → ready
// → stale. 'stale' is derived from the catalog advertising a newer version —
// never from a session version (ADR G01.03 §3.4: the session pins its version,
// a newer catalog changes no readiness and replaces no file). The inventory
// writes nothing: sizes are derived per call, never stored (criterion 3;
// zone B untouched). Non-goals: deletion (G04.04.b), the presence re-hash
// (G04.04.c), downloading the update (G04.02), UI (G06.04).
import path from 'node:path';

import type {
  BundlesStore,
  InventoryEntry,
  InventoryResult,
  LockEntry,
  Tier,
} from './types.ts';

// 09 §7: identifiers reaching the filesystem are untrusted input and are
// checked as safe path segments (no separators, no '..', no NUL) on input.
// Catalog-sourced strings are exactly that. Disk-sourced names come from
// readdir and cannot contain separators, so they are used as listed; the
// adapter still owns confinement, as for PackageStore. Exported as the shared
// safe-unit idiom (implementation-rules 3): the download activation
// (G04.02.a) reuses these instead of a second variant.
export function isSafeSegment(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) &&
    !value.includes('/') && !value.includes('\\') && !value.includes('\0') &&
    value !== '.' && value !== '..';
}

// A lock path is a multi-segment rel path inside the layer directory:
// '/'-separated (validate-package idiom — the fs APIs accept '/' everywhere),
// never absolute, no traversal segments, no NUL. Exported together with
// isSafeSegment as the shared safe-unit idiom.
export function isSafeRel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) &&
    !value.includes('\\') && !value.includes('\0') &&
    value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isTier(value: unknown): value is Tier {
  return value === 'base' || value === 'extended';
}

// One lock.json entry is shape-checked through parseLockEntry (below) against
// the LockEntry contract in types.ts. Shared by the inventory (G04.04.a) and
// the download activation (G04.02.a) so the shape rules cannot drift apart
// (implementation-rules 3, 8).
export function parseLockEntry(
  entry: unknown,
  at: string,
): { ok: true; entry: LockEntry } | { ok: false; diagnostic: string } {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, diagnostic: `${at}#type` };
  }
  const record = entry as Record<string, unknown>;
  if (typeof record.path !== 'string') return { ok: false, diagnostic: `${at}.path#type` };
  if (typeof record.bytes !== 'number' || !Number.isInteger(record.bytes) || record.bytes < 0) {
    return { ok: false, diagnostic: `${at}.bytes#type` };
  }
  if (typeof record.sha256 !== 'string') return { ok: false, diagnostic: `${at}.sha256#type` };
  if (!isSafeRel(record.path)) return { ok: false, diagnostic: `${at}#unsafe-path:${record.path}` };
  return { ok: true, entry: { path: record.path, bytes: record.bytes, sha256: record.sha256 } };
}

// Catalog versions are digit strings (catalog.schema.json pattern ^[0-9]+$, up
// to 64 digits — beyond Number.MAX_SAFE_INTEGER), so ordering goes through
// BigInt. A non-numeric disk version cannot be ordered against the catalog
// and is never marked stale.
function isNewerVersion(advertised: string, onDisk: string): boolean {
  return /^[0-9]+$/.test(advertised) && /^[0-9]+$/.test(onDisk) &&
    BigInt(advertised) > BigInt(onDisk);
}

function compareVersions(a: string, b: string): number {
  if (/^[0-9]+$/.test(a) && /^[0-9]+$/.test(b)) {
    const left = BigInt(a);
    const right = BigInt(b);
    if (left !== right) return left < right ? -1 : 1;
  }
  return a.localeCompare(b);
}

interface CatalogRow {
  routeId: string;
  version: string;
  locales: string[];
  layers: Tier[];
}

// The catalog cache arrives as the parsed catalog.json envelope
// (catalog.schema.json: {catalog_schema_version, routes, …}). The inventory
// diagnoses, it does not validate — schema enforcement is the reader's
// (contracts/reader.mjs); every fault becomes a diagnostic and usable entries
// still produce rows.
function parseCatalog(catalog: unknown): { rows: CatalogRow[]; diagnostics: string[] } {
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return { rows: [], diagnostics: ['catalog#type'] };
  }
  const routes = (catalog as { routes?: unknown }).routes;
  if (!Array.isArray(routes)) return { rows: [], diagnostics: ['catalog.routes#type'] };
  const diagnostics: string[] = [];
  const rows: CatalogRow[] = [];
  routes.forEach((entry, index) => {
    const at = `catalog.routes[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      diagnostics.push(`${at}#type`);
      return;
    }
    const record = entry as Record<string, unknown>;
    const routeId = record.route_id;
    if (typeof routeId !== 'string') {
      diagnostics.push(`${at}.route_id#type`);
      return;
    }
    // An unsafe route_id is never probed on the filesystem: the entry is
    // skipped as a whole (implementation-rules 14 — checked on input).
    if (!isSafeSegment(routeId)) {
      diagnostics.push(`${at}.route_id#unsafe-path:${routeId}`);
      return;
    }
    const version = record.version;
    if (typeof version !== 'string') {
      diagnostics.push(`${at}.version#type`);
      return;
    }
    if (!isSafeSegment(version)) {
      diagnostics.push(`${at}.version#unsafe-path:${version}`);
      return;
    }
    if (!Array.isArray(record.locales)) {
      diagnostics.push(`${at}.locales#type`);
      return;
    }
    if (!Array.isArray(record.layers)) {
      diagnostics.push(`${at}.layers#type`);
      return;
    }
    const locales: string[] = [];
    record.locales.forEach((locale, localeIndex) => {
      if (isSafeSegment(locale)) locales.push(locale);
      else diagnostics.push(`${at}.locales[${localeIndex}]#type`);
    });
    const layers: Tier[] = [];
    record.layers.forEach((layer, layerIndex) => {
      if (isTier(layer)) layers.push(layer);
      else diagnostics.push(`${at}.layers[${layerIndex}]#type`);
    });
    if (locales.length > 0 && layers.length > 0) rows.push({ routeId, version, locales, layers });
  });
  return { rows, diagnostics };
}

// Facts of one layer directory: lock.json entries versus disk presence and
// sizes. A file at the wrong size fails the level-2 metadata check (09 §4 —
// presence and size from lock.json) and counts toward missing with the
// contradiction as a diagnostic; a plain absent file is the expected partial
// state, not a diagnostic.
interface LayerFacts {
  state: 'partial' | 'ready';
  missingCount: number | null;
  declaredBytes: number | null;
  onDiskBytes: number | null;
  diagnostics: string[];
}

const UNVERIFIABLE: LayerFacts = {
  state: 'partial',
  missingCount: null,
  declaredBytes: null,
  onDiskBytes: null,
  diagnostics: [],
};

async function readLayerFacts(store: BundlesStore, layerRel: string): Promise<LayerFacts> {
  const lock = await store.readFile(`${layerRel}/lock.json`);
  if (lock.kind !== 'present') {
    // A layer directory without a readable lock cannot be verified: partial
    // with an unknowable count (criterion 4 — diagnosed, never thrown).
    return {
      ...UNVERIFIABLE,
      diagnostics: [`lock.json#${lock.kind === 'absent' ? 'missing-file' : 'unreadable'}`],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(lock.bytes));
  } catch {
    return { ...UNVERIFIABLE, diagnostics: ['lock.json#invalid-json'] };
  }
  if (!Array.isArray(parsed)) return { ...UNVERIFIABLE, diagnostics: ['lock.json#type'] };

  const diagnostics: string[] = [];
  let declaredBytes = 0;
  let onDiskBytes = 0;
  let missing = 0;
  for (const [index, entry] of parsed.entries()) {
    const at = `lock.json[${index}]`;
    const checked = parseLockEntry(entry, at);
    if (!checked.ok) {
      diagnostics.push(checked.diagnostic);
      missing += 1;
      continue;
    }
    const record = checked.entry;
    declaredBytes += record.bytes;
    const size = await store.statSize(`${layerRel}/${record.path}`);
    if (size === null || size !== record.bytes) {
      missing += 1;
      if (size !== null) diagnostics.push(`${at}#size-mismatch`);
      continue;
    }
    onDiskBytes += size;
  }
  return {
    state: missing === 0 ? 'ready' : 'partial',
    missingCount: missing,
    declaredBytes,
    onDiskBytes,
    diagnostics,
  };
}

// Deterministic listing order (route, version numerically when both are digit
// strings, locale, tier): the same disk state always yields the same output.
function sortEntries(entries: InventoryEntry[]): void {
  entries.sort((a, b) =>
    a.routeId.localeCompare(b.routeId) ||
    compareVersions(a.version, b.version) ||
    a.locale.localeCompare(b.locale) ||
    a.tier.localeCompare(b.tier));
}

/**
 * Build the library inventory from the parsed catalog cache and the device
 * bundles tree. Every version directory on disk is listed — older versions
 * surface as stale instead of vanishing — and catalog rows with no layer on
 * disk are listed as not_downloaded. Corrupt catalog or lock input is
 * diagnosed in the result, never thrown (criterion 4).
 */
export async function inventoryPackages(
  store: BundlesStore,
  input: { catalog: unknown },
): Promise<InventoryResult> {
  const { rows: catalogRows, diagnostics } = parseCatalog(input.catalog);
  const advertised = new Map<string, string>();
  for (const row of catalogRows) {
    const known = advertised.get(row.routeId);
    if (known === undefined || isNewerVersion(row.version, known)) {
      advertised.set(row.routeId, row.version);
    }
  }

  const entries: InventoryEntry[] = [];
  const seen = new Set<string>();

  // Disk walk. 'staging' beside the final layout belongs to the download
  // pipeline (G04.02) and is not a version: skipped.
  for (const routeId of (await store.listDir('bundles')) ?? []) {
    for (const version of (await store.listDir(`bundles/${routeId}`)) ?? []) {
      if (version === 'staging') continue;
      for (const locale of (await store.listDir(`bundles/${routeId}/${version}`)) ?? []) {
        for (const tier of (await store.listDir(`bundles/${routeId}/${version}/${locale}`)) ?? []) {
          const layerRel = `bundles/${routeId}/${version}/${locale}/${tier}`;
          if (!isTier(tier)) {
            diagnostics.push(`${layerRel}#type`);
            continue;
          }
          const facts = await readLayerFacts(store, layerRel);
          const stale = facts.state === 'ready' && isNewerVersion(advertised.get(routeId) ?? '', version);
          seen.add(`${routeId}/${version}/${locale}/${tier}`);
          entries.push({
            routeId,
            version,
            locale,
            tier,
            state: stale ? 'stale' : facts.state,
            missingCount: facts.missingCount,
            bytes: { declared: facts.declaredBytes, onDisk: facts.onDiskBytes },
            diagnostics: facts.diagnostics,
          });
        }
      }
    }
  }

  for (const row of catalogRows) {
    for (const locale of row.locales) {
      for (const tier of row.layers) {
        if (seen.has(`${row.routeId}/${row.version}/${locale}/${tier}`)) continue;
        entries.push({
          routeId: row.routeId,
          version: row.version,
          locale,
          tier,
          state: 'not_downloaded',
          missingCount: null,
          bytes: { declared: null, onDisk: null },
          diagnostics: [],
        });
      }
    }
  }

  sortEntries(entries);
  return { entries, diagnostics };
}
