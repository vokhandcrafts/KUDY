// G02.02 — content package validator with named diagnostics (issue #103).
// Consumes contracts/reader.mjs as the single schema interpretation source
// (09 §4: the format is a public contract — validate shares one source with
// the app and the web) and validates the whole author tree of 09 §3:
// route.json, places.json, voices.json, discovery.json, the optional G03.04
// media.json/moments.json manifests, per-locale
// <locale>/{base,extended}/stops.json + audio/, and public projections.
// What a single-document schema cannot express lives here: cross-file
// references, duplicate ids, approval status, media presence, path safety,
// radius-overlap warnings and RouteStop.id stability across published
// versions (09 §3 invariants 1/3/5/6/10; 21 §3.2) — plus the G03.04 rights
// manifest (every media file covered by a license/credit record, sha256
// matched), the manual-only moment manifest and the audio-without-text
// availability guard (invariant 1). Diagnostics carry stable
// rules and entity paths, never file content — the same leak boundary the
// G02.03 packager keeps.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateSchemaFile, checkIndexRules } from '../../contracts/reader.mjs';

// Segments a package-relative reference must never carry: traversal, and the
// private/extended layers a public file may not point into (09 §3 invariant 9;
// 21 §3.2 detail_ref: "без private/ і без уцечак"). `..` passes the schema
// charset patterns, so the denylist is this validator's own job.
const UNSAFE_SEGMENTS = new Set(['..', '.', 'private', 'extended']);

const EARTH_RADIUS_M = 6371008.8;

export function diag(list, severity, rule, where) {
  list.push({ severity, rule, path: where });
}

// Iterative walk with forward-slash relative paths; the fs APIs accept '/'
// on Windows, so the rest of the module stays platform-neutral.
// Exported for verify-audio (G03.03), which walks the same package tree.
export function listFiles(rootAbs) {
  const found = [];
  const queue = [''];
  while (queue.length > 0) {
    const rel = queue.pop();
    for (const entry of fs.readdirSync(rel ? `${rootAbs}/${rel}` : rootAbs, { withFileTypes: true })) {
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) queue.push(relChild);
      else if (entry.isFile()) found.push(relChild);
    }
  }
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function readJson(rootAbs, rel, errors) {
  let raw;
  try {
    raw = fs.readFileSync(`${rootAbs}/${rel}`, 'utf8');
  } catch {
    diag(errors, 'error', 'missing-file', rel);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    diag(errors, 'error', 'invalid-json', rel);
    return null;
  }
}

// Schema errors keep their keyword as the rule name (the reader's `rule`
// field holds the document path for schema hits) and gain the file prefix.
// The reader resolves schema paths against contracts/, hence the schemas/ prefix.
function schemaCheck(name, doc, fileRel, errors) {
  for (const e of validateSchemaFile(`schemas/${name}`, doc).errors) {
    diag(errors, 'error', e.keyword, `${fileRel}#${e.path}`);
  }
}

function safeRelPath(rel) {
  return typeof rel === 'string' && !rel.includes('\\') && !path.isAbsolute(rel) &&
    rel.split('/').every((segment) => !UNSAFE_SEGMENTS.has(segment));
}

// A package file that should hold an array but does not is a diagnostic, not
// a crash: every downstream loop walks a guaranteed array.
// Exported for verify-audio (G03.03), which reads the same stops.json files.
export function asArray(doc, rel, errors) {
  if (doc === null || doc === undefined) return [];
  if (!Array.isArray(doc)) {
    diag(errors, 'error', 'type', `${rel}#$`);
    return [];
  }
  // Sparse null elements are reported here and dropped: they are the one
  // shape that crashes property access downstream (round-3 review). Scalar
  // elements (theme ids and the like) are legitimate array members and are
  // left to the schema and the per-element checks.
  return doc.filter((item, i) => {
    if (item !== null && item !== undefined) return true;
    diag(errors, 'error', 'type', `${rel}[${i}]`);
    return false;
  });
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function checkUniqueId(list, key, at, errors, seen = new Set()) {
  list.forEach((item, i) => {
    // A missing identity field is the schema's `required` diagnostic; a
    // duplicate-`undefined` verdict here would only muddle the report.
    if (item?.[key] === undefined) return;
    if (seen.has(item[key])) diag(errors, 'error', 'duplicate-id', `${at}[${i}]#${item[key]}`);
    seen.add(item[key]);
  });
  return seen;
}

// detail_ref: the path must be safe, owned by the offer's own ref, and
// resolve inside the package (21 §3.2: a typed link to a known preview or a
// verified public file, never an arbitrary fetch).
function checkDetailRef(offer, at, files, errors) {
  const ref = offer.detail_ref;
  if (!ref || ref.kind === 'guide_preview' || !ref.path) return;
  if (!safeRelPath(ref.path)) {
    diag(errors, 'error', 'unsafe-path', `${at}.detail_ref.path`);
    return;
  }
  const owner = ref.kind === 'place_public' ? offer.ref?.place_id : offer.ref?.collection_id;
  if (ref.path !== `${ref.kind === 'place_public' ? 'places' : 'collections'}/${owner}/public.json`) {
    diag(errors, 'error', 'detail-ref-mismatch', `${at}.detail_ref.path`);
    return;
  }
  if (!files.includes(ref.path)) diag(errors, 'error', 'unknown-ref', `${at}.detail_ref.path#${ref.path}`);
}

// Route-stop ids are the only identity of a stop across the whole system
// (09 §3 RouteStop): unique inside the route and never reused for a different
// place; a stop that reappears under a new id is a renumber, not a move.
function checkStopStability(route, previousDir, errors) {
  let prevRoute = null;
  try {
    prevRoute = JSON.parse(fs.readFileSync(`${path.resolve(previousDir)}/route.json`, 'utf8'));
  } catch {
    diag(errors, 'error', 'previous-unreadable', 'previous/route.json');
    return;
  }
  if (prevRoute === null || typeof prevRoute !== 'object') {
    diag(errors, 'error', 'previous-unreadable', 'previous/route.json');
    return;
  }
  // An absent or corrupt current route.json already reported missing-file or
  // invalid-json; comparing ids against it would only add a misleading
  // route-id-changed verdict (round-2 review, PR #116).
  if (route === null || typeof route !== 'object' || !route.route_id) return;
  if (prevRoute.route_id !== route.route_id) {
    diag(errors, 'error', 'route-id-changed', `route.json#${prevRoute.route_id}->${route.route_id}`);
    return;
  }
  const prevStops = Array.isArray(prevRoute.stops)
    ? prevRoute.stops.filter((s) => s && typeof s === 'object')
    : [];
  const curStops = Array.isArray(route?.stops)
    ? route.stops.filter((s) => s && typeof s === 'object')
    : [];
  const prevById = new Map(prevStops.map((s) => [s.id, s]));
  const fieldsEqual = (a, b) => a.place_id === b.place_id && a.access_tier === b.access_tier &&
    a.story_base_id === b.story_base_id && a.story_extended_id === b.story_extended_id;
  curStops.forEach((stop, i) => {
    const before = prevById.get(stop.id);
    if (before && !fieldsEqual(before, stop)) {
      diag(errors, 'error', 'stop-id-drift', `route.json#stops[${i}]#${stop.id}`);
    }
  });
  const removed = prevStops.filter((s) => !curStops.some((c) => c.id === s.id));
  const renamedFrom = new Set();
  curStops.forEach((stop, i) => {
    if (prevById.has(stop.id)) return;
    const renamed = removed.find((s) => !renamedFrom.has(s.id) && s.place_id === stop.place_id && s.access_tier === stop.access_tier);
    if (renamed) {
      renamedFrom.add(renamed.id);
      diag(errors, 'error', 'stop-id-renumbered', `route.json#stops[${i}]#${renamed.id}->${stop.id}`);
    }
  });
}

// checkIndexRules walks collection.members unguarded; feed it inert members
// for garbage shapes — they already produced `type` diagnostics via asArray.
function readerSafeCollections(collections) {
  return collections.map((c) => {
    const item = c && typeof c === 'object' && !Array.isArray(c) ? c : {};
    return { ...item, members: Array.isArray(item.members) ? item.members : [] };
  });
}

export function validatePackage(dir, options = {}) {
  const rootAbs = path.resolve(dir);
  const errors = [];
  const warnings = [];
  let files;
  try {
    files = listFiles(rootAbs);
  } catch {
    diag(errors, 'error', 'missing-file', '.');
    files = [];
  }

  const route = readJson(rootAbs, 'route.json', errors);
  if (route) schemaCheck('route.schema.json', route, 'route.json', errors);
  const stops = asArray(route?.stops, 'route.json#stops', errors);
  const places = asArray(readJson(rootAbs, 'places.json', errors), 'places.json', errors);
  places.forEach((p, i) => schemaCheck('place.schema.json', p, `places.json[${i}]`, errors));
  const voicesDoc = readJson(rootAbs, 'voices.json', errors);
  const voices = asArray(voicesDoc, 'voices.json', errors);
  // voice.schema.json roots at the whole file (type: array), unlike the
  // per-object place schema.
  schemaCheck('voice.schema.json', voicesDoc ?? [], 'voices.json', errors);
  // The authoring discovery.json is a partial index: schema_version,
  // availability and access are computed by the G02.03 packager, so the full
  // DiscoveryIndexV1 schema applies to the assembled index (proven by the
  // criterion-5 fixtures), while the authoring doc gets the cross-record
  // checks below.
  const discovery = readJson(rootAbs, 'discovery.json', errors);
  if (discovery !== null && (typeof discovery !== 'object' || Array.isArray(discovery))) {
    diag(errors, 'error', 'type', 'discovery.json#$');
  }

  // G03.04: media.json is the rights manifest of the tree — one Media record
  // (media.schema.json, license/credit required) per media file, matched by
  // sha256. moment.schema.json records are the manual-only teaser manifest:
  // additionalProperties:false already rejects any auto-trigger field, so a
  // package cannot encode a moment that opens itself (ADR G01.02 §3.1).
  const mediaDoc = fs.existsSync(path.join(rootAbs, 'media.json'))
    ? readJson(rootAbs, 'media.json', errors)
    : null;
  const media = asArray(mediaDoc, 'media.json', errors);
  media.forEach((record, i) => schemaCheck('media.schema.json', record, `media.json[${i}]`, errors));
  const mediaIds = checkUniqueId(media, 'media_id', 'media.json', errors);
  const moments = fs.existsSync(path.join(rootAbs, 'moments.json'))
    ? asArray(readJson(rootAbs, 'moments.json', errors), 'moments.json', errors)
    : [];
  moments.forEach((moment, i) => schemaCheck('moment.schema.json', moment, `moments.json[${i}]`, errors));
  checkUniqueId(moments, 'id', 'moments.json', errors);

  // sha256 + size of every media file in the tree (the two mimes
  // media.schema.json allows); a Media record must match exactly one of
  // them, and a tree that ships media files must manifest every one of them.
  const MEDIA_EXTENSIONS = new Set(['.m4a', '.webp']);
  const MEDIA_LOCALES = new Set(['be', 'en', 'uk']); // media.schema.json locale enum
  const mediaFiles = new Map(); // rel -> { sha, bytes }
  for (const rel of files) {
    if (!MEDIA_EXTENSIONS.has(path.extname(rel))) continue;
    try {
      const buf = fs.readFileSync(`${rootAbs}/${rel}`);
      mediaFiles.set(rel, { sha: createHash('sha256').update(buf).digest('hex'), bytes: buf.length });
    } catch {
      diag(errors, 'error', 'unreadable-media', rel);
    }
  }
  const pathsBySha = new Map();
  for (const [rel, meta] of mediaFiles) {
    if (!pathsBySha.has(meta.sha)) pathsBySha.set(meta.sha, []);
    pathsBySha.get(meta.sha).push(rel);
  }
  media.forEach((record, i) => {
    const sha = record?.sha256;
    if (typeof sha !== 'string') return;
    const rels = pathsBySha.get(sha);
    if (!rels) {
      diag(errors, 'error', 'media-sha-unmatched', `media.json[${i}]#${sha}`);
      return;
    }
    // A record describes the file it covers: its bytes and locale must not
    // drift from the matched file's own facts.
    if (record.bytes !== undefined && record.bytes !== mediaFiles.get(rels[0]).bytes) {
      diag(errors, 'error', 'media-bytes-mismatch', `media.json[${i}]`);
    }
    const foreign = rels.some((rel) => {
      const top = rel.split('/')[0];
      return MEDIA_LOCALES.has(top) && top !== record.locale;
    });
    if (record.locale !== undefined && foreign) {
      diag(errors, 'error', 'media-locale-mismatch', `media.json[${i}]`);
    }
  });
  for (const [sha, rels] of pathsBySha) {
    if (!media.some((record) => record?.sha256 === sha)) {
      for (const rel of rels) diag(errors, 'error', 'unlicensed-media', rel);
    }
  }

  const locales = new Map(); // locale -> { base?, extended? } layer = { stories, ids }
  for (const rel of files) {
    const m = rel.match(/^([^/]+)\/(base|extended)\/stops\.json$/);
    if (!m) continue;
    const stories = asArray(readJson(rootAbs, rel, errors), rel, errors);
    stories.forEach((s, i) => schemaCheck('story.schema.json', s, `${rel}[${i}]`, errors));
    if (!locales.has(m[1])) locales.set(m[1], {});
    locales.get(m[1])[m[2]] = { stories, ids: new Set(stories.map((s) => s.story_id)) };
  }
  for (const rel of files) {
    if (!/^(places|collections)\/[^/]+\/public\.json$/.test(rel)) continue;
    const doc = readJson(rootAbs, rel, errors);
    if (doc) schemaCheck('public-projection.schema.json', doc, rel, errors);
  }

  // G14.04.b (issue #303): the locale facts of this tree, derived with the
  // same rules build-bundle applies when it computes the index (09 §8:
  // «каталог паказвае наяўныя локалі па факце» — publication is per-locale,
  // the fact here is the shipped base/stops.json; an audio locale when its
  // base audio carries files). Any top-level directory passes these matches;
  // the packager additionally narrows to its own allowlist, so this fact set
  // is only the wider one — it errs toward rejections, never false passes.
  const textFacts = new Set();
  const audioFacts = new Set();
  for (const rel of files) {
    const textM = rel.match(/^([^/]+)\/base\/stops\.json$/);
    if (textM) textFacts.add(textM[1]);
    const audioM = rel.match(/^([^/]+)\/base\/audio\/.+\.m4a$/);
    if (audioM) audioFacts.add(audioM[1]);
  }

  // Ids and duplicates. A place ref may pin a content_version, so places map
  // id -> versions; voices, themes, collections and stops need plain sets.
  const placeVersions = new Map();
  places.forEach((p, i) => {
    if (!placeVersions.has(p.id)) placeVersions.set(p.id, new Set());
    else diag(errors, 'error', 'duplicate-id', `places.json[${i}]#${p.id}`);
    placeVersions.get(p.id).add(p.content_version);
  });
  const voiceIds = checkUniqueId(voices, 'id', 'voices.json', errors);
  // G03.04: a place's name-audio refs point at Media records; a Media
  // record's voice must exist and speak the record's own locale.
  places.forEach((p, i) => {
    const refs = p?.name_audio_refs;
    if (refs === null || typeof refs !== 'object' || Array.isArray(refs)) return;
    for (const [locale, mediaId] of Object.entries(refs)) {
      if (!mediaIds.has(mediaId)) diag(errors, 'error', 'unknown-ref', `places.json[${i}].name_audio_refs.${locale}#${mediaId}`);
    }
  });
  media.forEach((record, i) => {
    if (record?.voice_id === undefined) return;
    if (!voiceIds.has(record.voice_id)) diag(errors, 'error', 'unknown-ref', `media.json[${i}]#voice_id#${record.voice_id}`);
    const voice = voices.find((v) => v.id === record.voice_id);
    if (voice && voice.locale !== record.locale) diag(errors, 'error', 'voice-locale-mismatch', `media.json[${i}]`);
  });
  // A moment is a teaser of an existing story at an existing place; its
  // manifest cannot invent either (ADR G01.02 §3.1 anchors the manual-only
  // playback, the schema anchors the field set).
  const storyIds = new Set();
  for (const layers of locales.values()) {
    for (const layer of Object.values(layers)) for (const id of layer.ids) storyIds.add(id);
  }
  moments.forEach((moment, i) => {
    if (moment?.place_id !== undefined && !placeVersions.has(moment.place_id)) {
      diag(errors, 'error', 'unknown-ref', `moments.json[${i}]#place_id#${moment.place_id}`);
    }
    if (moment?.story_id !== undefined && !storyIds.has(moment.story_id)) {
      diag(errors, 'error', 'unknown-ref', `moments.json[${i}]#story_id#${moment.story_id}`);
    }
  });
  const themeIds = checkUniqueId(asArray(discovery?.themes, 'discovery.json#themes', errors), 'id', 'discovery.json#themes', errors);
  const collectionVersions = new Map();
  asArray(discovery?.collections, 'discovery.json#collections', errors).forEach((c, i) => {
    if (collectionVersions.has(c.collection_id)) diag(errors, 'error', 'duplicate-id', `discovery.json#collections[${i}]#${c.collection_id}`);
    collectionVersions.set(c.collection_id, c.content_version);
  });
  const stopIds = new Set();
  stops.forEach((stop, i) => {
    if (stopIds.has(stop.id)) diag(errors, 'error', 'duplicate-stop-id', `route.json#stops[${i}]#${stop.id}`);
    stopIds.add(stop.id);
    if (!placeVersions.has(stop.place_id)) diag(errors, 'error', 'unknown-ref', `route.json#stops[${i}].place_id#${stop.place_id}`);
  });

  // Stories: duplicates and per-file facts, then the route's story refs must
  // resolve in every locale that ships the layer (per-locale completeness is
  // a computed query — 09 §3 invariant 8).
  for (const [locale, layers] of locales) {
    for (const tier of ['base', 'extended']) {
      const layer = layers[tier];
      if (!layer) continue;
      checkUniqueId(layer.stories, 'story_id', `${locale}/${tier}/stops.json`, errors);
      // 09 §3: a story's primary media is <locale>/<tier>/audio/<story_id>.m4a.
      // A layer declares itself text-only by shipping no audio directory at
      // all; once the directory ships, every story in the layer needs its
      // file — an emptied directory still counts as shipping audio
      // (round-3 review: only orphan audio was checked, not presence).
      const layerShipsAudio = fs.existsSync(path.join(rootAbs, locale, tier, 'audio'));
      layer.stories.forEach((story, i) => {
        const at = `${locale}/${tier}/stops.json[${i}]`;
        if (story.tier !== tier) diag(errors, 'error', 'tier-mismatch', at);
        if (layerShipsAudio && story.story_id !== undefined && !files.includes(`${locale}/${tier}/audio/${story.story_id}.m4a`)) {
          diag(errors, 'error', 'missing-media', `${at}#audio`);
        }
        if (!placeVersions.has(story.place_id)) diag(errors, 'error', 'unknown-ref', `${at}#place_id#${story.place_id}`);
        if (!voiceIds.has(story.voice_id)) diag(errors, 'error', 'unknown-ref', `${at}#voice_id#${story.voice_id}`);
        const voice = voices.find((v) => v.id === story.voice_id);
        if (voice && voice.locale !== locale) diag(errors, 'error', 'voice-locale-mismatch', at);
        if (story.review?.decision !== 'approved') diag(errors, 'error', 'content-not-approved', `${at}#review`);
      });
      stops.forEach((stop, i) => {
        const storyId = stop[`story_${tier}_id`];
        if (storyId && !layer.ids.has(storyId)) {
          diag(errors, 'error', 'unknown-ref', `route.json#stops[${i}].story_${tier}_id#${storyId}@${locale}`);
        }
      });
    }
  }

  // Discovery offers and collections against the package tree (the reader's
  // named rules cover the index-internal side: duplicate refs, foreign city,
  // nested collections, missing overlap note, duration range). The reader
  // walks index.offers/collections unguarded, so the validator feeds it a
  // sanitized shallow copy — garbage shapes become diagnostics above.
  if (discovery) {
    const offers = asArray(discovery.offers, 'discovery.json#offers', errors);
    const collections = asArray(discovery.collections, 'discovery.json#collections', errors);
    for (const e of checkIndexRules({ ...discovery, offers, collections: readerSafeCollections(collections) }).errors) diag(errors, 'error', e.rule, `discovery.json#${e.path}`);
    offers.forEach((offer, i) => {
      const at = `discovery.json#offers[${i}]`;
      asArray(offer.themes, `${at}.themes`, errors).forEach((themeId) => {
        if (!themeIds.has(themeId)) diag(errors, 'error', 'unknown-ref', `${at}.themes#${themeId}`);
      });
      const start = offer.suggested_start_place_id;
      if (start && !placeVersions.has(start)) diag(errors, 'error', 'unknown-ref', `${at}.suggested_start_place_id#${start}`);
      const ref = offer.ref ?? {};
      const guideAlien = ref.kind === 'guide' && (ref.route_id !== route?.route_id || ref.version !== route?.version);
      const placeAlien = ref.kind === 'place' && !placeVersions.get(ref.place_id)?.has(ref.content_version);
      const collectionAlien = ref.kind === 'collection' && collectionVersions.get(ref.collection_id) !== ref.content_version;
      if (guideAlien || placeAlien || collectionAlien) diag(errors, 'error', 'unknown-ref', `${at}.ref#${ref.route_id ?? ref.place_id ?? ref.collection_id}`);
      checkDetailRef(offer, at, files, errors);
      // 21 §3.2: a guide offer's duration range must include Route.duration_min.
      if (ref.kind === 'guide' && route && offer.estimated_duration) {
        const { min_minutes, max_minutes } = offer.estimated_duration;
        if (route.duration_min < min_minutes || route.duration_min > max_minutes) {
          diag(errors, 'error', 'guide-duration-not-in-range', `${at}.estimated_duration`);
        }
      }
      // G14.04.b (issue #303): availability is computed from shipped content,
      // never promised (21 §3.2 «вылічаецца з апублікаванага зместу») — a
      // claimed locale without its files in this tree is «гатовае» без файлаў.
      const availability = offer.availability;
      if (availability === undefined || availability === null) {
        // No claim — the packager computes the triples for the assembled index.
      } else if (typeof availability !== 'object' || Array.isArray(availability)) {
        diag(errors, 'error', 'type', `${at}.availability#$`);
      } else {
        new Set(asArray(availability.text_locales, `${at}.availability.text_locales`, errors)).forEach((locale) => {
          if (!textFacts.has(locale)) diag(errors, 'error', 'text-locale-without-files', `${at}.availability.text_locales#${locale}`);
        });
        new Set(asArray(availability.audio_locales, `${at}.availability.audio_locales`, errors)).forEach((locale) => {
          if (!audioFacts.has(locale)) diag(errors, 'error', 'audio-locale-without-files', `${at}.availability.audio_locales#${locale}`);
        });
      }
    });
    collections.forEach((c, i) => {
      const at = `discovery.json#collections[${i}]`;
      asArray(c.members, `${at}.members`, errors).forEach((member, j) => {
        const memberAlien = member.kind === 'place'
          ? !placeVersions.get(member.place_id)?.has(member.content_version)
          : member.kind === 'guide' && (member.route_id !== route?.route_id || member.version !== route?.version);
        if (memberAlien) diag(errors, 'error', 'unknown-ref', `${at}.members[${j}]#${member.place_id ?? member.route_id}`);
      });
    });
  }

  // Media: declared file references must exist and stay inside the package;
  // an audio file belongs to the story carrying its name in that locale × tier.
  const checkMediaFile = (rel, at) => {
    if (!rel) return;
    if (!safeRelPath(rel)) diag(errors, 'error', 'unsafe-path', at);
    else if (!files.includes(rel)) diag(errors, 'error', 'missing-media', `${at}#${rel}`);
  };
  checkMediaFile(route?.cover, 'route.json#cover');
  places.forEach((p, i) => checkMediaFile(p.photo, `places.json[${i}]#photo`));
  for (const rel of files) {
    const m = rel.match(/^([^/]+)\/(base|extended)\/audio\/(.+)\.m4a$/);
    const layer = m && locales.get(m[1])?.[m[2]];
    if (layer && !layer.ids.has(m[3])) diag(errors, 'error', 'orphan-media', rel);
  }

  // A feedback-target registry in the handoff tree is validated as part of
  // the package. The G02.03 packager emits {schema_version, status, targets}
  // (a bare array from an older handoff is still accepted); collections are
  // not feedback targets (21 §5.2), so a wrong-kind entry fails the target
  // schema's oneOf.
  const registryRel = 'release/feedback-target-registry.json';
  if (files.includes(registryRel)) {
    const registry = readJson(rootAbs, registryRel, errors);
    const targets = registry && typeof registry === 'object' && !Array.isArray(registry)
      ? asArray(registry.targets, `${registryRel}#targets`, errors)
      : asArray(registry, registryRel, errors);
    targets.forEach((target, i) => {
      schemaCheck('feedback-target.schema.json', target, `${registryRel}#targets[${i}]`, errors);
    });
  }

  // 09 §3 invariant 6: overlapping geofences are a warning for the field
  // check, never a rejection — two stories on one square are legitimate.
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      const a = places[i];
      const b = places[j];
      if (haversineMeters(a.lat, a.lng, b.lat, b.lng) < a.trigger_radius_m + b.trigger_radius_m) {
        diag(warnings, 'warning', 'radius-overlap', `places.json#${a.id}+${b.id}`);
      }
    }
  }

  if (options.previous) checkStopStability(route, options.previous, errors);

  return { ok: errors.length === 0, errors, warnings };
}

// Criterion 5: fixtures/discovery-contract/ is the conformance set. Index
// fixtures flow through the schema, the reader's named rules and the
// index-level checks this validator owns (theme refs, duplicate theme and
// collection ids, safe detail_ref paths).
export function validateDiscoveryIndex(index) {
  const errors = [];
  schemaCheck('discovery-index.schema.json', index, 'discovery.json', errors);
  if (!index || typeof index !== 'object') return { ok: false, errors };
  const offers = asArray(index.offers, 'discovery.json#offers', errors);
  const collections = asArray(index.collections, 'discovery.json#collections', errors);
  for (const e of checkIndexRules({ ...index, offers, collections: readerSafeCollections(collections) }).errors) diag(errors, 'error', e.rule, `discovery.json#${e.path}`);
  const themeIds = checkUniqueId(asArray(index.themes, 'discovery.json#themes', errors), 'id', 'discovery.json#themes', errors);
  const collectionIds = checkUniqueId(collections, 'collection_id', 'discovery.json#collections', errors);
  offers.forEach((offer, i) => {
    const at = `discovery.json#offers[${i}]`;
    asArray(offer.themes, `${at}.themes`, errors).forEach((themeId) => {
      if (!themeIds.has(themeId)) diag(errors, 'error', 'unknown-ref', `${at}.themes#${themeId}`);
    });
    const ref = offer.ref ?? {};
    if (ref.kind === 'collection' && !collectionIds.has(ref.collection_id)) {
      diag(errors, 'error', 'unknown-ref', `${at}.ref#${ref.collection_id}`);
    }
    if (offer.detail_ref?.path && !safeRelPath(offer.detail_ref.path)) {
      diag(errors, 'error', 'unsafe-path', `${at}.detail_ref.path`);
    }
    // G03.04 criterion 4: audio claimed in a locale that has no text claims
    // a recording without a transcript (09 §3 invariant 1).
    const availability = offer.availability;
    if (availability !== null && typeof availability === 'object' && !Array.isArray(availability)) {
      const text = new Set(asArray(availability.text_locales, `${at}.availability.text_locales`, errors));
      asArray(availability.audio_locales, `${at}.availability.audio_locales`, errors).forEach((locale) => {
        if (!text.has(locale)) diag(errors, 'error', 'audio-without-text', `${at}.availability.audio_locales#${locale}`);
      });
    }
  });
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let missingValue = null;
  const get = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    if (i + 1 >= args.length) {
      missingValue = flag;
      return undefined;
    }
    return args[i + 1];
  };
  const dir = get('--in');
  if (!dir || missingValue) {
    console.error('usage: validate-package.mjs --in <package-dir> [--against <previous-package-dir>]');
    process.exitCode = 2;
  } else {
    const previous = get('--against');
    const result = validatePackage(dir, previous ? { previous } : {});
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
}
