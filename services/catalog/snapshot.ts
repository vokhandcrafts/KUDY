// G20.32: rebuildable, public-only projections in the existing zone-A
// catalog_cache table. Never store raw origin responses, credentials, signed
// media grants or the zone-B walk/session state in this cache.
import type { SqlDriver } from '../db/types.ts';
import type { CatalogGuideCard, GuidePreview } from './types.ts';

export interface CatalogSnapshotPort {
  read(key: string): string | null;
  write(key: string, payload: string): void;
}

export function catalogSnapshotOver(driver: SqlDriver): CatalogSnapshotPort {
  return {
    read: (key) => {
      const row = driver.prepare('SELECT payload FROM catalog_cache WHERE route_id = ?').get(key);
      return row ? String(row.payload) : null;
    },
    write: (key, payload) => {
      driver.prepare(
        'INSERT INTO catalog_cache (route_id, payload) VALUES (?, ?) ON CONFLICT(route_id) DO UPDATE SET payload = excluded.payload',
      ).run(key, payload);
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function string(value: unknown): value is string {
  return typeof value === 'string';
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(string);
}
function optionalText(value: unknown): value is string | null {
  return value === null || string(value);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function nonNegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}
function duration(value: unknown): boolean {
  return value === null || (record(value) &&
    Object.keys(value).every((key) => ['min_minutes', 'max_minutes', 'basis'].includes(key)) &&
    nonNegative(value.min_minutes) && nonNegative(value.max_minutes) &&
    string(value.basis));
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
const CARD_KEYS = [
  'routeId', 'version', 'offerId', 'title', 'summary', 'textLocales', 'audioLocales',
  'localesKnown', 'access', 'editorialOrder', 'estimatedDuration',
] as const;

function card(value: unknown): value is CatalogGuideCard {
  if (!record(value) || !onlyKeys(value, CARD_KEYS)) return false;
  return string(value.routeId) && value.routeId.length > 0 &&
    string(value.version) && value.version.length > 0 &&
    optionalText(value.offerId) && string(value.title) &&
    optionalText(value.summary) && strings(value.textLocales) && strings(value.audioLocales) &&
    typeof value.localesKnown === 'boolean' &&
    (value.access === 'free' || value.access === 'mixed' || value.access === 'paid') &&
    (value.editorialOrder === null || finite(value.editorialOrder)) &&
    duration(value.estimatedDuration);
}

const STOP_KEYS = [
  'stopId', 'position', 'placeId', 'placeName', 'tier', 'locked',
  'name', 'announce', 'optional',
] as const;
function stop(value: unknown): boolean {
  if (!record(value) || !onlyKeys(value, STOP_KEYS)) return false;
  return string(value.stopId) && value.stopId.length > 0 &&
    Number.isInteger(value.position) && nonNegative(value.position) &&
    string(value.placeId) && value.placeId.length > 0 &&
    optionalText(value.placeName) && (value.tier === 'base' || value.tier === 'extended') &&
    typeof value.locked === 'boolean' && optionalText(value.name) &&
    optionalText(value.announce) && typeof value.optional === 'boolean';
}
const PREVIEW_KEYS = [
  'routeId', 'version', 'title', 'summary', 'themes', 'textLocales', 'audioLocales',
  'localesKnown', 'access', 'routeAccess', 'productId', 'estimatedDuration',
  'durationMin', 'freeStopCount', 'baseSizeBytes', 'stops', 'degradedRouteDoc',
] as const;
function preview(value: unknown): value is GuidePreview {
  if (!record(value) || !onlyKeys(value, PREVIEW_KEYS)) return false;
  return string(value.routeId) && value.routeId.length > 0 &&
    string(value.version) && value.version.length > 0 && string(value.title) &&
    optionalText(value.summary) && Array.isArray(value.themes) &&
    value.themes.every((theme: unknown) => record(theme) &&
      onlyKeys(theme, ['id', 'label']) && string(theme.id) && string(theme.label)) &&
    strings(value.textLocales) && strings(value.audioLocales) &&
    typeof value.localesKnown === 'boolean' &&
    (value.access === 'free' || value.access === 'paid' || value.access === 'mixed') &&
    (value.routeAccess === 'free_base' || value.routeAccess === 'paid' || value.routeAccess === null) &&
    optionalText(value.productId) && duration(value.estimatedDuration) &&
    (value.durationMin === null || nonNegative(value.durationMin)) &&
    (value.freeStopCount === null || nonNegative(value.freeStopCount)) &&
    (value.baseSizeBytes === null || nonNegative(value.baseSizeBytes)) &&
    (value.stops === null || (Array.isArray(value.stops) && value.stops.every(stop))) &&
    optionalText(value.degradedRouteDoc);
}

export type SnapshotRead<T> =
  | { kind: 'ready'; value: T }
  | { kind: 'missing' }
  | { kind: 'corrupt' };

function read<T>(store: CatalogSnapshotPort | undefined, key: string, valid: (value: unknown) => value is T): SnapshotRead<T> {
  if (!store) return { kind: 'missing' };
  try {
    const serialized = store.read(key);
    if (serialized === null) return { kind: 'missing' };
    const parsed: unknown = JSON.parse(serialized);
    return valid(parsed) ? { kind: 'ready', value: parsed } : { kind: 'corrupt' };
  } catch {
    return { kind: 'corrupt' };
  }
}

function key(prefix: string, identity: string, localePreference: readonly string[]): string {
  return JSON.stringify([prefix, identity, localePreference]);
}

// The empty preference identifies the latest verified *display projection*,
// not a translation. If the UI language changes while offline, the last
// published labels remain visible with the existing offline indication.
// A locale-specific snapshot still wins whenever one exists. Both keys
// live in rebuildable zone A and use the same strict public-only validator.
function latestKey(prefix: string, identity: string): string {
  return key(prefix, identity, []);
}

export function readGuides(store: CatalogSnapshotPort | undefined, localePreference: readonly string[]): SnapshotRead<readonly CatalogGuideCard[]> {
  const valid = (value: unknown): value is CatalogGuideCard[] =>
    Array.isArray(value) && value.every(card);
  const localized = read(store, key('guides:v1', '', localePreference), valid);
  // Never hide corruption of the selected locale's snapshot behind another
  // language. Only a genuinely missing locale projection may fall back.
  return localized.kind === 'missing'
    ? read(store, latestKey('guides:v1', ''), valid)
    : localized;
}

export function readPreview(store: CatalogSnapshotPort | undefined, routeId: string, localePreference: readonly string[]): SnapshotRead<GuidePreview> {
  const localized = read(store, key('preview:v1', routeId, localePreference), preview);
  const cached = localized.kind === 'missing'
    ? read(store, latestKey('preview:v1', routeId), preview)
    : localized;
  if (cached.kind !== 'ready') return cached;
  // This identity check also covers the cross-locale fallback. The service
  // separately pins cached.version to the currently published route version.
  return cached.value.routeId === routeId ? cached : { kind: 'corrupt' };
}

export function writeGuides(store: CatalogSnapshotPort | undefined, localePreference: readonly string[], guides: readonly CatalogGuideCard[]): void {
  if (!store) return;
  const payload = JSON.stringify(guides);
  try {
    // Write the fallback first: if the second write fails, a new UI language
    // can still read the latest verified projection after an offline restart.
    store.write(latestKey('guides:v1', ''), payload);
    store.write(key('guides:v1', '', localePreference), payload);
  } catch {
    // The online view remains usable; the next offline load reports missing
    // cache rather than claiming a durable snapshot was written.
  }
}
export function writePreview(store: CatalogSnapshotPort | undefined, localePreference: readonly string[], value: GuidePreview): void {
  if (!store) return;
  const payload = JSON.stringify(value);
  try {
    store.write(latestKey('preview:v1', value.routeId), payload);
    store.write(key('preview:v1', value.routeId, localePreference), payload);
  } catch {
    // A transient derived-cache write failure cannot affect downloads or walks.
  }
}
