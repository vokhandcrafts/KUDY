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
  | { ok: false; diagnostic: 'moment-facts#list-failed' | 'moment-facts#probe-missing' };

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
  },
): Promise<MomentFacts> {
  if (typeof options.audioProbe !== 'function') {
    // The named refusal answers before the first store call: a probe-less
    // composition never reaches the library, let alone a full media read.
    return { ok: false, diagnostic: 'moment-facts#probe-missing' };
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
      for (const moment of raw) {
        const audioPath = await resolveAudioPath(options.audioProbe, packageRoot, moment.storyId, options.locales, diagnostics);
        const teaserText = await readTeaserText(store, packageRoot, moment.storyId, options.locales);
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
// renders its label only, never invented text.
async function readTeaserText(
  store: BundlesStore,
  packageRoot: string,
  storyId: string,
  locales: readonly string[],
): Promise<string | null> {
  for (const locale of locales) {
    if (!isSafeSegment(locale)) continue;
    const file = await store.readFile(`${packageRoot}/${locale}/base/stops.json`);
    if (file.kind === 'absent' || file.kind === 'unreadable') continue;
    let doc: unknown;
    try {
      doc = JSON.parse(new TextDecoder().decode(file.bytes));
    } catch {
      continue;
    }
    if (!Array.isArray(doc)) continue;
    for (const entry of doc) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (record.story_id !== storyId) continue;
      const text = record.text;
      return typeof text === 'string' && text.length > 0 ? text : null;
    }
  }
  return null;
}
