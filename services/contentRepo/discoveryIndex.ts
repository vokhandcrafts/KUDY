// G15.03 (issue #70) — the city discovery index through ContentRepo (21 §2:
// services/contentRepo owns the verified index and the derived readiness).
// One load: the catalog envelope's `discovery_index` pointer → fetch from the
// configured origin through the loader port (the declared size is checked
// before loading — 21 §3.2, and the envelope projection already drops an
// oversized pointer) → sha256+bytes pin (the same idiom as the catalog
// service's loadIndex) → shape validation with the §3.2 count limits active
// on input → atomic whole-file replacement of the derived snapshot.
//
// Reader policy (21 §3.3): a fault never destroys the last valid snapshot —
// any case where the current catalog cannot name a verifiable index (offline,
// corrupt catalog, legacy catalog, hash mismatch, unsupported schema, corrupt
// index) falls back to the snapshot and reports `stale`; without a snapshot
// the honest unavailable state renders the normal city page without
// discovery. The snapshot is the derived cache (zone A): it never holds user
// data and is always safe to delete.
import { readCatalogEnvelope } from '../catalog/envelope.ts';
import type { CatalogPathLoader } from '../catalog/types.ts';
import type { DiscoveryIndexV1 } from '../../core/discovery/selectDiscovery.ts';
import { isSafeRel } from '../safe-path.ts';
import type { Sha256 } from './types.ts';

// The derived snapshot store (zone A). The atomicity contract the adapter
// owes: write replaces the whole snapshot in one step or fails leaving the
// previous bytes intact — a torn write must never surface as a half index.
export interface DiscoverySnapshotStore {
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
}

export interface DiscoveryIndexDeps {
  loader: CatalogPathLoader;
  sha256: Sha256;
  snapshot: DiscoverySnapshotStore;
}

// ready carries the validated index; `stale` marks the fallback path — the
// snapshot answered because the fresh read faulted (the reason names the
// fault, 21 §3.3 «бачны банэр»). unavailable is the no-discovery state.
export type DiscoveryIndexState =
  | {
      readonly kind: 'ready';
      readonly index: DiscoveryIndexV1;
      readonly revision: string;
      readonly stale: boolean;
      readonly reason: string | null;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

const CATALOG_PATH = 'catalog.json';

// §3.2 count limits, active on input (G01.06 fixed them; G15.01/G15.03 count
// them active). String-length limits stay publication's schema verdict: the
// selector fail-closes per offer and the file is already capped at 512 KiB by
// the pointer's size check.
const MAX_THEMES = 32;
const MAX_OFFERS = 64;
const MAX_COLLECTIONS = 32;
const MAX_MEMBERS = 50;

// 21 §3.2 identifiers and revision: ≤ 64 chars of [a-z0-9._-].
const SAFE_ID = /^[a-z0-9._-]{1,64}$/;

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const ACCESS_VALUES = ['free', 'paid', 'mixed'];

// A non-empty localized map (21 §3.2 LocalizedText): at least one published
// string — the display pick falls back to "any published text", which needs
// one to exist.
function isLocalizedText(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const texts = Object.values(value);
  return texts.length > 0 && texts.every((text) => typeof text === 'string' && text.length > 0);
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function isNonEmptyBounded(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

// The ref kinds the contract names (21 §3.2): the kind's own id is a SAFE_ID
// (it interpolates into surface hrefs), the version pair is a bounded string
// (disk paths re-check it through isSafeSegment at the download boundary).
function isOfferRef(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  if (ref.kind === 'guide') return isSafeId(ref.route_id) && isNonEmptyBounded(ref.version);
  if (ref.kind === 'place') return isSafeId(ref.place_id) && isNonEmptyBounded(ref.content_version);
  if (ref.kind === 'collection') return isSafeId(ref.collection_id) && isNonEmptyBounded(ref.content_version);
  return false;
}

// The element shapes the surfaces read directly (localized pick, badges,
// locale lines, control derivation): a pin-valid index with a corrupt element
// answers with a named rule here instead of throwing in a render or in the
// fire-and-forget boot (implementation-rules 14 — diagnostics, never a
// crash). Fields the selector fail-closes on per offer stay the selector's
// own gate (G15.01).
function isOfferShape(offer: unknown): boolean {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) return false;
  const o = offer as Record<string, unknown>;
  if (!isSafeId(o.offer_id) || !isOfferRef(o.ref)) return false;
  if (typeof o.city_id !== 'string' || o.city_id.length === 0) return false;
  if (typeof o.editorial_order !== 'number' || !Number.isFinite(o.editorial_order)) return false;
  if (!Array.isArray(o.themes) || !o.themes.every((theme) => typeof theme === 'string')) return false;
  if (!Array.isArray(o.season_recommendations)) return false;
  for (const recommendation of o.season_recommendations) {
    if (!recommendation || typeof recommendation !== 'object' || Array.isArray(recommendation)) return false;
    const rec = recommendation as Record<string, unknown>;
    if (typeof rec.season !== 'string' || !SEASONS.includes(rec.season)) return false;
    if (!isLocalizedText(rec.reason)) return false;
  }
  if (!o.localized || typeof o.localized !== 'object' || Array.isArray(o.localized)) return false;
  if (!isLocalizedText((o.localized as Record<string, unknown>).title)) return false;
  if (!o.availability || typeof o.availability !== 'object' || Array.isArray(o.availability)) return false;
  const availability = o.availability as Record<string, unknown>;
  if (!Array.isArray(availability.text_locales) || !availability.text_locales.every((l) => typeof l === 'string')) {
    return false;
  }
  if (!Array.isArray(availability.audio_locales) || !availability.audio_locales.every((l) => typeof l === 'string')) {
    return false;
  }
  return ACCESS_VALUES.includes(o.access as string);
}

function isThemeShape(theme: unknown): boolean {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return false;
  const t = theme as Record<string, unknown>;
  return isSafeId(t.id) && isLocalizedText(t.labels);
}

function validateIndex(doc: unknown): { ok: true; index: DiscoveryIndexV1 } | { ok: false; rule: string } {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, rule: 'index-type' };
  const v = doc as Record<string, unknown>;
  // Unknown major versions are not interpreted (21 §3.2) — the same
  // unsupported rule answers for a missing or wrong schema_version.
  if (v.schema_version !== 1) return { ok: false, rule: 'index-unsupported' };
  if (typeof v.revision !== 'string' || !SAFE_ID.test(v.revision)) return { ok: false, rule: 'index-revision' };
  if (typeof v.city_id !== 'string' || v.city_id.length === 0) return { ok: false, rule: 'index-city' };
  if (!Array.isArray(v.themes) || v.themes.length > MAX_THEMES) return { ok: false, rule: 'index-themes' };
  for (const theme of v.themes) {
    if (!isThemeShape(theme)) return { ok: false, rule: 'index-theme-shape' };
  }
  if (!Array.isArray(v.offers) || v.offers.length > MAX_OFFERS) return { ok: false, rule: 'index-offers-limit' };
  for (const offer of v.offers) {
    if (!isOfferShape(offer)) return { ok: false, rule: 'index-offer-shape' };
  }
  if (!Array.isArray(v.collections) || v.collections.length > MAX_COLLECTIONS) {
    return { ok: false, rule: 'index-collections-limit' };
  }
  for (const collection of v.collections) {
    if (!collection || typeof collection !== 'object' || Array.isArray(collection)) {
      return { ok: false, rule: 'index-collection-type' };
    }
    if (!isSafeId((collection as Record<string, unknown>).collection_id)) {
      return { ok: false, rule: 'index-collection-shape' };
    }
    const members = (collection as { members?: unknown }).members;
    if (!Array.isArray(members) || members.length > MAX_MEMBERS) {
      return { ok: false, rule: 'index-members-limit' };
    }
    // Members are guide/place refs only (21 §3.2) — a nested collection ref
    // is a schema fault, not a deeper grouping.
    for (const member of members) {
      const kind = (member as { kind?: unknown } | null)?.kind;
      if (kind !== 'guide' && kind !== 'place') return { ok: false, rule: 'index-member-kind' };
    }
  }
  return { ok: true, index: v as unknown as DiscoveryIndexV1 };
}

// One shape validation for both sources: the fetched bytes and the snapshot
// bytes pass the same gate, so a cached snapshot can never answer with a
// shape the fresh path would reject.
function parseIndex(bytes: Uint8Array): { ok: true; index: DiscoveryIndexV1 } | { ok: false; rule: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, rule: 'index-json-corrupt' };
  }
  return validateIndex(doc);
}

async function loadFresh(
  deps: DiscoveryIndexDeps,
): Promise<{ ok: true; bytes: Uint8Array; index: DiscoveryIndexV1 } | { ok: false; reason: string }> {
  let envelopeText: string;
  try {
    envelopeText = await deps.loader(CATALOG_PATH);
  } catch {
    return { ok: false, reason: 'catalog-unavailable' };
  }
  let pointer: ReturnType<typeof readCatalogEnvelope>['discovery_index'];
  try {
    pointer = readCatalogEnvelope(JSON.parse(envelopeText)).discovery_index;
  } catch {
    return { ok: false, reason: 'catalog-corrupt' };
  }
  // A catalog without a usable pointer cannot name an index: legacy envelope,
  // unknown major version, malformed or oversized pointer — the snapshot
  // answers, or the city page stays without discovery (21 §3.3).
  if (!pointer) return { ok: false, reason: 'discovery-not-published' };
  if (!isSafeRel(pointer.path)) return { ok: false, reason: 'index-path-unsafe' };
  let text: string;
  try {
    text = await deps.loader(pointer.path);
  } catch {
    return { ok: false, reason: 'index-fetch-failed' };
  }
  // Integrity pin (21 §3.3): the fetched bytes must match the pointer's
  // declared sha256 and size before anything is parsed or cached.
  const bytes = new TextEncoder().encode(text);
  const digest = await deps.sha256(bytes);
  if (digest !== pointer.sha256 || bytes.byteLength !== pointer.bytes) {
    return { ok: false, reason: 'index-pin-mismatch' };
  }
  const parsed = parseIndex(bytes);
  if (!parsed.ok) return { ok: false, reason: parsed.rule };
  return { ok: true, bytes, index: parsed.index };
}

export async function loadDiscoveryIndex(deps: DiscoveryIndexDeps): Promise<DiscoveryIndexState> {
  const fresh = await loadFresh(deps);
  if (fresh.ok) {
    // Best-effort cache (zone A): a failed write leaves the previous
    // snapshot bytes intact (the port's atomicity contract) and never
    // blocks a freshly verified index.
    try {
      await deps.snapshot.write(fresh.bytes);
    } catch {
      // The snapshot is re-creatable derived data; serving the fresh index
      // does not depend on the cache write succeeding.
    }
    return { kind: 'ready', index: fresh.index, revision: fresh.index.revision, stale: false, reason: null };
  }
  let cached: Uint8Array | null = null;
  try {
    cached = await deps.snapshot.read();
  } catch {
    cached = null;
  }
  if (cached === null) return { kind: 'unavailable', reason: fresh.reason };
  const parsed = parseIndex(cached);
  if (!parsed.ok) return { kind: 'unavailable', reason: `snapshot-${parsed.rule}` };
  return {
    kind: 'ready',
    index: parsed.index,
    revision: parsed.index.revision,
    stale: true,
    reason: fresh.reason,
  };
}
