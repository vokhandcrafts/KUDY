// G04.03 — services/contentRepo: read verified guide packages and derive
// availability (18_component_blueprint §services: "ключ пакета → валідны
// кантэнт / недаступнасць"). Disk facts are the source of truth for local
// readiness (ADR G01.03 §3.2); the module never issues AccessReady and never
// decides purchases. Non-goals: the download pipeline (G04.02), SQLite
// migrations (G04.01), the run engine (G05), UI screens (G06).

import type {
  DiscoveryCache,
  DiscoveryLookup,
  EvaluateInput,
  FileFacts,
  PackageStore,
  Readiness,
  RouteAccess,
  Tier,
} from './types.ts';

interface RouteStop {
  id?: string;
  access_tier?: string;
  place_id?: string;
}

interface RouteDoc {
  route_id?: string;
  version?: string;
  access?: string;
  stops?: unknown;
}

// Files Start always needs, plus the per-layer set the walk reads. The
// discovery index, collections and public projections are deliberately absent:
// a missing index must not break the guide (G04.03 criterion 5), and the run
// engine reads projections through its own readers.
const ROOT_FILES = ['route.json', 'places.json', 'voices.json'] as const;

function layerStopsPath(locale: string, tier: Tier): string {
  return `${locale}/${tier}/stops.json`;
}

async function readJson(store: PackageStore, rel: string): Promise<{ ok: true; doc: unknown } | { ok: false; rule: string }> {
  let facts: FileFacts;
  try {
    facts = await store.readFile(rel);
  } catch {
    return { ok: false, rule: 'unreadable' };
  }
  if (facts.kind === 'absent') return { ok: false, rule: 'missing-file' };
  if (facts.kind === 'unreadable') return { ok: false, rule: 'unreadable' };
  try {
    return { ok: true, doc: JSON.parse(new TextDecoder().decode(facts.bytes)) };
  } catch {
    return { ok: false, rule: 'invalid-json' };
  }
}

// A layer ships audio when its audio/ directory exists (09 §3 via the
// validate-package rule: shipping an empty audio directory still counts as
// shipping audio — text-only is declared by the directory's absence).
async function layerShipsAudio(store: PackageStore, locale: string, tier: Tier): Promise<boolean> {
  return store.exists(`${locale}/${tier}/audio`);
}

// Start needs the requested tier; an extended start walks the whole route, so
// the base layer must be complete too (ADR G01.03 §3.4: session tier records
// the layers verified before start).
function neededLayers(tier: Tier): Tier[] {
  return tier === 'base' ? ['base'] : ['base', 'extended'];
}

function asStoryList(doc: unknown): Array<{ story_id?: string; voice_id?: string }> {
  if (!Array.isArray(doc)) return [];
  return doc.filter((item): item is { story_id?: string; voice_id?: string } =>
    item !== null && typeof item === 'object');
}

// ids of array entries that carry a string `id` (voices, places).
function asIdList(doc: unknown): string[] {
  if (!Array.isArray(doc)) return [];
  return doc
    .filter((item): item is { id: string } => item !== null && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
    .map((item) => item.id);
}

/**
 * Evaluate the readiness card for a selected package.
 *
 * Returns ready/incomplete/needs-recovery/access-locked; never throws —
 * every storage fault becomes a state the UI can show (implementation-rules:
 * a damaged package is a diagnosed condition, not a crash).
 */
export async function evaluatePackage(store: PackageStore, input: EvaluateInput): Promise<Readiness> {
  const missing: string[] = [];

  const route = await readJson(store, 'route.json');
  if (!route.ok) {
    missing.push(`route.json#${route.rule}`);
    return { status: 'incomplete', missing };
  }
  const routeDoc = route.doc as RouteDoc;
  if (routeDoc.route_id !== store.key.routeId || routeDoc.version !== store.key.version) {
    return { status: 'incomplete', missing: ['route.json#identity-mismatch'] };
  }
  const access: RouteAccess | null = routeDoc.access === 'free' || routeDoc.access === 'paid' ? routeDoc.access : null;
  if (access === null) return { status: 'incomplete', missing: ['route.json#type'] };

  const stops = Array.isArray(routeDoc.stops) ? (routeDoc.stops as RouteStop[]) : [];
  // stops is required by contracts/schemas/route.schema.json — absent and
  // non-array are the same schema fault (!Array.isArray covers both), and an
  // empty default would let a broken package read as ready.
  if (!Array.isArray(routeDoc.stops)) missing.push('route.json#type');
  for (const rel of ROOT_FILES) {
    if (rel === 'route.json') continue;
    const file = await readJson(store, rel);
    if (!file.ok) missing.push(`${rel}#${file.rule}`);
  }

  const layers = neededLayers(input.tier);
  const layerStories = new Map<Tier, Array<{ story_id?: string; voice_id?: string }>>();
  const voiceIds = new Set<string>();
  const placeIds = new Set<string>();

  // Reference checks only run against a successfully parsed source: a broken
  // file already carries its own diagnostic, and ref checks against an empty
  // id set would only muddle the report (validate-package precedent).
  const voices = await readJson(store, 'voices.json');
  const voicesOk = voices.ok && Array.isArray(voices.doc);
  if (voices.ok && !Array.isArray(voices.doc)) missing.push('voices.json#type');
  if (voicesOk) for (const voice of asIdList(voices.doc)) voiceIds.add(voice);

  const places = await readJson(store, 'places.json');
  const placesOk = places.ok && Array.isArray(places.doc);
  if (places.ok && !Array.isArray(places.doc)) missing.push('places.json#type');
  if (placesOk) for (const id of asIdList(places.doc)) placeIds.add(id);

  for (const tier of layers) {
    const stopsPath = layerStopsPath(input.locale, tier);
    const layer = await readJson(store, stopsPath);
    if (!layer.ok) {
      missing.push(`${stopsPath}#${layer.rule}`);
      continue;
    }
    const stories = asStoryList(layer.doc);
    layerStories.set(tier, stories);
    for (const story of stories) {
      // story_id is a file name, not a path: separators and traversal pieces
      // are a packaging fault in the validator's rule vocabulary, never a
      // lookup. Checked in the structural pass so every parsed layer is
      // covered, text-only ones included.
      if (typeof story.story_id === 'string' && /[/\\]|\.\./.test(story.story_id)) {
        missing.push(`${stopsPath}#unsafe-path:${story.story_id}`);
      }
      if (typeof story.voice_id === 'string' && !voiceIds.has(story.voice_id)) {
        missing.push(`voices.json#unknown-ref:${story.voice_id}`);
      }
    }
    for (const stop of stops) {
      if (stop.access_tier !== tier) continue;
      if (typeof stop.place_id === 'string' && !placeIds.has(stop.place_id)) {
        missing.push(`places.json#unknown-ref:${stop.place_id}`);
      }
    }
  }
  if (missing.length > 0) return { status: 'incomplete', missing };

  // Media pass: only layers that ship audio declare media requirements, and a
  // free start never inspects locked layers (criterion 2).
  const media: string[] = [];
  for (const tier of layers) {
    if (!(await layerShipsAudio(store, input.locale, tier))) continue;
    for (const story of layerStories.get(tier) ?? []) {
      if (typeof story.story_id !== 'string') continue;
      const rel = `${input.locale}/${tier}/audio/${story.story_id}.m4a`;
      let facts: FileFacts;
      try {
        facts = await store.readFile(rel);
      } catch {
        facts = { kind: 'unreadable' };
      }
      if (facts.kind !== 'present' || facts.bytes.length === 0) media.push(rel);
    }
  }
  if (media.length > 0) return { status: 'needs-recovery', media };

  // Access gate last (documented precedence): paid extended content needs the
  // granted tier; the grant itself stays services/download's to issue.
  const granted = input.grantedTiers ?? [];
  const tierAvailable = layers.filter((tier) => tier === 'base' || access === 'free' || granted.includes(tier));
  if (!tierAvailable.includes(input.tier)) return { status: 'access-locked', tier: input.tier };

  return { status: 'ready', routeId: store.key.routeId, version: store.key.version, tier: input.tier, tierAvailable };
}

/**
 * Criterion 5 — a read-through cache for the package's discovery.json.
 * Faults are values, not errors: an absent or invalid index reads as nulls
 * and the guide stays startable. The cache never consults access state, so
 * its hits and misses are independent of AccessReady.
 */
export function createDiscoveryCache(): DiscoveryCache {
  const cache = new Map<string, DiscoveryLookup>();
  return {
    async read(store: PackageStore): Promise<DiscoveryLookup> {
      const cacheKey = `${store.key.routeId}@${store.key.version}`;
      const cached = cache.get(cacheKey);
      if (cached) return { ...cached, fromCache: true };
      const file = await readJson(store, 'discovery.json');
      const lookup: DiscoveryLookup = file.ok && file.doc !== null && typeof file.doc === 'object' &&
          typeof (file.doc as { revision?: unknown }).revision === 'string'
        ? { revision: (file.doc as { revision: string }).revision, index: file.doc as Record<string, unknown>, fromCache: false }
        : { revision: null, index: null, fromCache: false };
      if (lookup.index !== null) cache.set(cacheKey, lookup);
      return lookup;
    },
  };
}
