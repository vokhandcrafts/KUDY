// G02.03 — build-bundle: packager for the strict JSON content package.
//
// Contract sources (field shapes copied, never restated):
//   09 §3  bundle layout, tier files, RouteStop.preview
//   09 §4  lock.json = [{path, bytes, sha256}], immutable bundles
//   09 §5  grant boundary: base layer carries only the separately serialized
//          public preview of locked stops
//   09 §11 build-bundle hashes, generates lock.json, lays layers into
//          public/private; only the script guarantees no extended leak
//   21 §2  DiscoveryIndexV1 producer, feedback_target_registry producer
//   21 §3  index shape, detail_ref path safety, availability/access
//   21 §5.2 registry export: prepared status, guide/place revisions
//   21 §9  builder rejects invalid index constructs (row 1)
//
// Separate process from the app and from spikes (19 §2.4): no shared code.
// Determinism: byte hashing over pinned-LF inputs (.gitattributes), sorted
// walks, canonical JSON with sorted keys, no timestamps in any artifact.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LOCALE_ALLOWLIST = ['be', 'en', 'uk'];
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const MAX_INDEX_BYTES = 512 * 1024;

export class BuildError extends Error {
  constructor(code, ids = {}) {
    super(code);
    this.name = 'BuildError';
    this.code = code;
    this.ids = ids;
  }
}

const fail = (code, ids) => {
  throw new BuildError(code, ids);
};

// ---------------------------------------------------------------- primitives

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stableValue(value), null, 2) + '\n';
}

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function listFiles(rootAbs) {
  const found = [];
  async function walk(rel) {
    const entries = await fsp.readdir(path.join(rootAbs, rel), { withFileTypes: true });
    for (const entry of entries) {
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(relChild);
      else if (entry.isFile()) found.push(relChild);
    }
  }
  await walk('');
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function readBytes(inAbs, rel) {
  try {
    return await fsp.readFile(path.join(inAbs, ...rel.split('/')));
  } catch {
    return fail('missing-file', { path: rel });
  }
}

async function readJsonRel(inAbs, rel) {
  const raw = await readBytes(inAbs, rel);
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return fail('invalid-json', { path: rel });
  }
}

async function writeFileRel(outAbs, rel, buf) {
  const abs = path.join(outAbs, ...rel.split('/'));
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf);
}

const isIdentifier = (value) => typeof value === 'string' && /^[a-z0-9._-]{1,64}$/.test(value);

const isPathSafe = (value) =>
  value.split('/').every((segment) => segment !== 'private' && segment !== 'extended' && segment !== '..' && segment !== '.');

function assertLocales(value, where) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-localized', where);
  }
  for (const locale of Object.keys(value)) {
    if (!LOCALE_ALLOWLIST.includes(locale)) return fail('unknown-locale', { ...where, locale });
    if (typeof value[locale] !== 'string') return fail('invalid-localized', where);
  }
}

// localized = {field: {locale: string}} — two levels (21 §3.2 DiscoveryOffer).
function assertLocalizedFields(value, where) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-localized', where);
  }
  for (const field of Object.keys(value)) assertLocales(value[field], { ...where, field });
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) collectStrings(value[key], out);
  }
  return out;
}

const normalizeText = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function ngrams(words, size) {
  const out = [];
  for (let i = 0; i + size <= words.length; i++) out.push(words.slice(i, i + size).join(' '));
  return out;
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// ------------------------------------------------------- author tree reading

async function readAuthorTree(inAbs) {
  const route = await readJsonRel(inAbs, 'route.json');
  const places = await readJsonRel(inAbs, 'places.json');
  const voices = await readJsonRel(inAbs, 'voices.json');
  const discovery = await readJsonRel(inAbs, 'discovery.json');

  if (!isIdentifier(route.route_id)) fail('invalid-identifier', { field: 'route_id' });
  if (!isIdentifier(route.version)) fail('invalid-identifier', { field: 'version' });
  if (route.access !== 'free_base' && route.access !== 'paid') fail('invalid-access', { route_id: route.route_id });
  if (!Array.isArray(route.stops)) fail('invalid-route-stops', { route_id: route.route_id });
  const stopIds = new Set();
  for (const stop of route.stops) {
    if (stopIds.has(stop.id)) fail('duplicate-stop-id', { route_id: route.route_id, stop_id: stop.id });
    stopIds.add(stop.id);
  }
  if (!Array.isArray(places)) fail('invalid-places', { route_id: route.route_id });

  const locales = new Set();
  const tierFiles = { base: [], extended: [] };
  const projectionRels = [];
  for (const rel of await listFiles(inAbs)) {
    if (['route.json', 'places.json', 'voices.json', 'discovery.json'].includes(rel)) continue;
    const segments = rel.split('/');
    const locale = segments[0];
    if (LOCALE_ALLOWLIST.includes(locale)) {
      locales.add(locale);
      if (segments[1] !== 'base' && segments[1] !== 'extended') fail('invalid-tier-dir', { path: rel });
      tierFiles[segments[1]].push(rel);
    } else if (
      segments.length === 3 &&
      segments[2] === 'public.json' &&
      (segments[0] === 'places' || segments[0] === 'collections')
    ) {
      projectionRels.push(rel);
    } else {
      fail('unknown-author-entry', { path: rel });
    }
  }
  if (locales.size === 0) fail('no-locales', { route_id: route.route_id });

  const projections = new Map();
  for (const rel of projectionRels) {
    const doc = await readJsonRel(inAbs, rel);
    const idField = rel.startsWith('collections/') ? 'collection_id' : 'place_id';
    if (!isIdentifier(doc[idField]) || !isIdentifier(doc.content_version)) {
      fail('invalid-projection', { path: rel });
    }
    projections.set(rel, doc);
  }

  return {
    route,
    places,
    discovery,
    locales: [...locales].sort(),
    tierFiles,
    projections,
  };
}

// --------------------------------------------------- discovery index builder

function projectionLocales(doc) {
  const found = new Set();
  for (const key of Object.keys(doc)) {
    const value = doc[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const locale of Object.keys(value)) {
        if (LOCALE_ALLOWLIST.includes(locale)) found.add(locale);
      }
    }
  }
  return [...found].sort();
}

function validDurationRange(offerId, duration) {
  const { min_minutes: min, max_minutes: max } = duration;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || min > max || max > 1440) {
    fail('duration-range', { offer_id: offerId });
  }
}

export function assembleIndex(authoring, ctx) {
  if (authoring.schema_version !== undefined && authoring.schema_version !== 1) {
    fail('unknown-schema', { part: 'discovery' });
  }
  if (!isIdentifier(authoring.revision)) fail('invalid-identifier', { field: 'revision' });
  if (authoring.city_id !== ctx.cityId) fail('foreign-city', { city_id: authoring.city_id });

  const themeIds = new Set();
  for (const theme of authoring.themes ?? []) {
    if (!isIdentifier(theme.id)) fail('invalid-identifier', { field: 'theme_id' });
    if (themeIds.has(theme.id)) fail('duplicate-theme', { theme_id: theme.id });
    themeIds.add(theme.id);
    assertLocales(theme.labels ?? null, { theme_id: theme.id });
  }

  const offerIds = new Set();
  const offers = [];
  for (const offer of authoring.offers ?? []) {
    const where = { offer_id: offer.offer_id };
    if (!isIdentifier(offer.offer_id)) fail('invalid-identifier', { field: 'offer_id' });
    if (offerIds.has(offer.offer_id)) fail('duplicate-offer-id', where);
    offerIds.add(offer.offer_id);
    if (offer.city_id !== ctx.cityId) fail('foreign-city', where);
    for (const themeId of offer.themes ?? []) {
      if (!themeIds.has(themeId)) fail('unknown-theme', { ...where, theme_id: themeId });
    }
    assertLocalizedFields(offer.localized ?? null, where);
    for (const season of offer.season_recommendations ?? []) {
      if (!SEASONS.includes(season.season)) fail('unknown-season', { ...where, season: season.season });
      assertLocales(season.reason ?? null, where);
    }
    if (offer.estimated_duration) {
      validDurationRange(offer.offer_id, offer.estimated_duration);
      if (offer.ref?.kind === 'guide') {
        const routeDuration = ctx.routeDuration(offer.ref.route_id);
        if (routeDuration !== null) {
          const { min_minutes: min, max_minutes: max } = offer.estimated_duration;
          if (min > routeDuration || max < routeDuration) fail('duration-range', where);
        }
      }
    }

    const ref = offer.ref ?? {};
    const resolved = ctx.resolveRef(ref);
    if (!resolved.ok) fail('unknown-ref', { ...where, ref: JSON.stringify(ref) });

    const detail = offer.detail_ref ?? {};
    if (detail.kind === 'guide_preview') {
      if (detail.path !== undefined) fail('detail-ref-invalid', where);
    } else if (detail.kind === 'place_public' || detail.kind === 'collection_public') {
      if (typeof detail.path !== 'string' || detail.path === '') fail('detail-ref-invalid', where);
      if (!isPathSafe(detail.path)) fail('private-path', { ...where, path: detail.path });
      const meta = ctx.publicPathMeta(detail.path);
      if (!meta.ok) fail('unknown-ref', { ...where, path: detail.path });
      if (
        (ref.kind === 'place' && (meta.placeId !== ref.place_id || meta.contentVersion !== ref.content_version)) ||
        (ref.kind === 'collection' &&
          (meta.collectionId !== ref.collection_id || meta.contentVersion !== ref.content_version))
      ) {
        fail('detail-ref-mismatch', { ...where, path: detail.path });
      }
    } else {
      fail('detail-ref-invalid', where);
    }

    offers.push({
      offer_id: offer.offer_id,
      ref,
      city_id: offer.city_id,
      editorial_order: offer.editorial_order,
      themes: offer.themes ?? [],
      localized: offer.localized ?? {},
      ...(offer.estimated_duration ? { estimated_duration: offer.estimated_duration } : {}),
      ...(offer.distance_m !== undefined ? { distance_m: offer.distance_m } : {}),
      ...(offer.suggested_start_place_id !== undefined
        ? { suggested_start_place_id: offer.suggested_start_place_id }
        : {}),
      season_recommendations: offer.season_recommendations ?? [],
      availability: resolved.availability,
      access: resolved.access,
      detail_ref: detail,
    });
  }

  const guideOfferByRoute = new Map();
  for (const offer of offers) {
    if (offer.ref.kind === 'guide') guideOfferByRoute.set(offer.ref.route_id, offer);
  }

  const collectionIds = new Set();
  const collections = [];
  for (const collection of authoring.collections ?? []) {
    const where = { collection_id: collection.collection_id };
    if (!isIdentifier(collection.collection_id)) fail('invalid-identifier', { field: 'collection_id' });
    if (collectionIds.has(collection.collection_id)) fail('duplicate-collection-id', where);
    collectionIds.add(collection.collection_id);
    if (collection.city_id !== ctx.cityId) fail('foreign-city', where);
    assertLocalizedFields(collection.localized ?? null, where);

    const seenMembers = new Set();
    let needsOverlapNote = false;
    for (const member of collection.members ?? []) {
      if (member.kind === 'collection') fail('nested-collection', where);
      const key = JSON.stringify(member);
      if (seenMembers.has(key)) fail('duplicate-member-ref', { ...where, ref: key });
      seenMembers.add(key);
      if (!ctx.resolveRef(member).ok) fail('unknown-ref', { ...where, ref: key });
      if (member.kind === 'place') {
        for (const guideOffer of guideOfferByRoute.values()) {
          if (guideOffer.suggested_start_place_id === member.place_id) needsOverlapNote = true;
        }
      }
    }
    if (needsOverlapNote) {
      if (
        collection.overlap_note === null ||
        collection.overlap_note === undefined ||
        Object.keys(collection.overlap_note).length === 0
      ) {
        fail('missing-overlap-note', where);
      }
      assertLocales(collection.overlap_note, where);
    }

    collections.push({
      collection_id: collection.collection_id,
      content_version: collection.content_version,
      city_id: collection.city_id,
      localized: collection.localized ?? {},
      members: collection.members ?? [],
      ...(needsOverlapNote ? { overlap_note: collection.overlap_note } : {}),
    });
  }

  const index = {
    schema_version: 1,
    revision: authoring.revision,
    city_id: authoring.city_id,
    themes: authoring.themes ?? [],
    offers,
    collections,
  };
  const indexBytes = Buffer.from(canonicalJson(index), 'utf8');
  if (indexBytes.length > MAX_INDEX_BYTES) fail('index-oversized', { bytes: indexBytes.length });
  return { index, indexBytes };
}

// ------------------------------------------------------------ leak scanning

function parseJsonBuffer(buf, rel) {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return fail('invalid-json', { path: rel });
  }
}

function buildPrivateGrams(privateRels, bytesByRel) {
  const grams = new Set();
  for (const rel of privateRels) {
    if (!rel.endsWith('.json')) continue;
    for (const raw of collectStrings(parseJsonBuffer(bytesByRel.get(rel), rel))) {
      for (const gram of ngrams(normalizeText(raw).split(' ').filter(Boolean), 8)) grams.add(gram);
    }
  }
  return grams;
}

function scanPublicForLeaks(bytesByRel, grams) {
  for (const [rel, buf] of bytesByRel) {
    if (rel.endsWith('.map')) fail('source-map-in-public', { path: rel });
    if (!rel.endsWith('.json')) continue;
    for (const raw of collectStrings(parseJsonBuffer(buf, rel))) {
      if (raw.includes('/') && !isPathSafe(raw)) fail('private-path-in-public', { path: rel, value: raw });
      for (const gram of ngrams(normalizeText(raw).split(' ').filter(Boolean), 8)) {
        if (grams.has(gram)) fail('private-text-leak', { path: rel });
      }
    }
  }
}

// ------------------------------------------------------------------- build

export async function buildBundle({ inDir, outDir }) {
  const inAbs = path.resolve(inDir);
  const outAbs = path.resolve(outDir);
  if (fs.existsSync(outAbs) && (await fsp.readdir(outAbs)).length > 0) {
    fail('out-dir-not-empty', { out_dir: outDir });
  }

  const tree = await readAuthorTree(inAbs);
  const { route, discovery } = tree;
  if (discovery.city_id !== route.city_id) fail('foreign-city', { city_id: discovery.city_id });
  const bundleRoot = `bundle/${route.route_id}/${route.version}`;

  // public/private artifacts keyed by out-root-relative path; written only
  // after every check passes (21 §3.3: verify, then write).
  const publicFiles = new Map();
  const privateFiles = new Map();
  const kinds = new Map();

  // 09 §3 bundle root files are public.
  for (const rel of ['route.json', 'places.json', 'voices.json']) {
    const relOut = `${bundleRoot}/${rel}`;
    publicFiles.set(relOut, await readBytes(inAbs, rel));
    kinds.set(`public/${relOut}`, 'public_bundle');
  }

  // 09 §3/§4: base layer = public (free), extended layer = private (paid).
  const lockedStops = route.stops.filter((stop) => stop.access_tier === 'extended');
  const textLocales = [];
  const audioLocales = [];
  for (const locale of tree.locales) {
    for (const tier of ['base', 'extended']) {
      const files = tree.tierFiles[tier].filter((rel) => rel.startsWith(`${locale}/${tier}/`));
      if (files.length === 0) continue;
      const target = tier === 'base' ? publicFiles : privateFiles;
      for (const rel of files) {
        const relOut = `${bundleRoot}/${locale}/${tier}/${rel.slice(locale.length + tier.length + 2)}`;
        target.set(relOut, await readBytes(inAbs, rel));
        kinds.set(`${tier === 'base' ? 'public' : 'private'}/${relOut}`, tier === 'base' ? 'public_bundle' : 'private_bundle');
      }
      if (tier === 'base') {
        if (files.some((rel) => rel === `${locale}/base/stops.json`)) textLocales.push(locale);
        if (files.some((rel) => rel.startsWith(`${locale}/base/audio/`) && rel.endsWith('.m4a'))) {
          audioLocales.push(locale);
        }

        // 09 §5 grant boundary: the base layer's only representation of a
        // locked stop is the serialized public preview. Field allowlist so
        // paid content cannot be stuffed into a preview object.
        const previews = [];
        for (const stop of lockedStops) {
          const preview = stop.preview;
          if (preview === null || preview === undefined || typeof preview !== 'object') {
            fail('preview-missing', { stop_id: stop.id });
          }
          for (const key of Object.keys(preview)) {
            if (key !== 'name' && key !== 'announce') fail('preview-unknown-field', { stop_id: stop.id, field: key });
          }
          assertLocales(preview.name ?? null, { stop_id: stop.id, field: 'name' });
          assertLocales(preview.announce ?? null, { stop_id: stop.id, field: 'announce' });
          previews.push({ stop_id: stop.id, place_id: stop.place_id, name: preview.name, announce: preview.announce });
        }
        const relOut = `${bundleRoot}/${locale}/base/previews.json`;
        publicFiles.set(relOut, Buffer.from(canonicalJson(previews), 'utf8'));
        kinds.set(`public/${relOut}`, 'public_bundle');
      }
    }
  }

  // Public projections: detail_ref targets (21 §3.2); the author rel IS the
  // public rel (`places/<id>/public.json`, `collections/<id>/public.json`).
  const publicPathMeta = new Map();
  for (const [rel, doc] of tree.projections) {
    publicFiles.set(rel, await readBytes(inAbs, rel));
    kinds.set(`public/${rel}`, rel.startsWith('collections/') ? 'collection_public' : 'place_public');
    publicPathMeta.set(rel, {
      ok: true,
      placeId: doc.place_id,
      collectionId: doc.collection_id,
      contentVersion: doc.content_version,
    });
  }

  // Availability computed from published content (21 §3.2); access per layer
  // contract: guide from Route.access, places free, collections mixed/free
  // by members.
  const placeById = new Map(tree.places.map((place) => [place.id, place]));
  const guideAccess = route.access === 'free_base' ? 'free' : 'paid';
  const resolveBase = (ref) => {
    if (ref.kind === 'guide') {
      if (ref.route_id !== route.route_id || ref.version !== route.version) return { ok: false };
      return {
        ok: true,
        availability: { text_locales: textLocales, audio_locales: audioLocales },
        access: guideAccess,
      };
    }
    if (ref.kind === 'place') {
      const place = placeById.get(ref.place_id);
      if (!place || place.content_version !== ref.content_version) return { ok: false };
      const projection = tree.projections.get(`places/${ref.place_id}/public.json`);
      return {
        ok: true,
        availability: projection
          ? { text_locales: projectionLocales(projection), audio_locales: [] }
          : { text_locales: [], audio_locales: [] },
        access: 'free',
      };
    }
    return { ok: false };
  };
  const ctx = {
    cityId: discovery.city_id,
    resolveRef(ref) {
      if (ref.kind !== 'collection') return resolveBase(ref);
      const collection = (discovery.collections ?? []).find(
        (entry) => entry.collection_id === ref.collection_id && entry.content_version === ref.content_version,
      );
      if (!collection) return { ok: false };
      // 21 §3.2: a collection's text is available where its description AND
      // every member card's text are available; its audio_locales stay [].
      let descLocales = projectionLocales(collection.localized ?? {});
      let anyPaid = false;
      for (const member of collection.members ?? []) {
        if (member.kind === 'collection') continue; // rejected as nested below
        const memberResolved = resolveBase(member);
        if (!memberResolved.ok) return { ok: false };
        const memberLocales = new Set(memberResolved.availability.text_locales);
        descLocales = descLocales.filter((locale) => memberLocales.has(locale));
        if (memberResolved.access === 'paid') anyPaid = true;
      }
      return {
        ok: true,
        availability: { text_locales: descLocales, audio_locales: [] },
        access: anyPaid ? 'mixed' : 'free',
      };
    },
    routeDuration: (routeId) => (routeId === route.route_id ? route.duration_min ?? null : null),
    publicPathMeta: (rel) => publicPathMeta.get(rel) ?? { ok: false },
  };

  // 21 §9 row 1: the builder rejects invalid index constructs.
  const { index, indexBytes } = assembleIndex(discovery, ctx);
  const indexRel = `discovery/${discovery.city_id}/${discovery.revision}/index.json`;
  publicFiles.set(indexRel, indexBytes);
  kinds.set(`public/${indexRel}`, 'discovery_index');

  // 09 §12 negative leak test, applied to every build: nothing in public/
  // may lead to an extended asset or quote private text.
  scanPublicForLeaks(
    new Map([...publicFiles].map(([rel, buf]) => [`public/${rel}`, buf])),
    buildPrivateGrams([...privateFiles.keys()], privateFiles),
  );

  // Registry export (21 §5.2): guide targets per published text locale,
  // place targets per published public projection; collections and single
  // stories are not targets this release; prepared, ids only.
  const targets = [];
  for (const locale of textLocales) {
    targets.push({ kind: 'guide', route_id: route.route_id, version: route.version, locale, status: 'prepared' });
  }
  for (const [rel, doc] of tree.projections) {
    if (!rel.startsWith('places/')) continue;
    for (const locale of projectionLocales(doc)) {
      targets.push({
        kind: 'place',
        place_id: doc.place_id,
        content_version: doc.content_version,
        locale,
        status: 'prepared',
      });
    }
  }
  targets.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  const registryBytes = Buffer.from(canonicalJson({ schema_version: 1, status: 'prepared', targets }), 'utf8');

  // Write trees, then per-layer lock.json (09 §4): [{path, bytes, sha256}]
  // relative to the layer directory; lock.json itself is not listed.
  const written = new Map();
  for (const [label, files] of [['public', publicFiles], ['private', privateFiles]]) {
    for (const [rel, buf] of files) {
      await writeFileRel(outAbs, `${label}/${rel}`, buf);
      written.set(`${label}/${rel}`, buf);
    }
  }
  for (const [label, files] of [['public', publicFiles], ['private', privateFiles]]) {
    const byLayer = new Map();
    for (const [rel, buf] of files) {
      const segments = rel.split('/');
      const layerIndex = segments.indexOf('base') >= 0 ? segments.indexOf('base') : segments.indexOf('extended');
      if (layerIndex < 0) continue;
      const layerDir = `${segments[layerIndex - 1]}/${segments[layerIndex]}`;
      if (!byLayer.has(layerDir)) byLayer.set(layerDir, []);
      byLayer
        .get(layerDir)
        .push({ path: segments.slice(layerIndex + 1).join('/'), bytes: buf.length, sha256: sha256Hex(buf) });
    }
    for (const [layerDir, entries] of byLayer) {
      entries.sort(byPath);
      const rel = `${bundleRoot}/${layerDir}/lock.json`;
      const buf = Buffer.from(canonicalJson(entries), 'utf8');
      await writeFileRel(outAbs, `${label}/${rel}`, buf);
      written.set(`${label}/${rel}`, buf);
      kinds.set(`${label}/${rel}`, `${label}_bundle`);
    }
  }

  // Release manifest: every public/private artifact with bytes+sha256, and
  // the registry handoff for G02.04 (21 §5.2).
  const releaseManifest = {
    schema_version: 1,
    route_id: route.route_id,
    version: route.version,
    city_id: discovery.city_id,
    discovery_revision: discovery.revision,
    artifacts: [...written.entries()]
      .map(([rel, buf]) => ({ path: rel, bytes: buf.length, sha256: sha256Hex(buf), kind: kinds.get(rel) }))
      .sort(byPath),
    feedback_target_registry: {
      path: 'release/feedback-target-registry.json',
      bytes: registryBytes.length,
      sha256: sha256Hex(registryBytes),
      status: 'prepared',
      targets: targets.length,
    },
  };
  const releaseBytes = Buffer.from(canonicalJson(releaseManifest), 'utf8');
  await writeFileRel(outAbs, 'release/feedback-target-registry.json', registryBytes);
  await writeFileRel(outAbs, 'release/release-manifest.json', releaseBytes);

  return {
    artifacts: Object.fromEntries(
      [...written.entries(), ['release/feedback-target-registry.json', registryBytes], ['release/release-manifest.json', releaseBytes]].map(
        ([rel, buf]) => [rel, { bytes: buf.length, sha256: sha256Hex(buf) }],
      ),
    ),
    index,
    registry: targets,
  };
}

// --------------------------------------------------------------------- CLI

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const inDir = opt('--in');
  const outDir = opt('--out');
  if (!inDir || !outDir) {
    console.error('usage: node tools/build-bundle/build-bundle.mjs --in <author-dir> --out <build-dir>');
    process.exit(2);
  }
  try {
    const result = await buildBundle({ inDir, outDir });
    console.log(canonicalJson({ built: true, artifacts: Object.keys(result.artifacts).length }).trimEnd());
  } catch (error) {
    if (error instanceof BuildError) {
      console.error(canonicalJson({ error: { code: error.code, ...error.ids } }).trimEnd());
      process.exit(1);
    }
    throw error;
  }
}
