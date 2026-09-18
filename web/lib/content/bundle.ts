// Disk layer over the build-bundle public output (build time only; the readers
// above stay pure). Layout verbatim from tools/build-bundle/README.md:
//   public/bundle/<route_id>/<version>/route.json
//   public/bundle/<route_id>/<version>/<locale>/base/{stops.json,previews.json}
//   public/places/<place_id>/public.json
//   public/collections/<collection_id>/public.json
//   public/discovery/<city_id>/<revision>/index.json
import fs from 'node:fs';
import path from 'node:path';
import { schemaCheck } from './contract.ts';
import {
  readBaseStories,
  readCatalog,
  readDiscoveryIndex as readIndexDoc,
  readPreviews,
  readPublicProjection,
  readRoute,
} from './readers.ts';
import type {
  CatalogView,
  DiscoveryIndex,
  LockedStopPreview,
  Locale,
  PublicProjection,
  ReadResult,
  RouteDoc,
  Story,
} from './types.ts';

// Identifiers used as path pieces must be contract identifiers before they
// reach the filesystem. The identifier pattern allows dots, so '.' and '..'
// are rejected explicitly — they must never traverse out of the content root.
function isSafeId(value: string): boolean {
  return value !== '.' && value !== '..' && schemaCheck('schemas/identifier.schema.json', value).length === 0;
}

function isKnownLocale(locale: string): locale is Locale {
  return schemaCheck('schemas/localized-text.schema.json', { [locale]: 'probe' }).length === 0;
}

type JsonLoad = { ok: true; doc: unknown } | { ok: false; code: 'invalid-json' | 'not-found' };

function loadJson(file: string): JsonLoad {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, code: 'not-found' };
  }
  try {
    return { ok: true, doc: JSON.parse(text) };
  } catch {
    return { ok: false, code: 'invalid-json' };
  }
}

// Loads one bundle file behind identifier-checked path pieces and hands the
// parsed document to its pure reader. The root itself is caller-controlled.
function readBundleDoc<T>(
  publicRoot: string,
  pieces: string[],
  file: string,
  validate: (doc: unknown) => ReadResult<T>,
): ReadResult<T> {
  for (const piece of pieces) {
    if (!isSafeId(piece)) return { ok: false, code: 'unsafe-path', errors: [{ rule: 'unsafe-path', path: piece }] };
  }
  const loaded = loadJson(path.join(publicRoot, ...pieces, file));
  if (!loaded.ok) return { ok: false, code: loaded.code, errors: [{ rule: loaded.code, path: file }] };
  return validate(loaded.doc);
}

// The catalog envelope sits at the public root (interim G10.01.b location —
// the real pointer publication belongs to G02.04).
export function readBundleCatalog(publicRoot: string): ReadResult<CatalogView> {
  return readBundleDoc(publicRoot, [], 'catalog.json', readCatalog);
}

export function readBundleRoute(publicRoot: string, routeId: string, version: string): ReadResult<RouteDoc> {
  return readBundleDoc(publicRoot, ['bundle', routeId, version], 'route.json', readRoute);
}

export function readBundleBaseStories(
  publicRoot: string,
  routeId: string,
  version: string,
  locale: string,
): ReadResult<Story[]> {
  if (!isKnownLocale(locale)) return { ok: false, code: 'unknown-locale', errors: [{ rule: 'unknown-locale', path: locale }] };
  return readBundleDoc(publicRoot, ['bundle', routeId, version, locale, 'base'], 'stops.json', readBaseStories);
}

export function readBundlePreviews(
  publicRoot: string,
  routeId: string,
  version: string,
  locale: string,
): ReadResult<LockedStopPreview[]> {
  if (!isKnownLocale(locale)) return { ok: false, code: 'unknown-locale', errors: [{ rule: 'unknown-locale', path: locale }] };
  return readBundleDoc(publicRoot, ['bundle', routeId, version, locale, 'base'], 'previews.json', readPreviews);
}

export function readPlaceProjection(publicRoot: string, placeId: string): ReadResult<PublicProjection> {
  return readBundleDoc(publicRoot, ['places', placeId], 'public.json', readPublicProjection);
}

export function readBundleDiscoveryIndex(publicRoot: string, cityId: string, revision: string): ReadResult<DiscoveryIndex> {
  return readBundleDoc(publicRoot, ['discovery', cityId, revision], 'index.json', readIndexDoc);
}
