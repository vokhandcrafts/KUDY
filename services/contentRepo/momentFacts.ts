// G07.02 (issue #282) — the moment teaser facts of the downloaded library:
// one reader over the packages' root moments.json manifests (09 §3: Moment —
// id, place_id, story_id (usually the teaser), kind, cooldown_min; the
// manifest is optional per G03.04 — a package without it simply offers no
// teasers). The place detail (app/place/[id]) filters the result by its
// place_id; the teaser audio path resolves against the same package's base
// layer with the same <locale>/<tier>/audio/<story_id>.m4a idiom the engine's
// PlayStory path uses (core/engine/reducer.ts) — a full store-relative path,
// because the idle launch is cross-route (the single player may serve any
// downloaded package).
//
// G22.02 (issue #607): the teaser audio resolves through the dedicated
// TeaserAudioProbe (the required options.audioProbe) — a readable, nonempty
// regular file — never by reading the .m4a body through the store. A false
// probe answer falls to the next preferred locale; a missing probe is the
// named configuration error below, never a permission to full-read.
//
// G22.05 (issue #610): the optional options.placeId scopes the call to one
// place — the validated manifests are still read to find matches (manifest
// reads are the discovery cost), but audio and text resolve only for the
// matching moments, and one stops.json is read and parsed at most once per
// package and locale within the call. The cache lives only inside the
// invocation: the next open sees a changed package or UI language. A missing
// scope keeps the general-reader mode for the existing consumers.
//
// A damaged manifest or a damaged stops.json never blocks the other packages
// — the reader collects named diagnostics and keeps reading (rule 14:
// corrupt input answers with diagnostics, never a throw). Identifiers that
// reach the filesystem are checked as safe segments on input (09 §7); a
// story_id from the manifest is untrusted content, an unsafe one yields a
// null audio path with a diagnostic, never a path.
import type { BundlesStore, TeaserAudioProbe } from './types.ts';
import { isSafeSegment } from '../safe-path.ts';

export interface MomentFact {
  readonly momentId: string;
  readonly placeId: string;
  readonly storyId: string;
  readonly kind: string;
  readonly cooldownMin: number;
  // The package the manifest was read from — the teaser card's guide link
  // leads to this route's preview (never Start).
  readonly routeId: string;
  readonly version: string;
  // Full store-relative path of the teaser audio in the first preferred
  // locale that has the file (base tier); null = no published audio for the
  // preferred locales — the card renders without Play, never a fake path.
  readonly audioPath: string | null;
  // The teaser story's text from the same layer's stops.json; null when the
  // story record is absent or carries no text.
  readonly teaserText: string | null;
}

export type MomentFacts =
  | { ok: true; moments: ReadonlyArray<MomentFact>; diagnostics: ReadonlyArray<string> }
  | {
      ok: false;
      diagnostic:
        | 'moment-facts#list-failed'
        | 'moment-facts#probe-missing'
        // G22.05: a supplied placeId that is empty or not a string — refused
        // before any store or probe call.
        | 'moment-facts#place-id-invalid';
    };

interface RawMoment {
  momentId: string;
  placeId: string;
  storyId: string;
  kind: string;
  cooldownMin: number;
}

export async function readMomentFacts(
  store: BundlesStore,
  options: {
    readonly locales: readonly string[];
    // Required (G22.02): teaser audio resolves only through the dedicated
    // probe — a composition without one is a configuration error, never a
    // permission to read the full media body.
    readonly audioProbe: TeaserAudioProbe;
    // G22.05 (issue #610): optional place scope — supplied, only this
    // place's moments resolve media and text. Missing keeps the
    // general-reader mode of the existing consumers.
    readonly placeId?: string;
  },
): Promise<MomentFacts> {
  if (typeof options.audioProbe !== 'function') {
    // The named refusal answers before the first store call: a probe-less
    // composition never reaches the library, let alone a full media read.
    return { ok: false, diagnostic: 'moment-facts#probe-missing' };
  }
  if (options.placeId !== undefined && (typeof options.placeId !== 'string' || options.placeId.length === 0)) {
    // The same pre-store refusal shape (G22.05): a malformed scope never
    // reaches the library or the probe.
    return { ok: false, diagnostic: 'moment-facts#place-id-invalid' };
  }
  let routeIds: string[] | null;
  try {
    routeIds = await store.listDir('bundles');
  } catch {
    return { ok: false, diagnostic: 'moment-facts#list-failed' };
  }
  if (routeIds === null) return { ok: true, moments: [], diagnostics: [] };
  const moments: MomentFact[] = [];
  const diagnostics: string[] = [];
  // One stops.json read+parse per package and locale per invocation (G22.05):
  // the parsed document (or the 'skip' verdict for an absent, unreadable or
  // shape-faulted file) is memoized under its store path — the next moment of
  // the same package reuses it. The map is created per call, so the next open
  // re-reads a changed package or locale (no cross-call cache).
  const stopsDocs = new Map<string, Promise<StopsDoc>>();
  for (const routeId of routeIds) {
    // 'staging' beside the final layout belongs to the download flow — not a
    // version (the library inventory's same skip).
    if (routeId === 'staging') continue;
    let versions: string[] | null;
    try {
      versions = await store.listDir(`bundles/${routeId}`);
    } catch {
      diagnostics.push(`moment-facts#list-failed:${routeId}`);
      continue;
    }
    if (versions === null) continue;
    for (const version of versions) {
      if (version === 'staging') continue;
      const packageRoot = `bundles/${routeId}/${version}`;
      const raw = await readManifest(store, packageRoot, diagnostics);
      // G22.05: the place scope filters the validated manifest entries
      // BEFORE any media resolution — non-matching moments cost a manifest
      // read only, never a probe call or a stops.json read.
      const matching =
        options.placeId === undefined ? raw : raw.filter((entry) => entry.placeId === options.placeId);
      for (const moment of matching) {
        const audioPath = await resolveAudioPath(options.audioProbe, packageRoot, moment.storyId, options.locales, diagnostics);
        const teaserText = await readTeaserText(store, packageRoot, moment.storyId, options.locales, stopsDocs);
        moments.push({ ...moment, routeId, version, audioPath, teaserText });
      }
    }
  }
  return { ok: true, moments, diagnostics };
}

async function readManifest(
  store: BundlesStore,
  packageRoot: string,
  diagnostics: string[],
): Promise<ReadonlyArray<RawMoment>> {
  const file = await store.readFile(`${packageRoot}/moments.json`);
  if (file.kind === 'absent') return [];
  if (file.kind === 'unreadable') {
    diagnostics.push(`moment-facts#manifest-unreadable:${packageRoot}`);
    return [];
  }
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(file.bytes));
  } catch {
    diagnostics.push(`moment-facts#manifest-invalid:${packageRoot}`);
    return [];
  }
  if (!Array.isArray(doc)) {
    diagnostics.push(`moment-facts#manifest-invalid:${packageRoot}`);
    return [];
  }
  const parsed: RawMoment[] = [];
  for (const entry of doc) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      diagnostics.push(`moment-facts#entry-invalid:${packageRoot}`);
      continue;
    }
    const record = entry as Record<string, unknown>;
    const momentId = record.id;
    const placeId = record.place_id;
    const storyId = record.story_id;
    const kind = record.kind;
    const cooldownMin = record.cooldown_min;
    if (
      typeof momentId !== 'string' || momentId.length === 0 ||
      typeof placeId !== 'string' || placeId.length === 0 ||
      typeof storyId !== 'string' || storyId.length === 0 ||
      typeof kind !== 'string' || kind.length === 0 ||
      typeof cooldownMin !== 'number' || !Number.isFinite(cooldownMin) || cooldownMin < 0
    ) {
      diagnostics.push(`moment-facts#entry-invalid:${packageRoot}`);
      continue;
    }
    parsed.push({ momentId, placeId, storyId, kind, cooldownMin });
  }
  return parsed;
}

// The teaser audio path in the first preferred locale whose base-layer file
// the probe answers playable: a readable, nonempty regular file (G22.02) —
// never a full media read. A false answer (absent, directory, empty,
// unreadable, metadata fault) falls to the next locale without a diagnostic:
// an absent teaser audio is the honest card-without-Play, not a library
// fault. The story id comes from the manifest (untrusted content): an unsafe
// one yields null with a diagnostic, never a path.
async function resolveAudioPath(
  audioProbe: TeaserAudioProbe,
  packageRoot: string,
  storyId: string,
  locales: readonly string[],
  diagnostics: string[],
): Promise<string | null> {
  if (!isSafeSegment(storyId)) {
    diagnostics.push(`moment-facts#unsafe-story-id:${packageRoot}`);
    return null;
  }
  for (const locale of locales) {
    if (!isSafeSegment(locale)) continue;
    const path = `${packageRoot}/${locale}/base/audio/${storyId}.m4a`;
    if (await audioProbe(path)) return path;
  }
  return null;
}

// The teaser story's text from the package's stops.json (the same layer the
// audio resolves in). A missing or damaged stops.json yields null — the card
// renders its label only, never invented text. G22.05: the parsed document
// is memoized in the call-scoped stopsDocs map under its store path, so
// several moments of one package share a single read+parse per locale; the
// per-locale preference order and the fall-through semantics are unchanged.
async function readTeaserText(
  store: BundlesStore,
  packageRoot: string,
  storyId: string,
  locales: readonly string[],
  stopsDocs: Map<string, Promise<StopsDoc>>,
): Promise<string | null> {
  for (const locale of locales) {
    if (!isSafeSegment(locale)) continue;
    const path = `${packageRoot}/${locale}/base/stops.json`;
    let doc = stopsDocs.get(path);
    if (doc === undefined) {
      doc = readStopsDoc(store, path);
      stopsDocs.set(path, doc);
    }
    const parsed = await doc;
    if (parsed === 'skip') continue;
    for (const entry of parsed) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (record.story_id !== storyId) continue;
      const text = record.text;
      return typeof text === 'string' && text.length > 0 ? text : null;
    }
  }
  return null;
}

// One stops.json fetch+parse of the teaser-text read. 'skip' marks every
// outcome the reader falls past — absent, unreadable, unparseable or a
// non-array document — the same locales the direct read would skip.
type StopsDoc = ReadonlyArray<unknown> | 'skip';

async function readStopsDoc(store: BundlesStore, path: string): Promise<StopsDoc> {
  const file = await store.readFile(path);
  if (file.kind === 'absent' || file.kind === 'unreadable') return 'skip';
  try {
    const doc: unknown = JSON.parse(new TextDecoder().decode(file.bytes));
    return Array.isArray(doc) ? doc : 'skip';
  } catch {
    return 'skip';
  }
}
