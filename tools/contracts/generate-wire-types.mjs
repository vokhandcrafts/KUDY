// G20.19 (issue #490) — deterministic generator of the schema-owned wire
// types. The contracts schemas are the single owner of the wire formats
// (specification §V4: "Схемы ў contracts/ застаюцца ўладальнікамі фармату
// даных"); this script projects them verbatim into contracts/wire/wire-types.ts
// so the TS consumers (web wire types, bundle-docs fixtures) never restate a
// field by hand. It reads the canonical sources on every run — the locale
// allowlist comes from localized-text.schema.json (its owner), never from a
// second hand-written list — and the compatibility assertions below fail
// closed when a schema drifts from the owner it must mirror.
//
// Modes:
//   node tools/contracts/generate-wire-types.mjs            (re)write the output
//   node tools/contracts/generate-wire-types.mjs --check    fail when stale
//   --schemas <dir>   schema directory   (default: <repo>/contracts/schemas)
//   --out <file>      output module      (default: <repo>/contracts/wire/wire-types.ts)
//
// What is deliberately NOT projected: the legacy-v0 / unknown-major envelope
// policies and the intentionally looser device projections (services/catalog/
// envelope.ts, RouteDocFacts) — those are separate documented models, not
// schema defects. Conditional requirements (stop.schema.json allOf if/then),
// string patterns and numeric limits stay runtime work of contracts/reader.mjs;
// this projection does not replace that validation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_SCHEMAS = path.join(REPO_ROOT, 'contracts', 'schemas');
const DEFAULT_OUT = path.join(REPO_ROOT, 'contracts', 'wire', 'wire-types.ts');

function fail(message) {
  console.error(`generate-wire-types: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { schemas: DEFAULT_SCHEMAS, out: DEFAULT_OUT, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      opts.check = true;
    } else if (arg === '--schemas' || arg === '--out') {
      const raw = argv[i + 1];
      if (raw === undefined || raw === '') fail(`${arg} needs a value`);
      opts[arg === '--schemas' ? 'schemas' : 'out'] = path.resolve(raw);
      i += 1;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function readSchema(dir, name) {
  const file = path.join(dir, name);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    fail(`cannot read schema: ${file}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`invalid JSON in ${file}: ${error.message}`);
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// An object property of a schema, reached by explicit property names.
function prop(schema, name, what) {
  const node = isObject(schema) && isObject(schema.properties) ? schema.properties[name] : undefined;
  if (node === undefined) fail(`${what}: schema has no property ${name}`);
  return node;
}

function itemsOf(node, what) {
  if (!isObject(node) || !isObject(node.items)) fail(`${what}: no items schema`);
  return node.items;
}

function enumOf(node, what) {
  if (!isObject(node) || !Array.isArray(node.enum)) fail(`${what}: no enum`);
  return node.enum;
}

function requiredOf(node, what) {
  if (!isObject(node) || !Array.isArray(node.required)) fail(`${what}: no required list`);
  return node.required;
}

function assertSameSet(owner, mirror, what) {
  const a = [...owner].sort().join(',');
  const b = [...mirror].sort().join(',');
  if (a !== b) {
    fail(`${what} diverges from its canonical owner: [${mirror.join(', ')}] vs owner [${owner.join(', ')}]`);
  }
}

export function extractSchemas(schemasDir) {
  const localizedText = readSchema(schemasDir, 'localized-text.schema.json');
  const catalog = readSchema(schemasDir, 'catalog.schema.json');
  const route = readSchema(schemasDir, 'route.schema.json');
  const stop = readSchema(schemasDir, 'stop.schema.json');

  // Owner of the locale allowlist: localized-text.schema.json (propertyNames).
  const ownerLocales = isObject(localizedText) &&
    isObject(localizedText.propertyNames) && Array.isArray(localizedText.propertyNames.enum)
    ? localizedText.propertyNames.enum
    : null;
  if (!ownerLocales || ownerLocales.length === 0) {
    fail('localized-text.schema.json propertyNames.enum is missing or empty — the allowlist owner must speak first');
  }
  if (ownerLocales.some((l) => typeof l !== 'string')) {
    fail('localized-text.schema.json propertyNames.enum carries a non-string locale');
  }

  // Derived lists must stay compatible with the schemas that mirror the owner.
  const routeItems = itemsOf(prop(catalog, 'routes', 'catalog.schema.json'), 'catalog.routes');
  const catalogLocales = enumOf(itemsOf(prop(routeItems, 'locales', 'catalog.routes[]'), 'catalog.routes[].locales'), 'catalog.routes[].locales');
  assertSameSet(ownerLocales, catalogLocales, 'catalog.schema.json routes[].locales enum');

  // catalog.layers items and stop.access_tier describe one tier domain; assert
  // it once so a split domain fails here instead of silently typing apart.
  const catalogLayers = enumOf(itemsOf(prop(routeItems, 'layers', 'catalog.routes[]'), 'catalog.routes[].layers'), 'catalog.routes[].layers');
  const stopTier = enumOf(prop(stop, 'access_tier', 'stop.schema.json'), 'stop.schema.json access_tier');
  assertSameSet(catalogLayers, stopTier, 'stop.schema.json access_tier enum');

  // The inline projections below hardcode these two shapes; a schema change
  // here must fail loudly instead of being silently left out of the types.
  const sizes = prop(routeItems, 'sizes', 'catalog.routes[]');
  assertSameSet(
    ['base', 'extended'],
    Object.keys(isObject(sizes) && isObject(sizes.properties) ? sizes.properties : {}),
    'catalog.routes[].sizes properties',
  );
  assertSameSet(['base'], requiredOf(sizes, 'catalog.routes[].sizes'), 'catalog.routes[].sizes required');
  const stopPreview = prop(stop, 'preview', 'stop.schema.json');
  assertSameSet(
    ['announce', 'name'],
    Object.keys(isObject(stopPreview) && isObject(stopPreview.properties) ? stopPreview.properties : {}),
    'stop.preview properties',
  );
  const stopPreviewName = prop(stopPreview, 'name', 'stop.preview');
  const stopPreviewAnnounce = prop(stopPreview, 'announce', 'stop.preview');
  for (const [what, refNode] of [['stop.preview.name', stopPreviewName], ['stop.preview.announce', stopPreviewAnnounce]]) {
    if (!isObject(refNode) || refNode.$ref !== '../schemas/localized-text.schema.json') {
      fail(`${what}: $ref must stay on localized-text.schema.json`);
    }
  }
  const routeStops = itemsOf(prop(route, 'stops', 'route.schema.json'), 'route.stops');
  if (!isObject(routeStops) || routeStops.$ref !== '../schemas/stop.schema.json') {
    fail('route.stops: $ref must stay on stop.schema.json');
  }

  return { ownerLocales, catalogLayers, routeItems, catalogPointer: prop(catalog, 'discovery_index', 'catalog.schema.json'), route, stop };
}

// Field projection: optionality comes from the node's required list, the type
// expression from the map below. An unprojected field fails the generation
// (fail closed) instead of silently dropping from the wire types. Patterns,
// formats, min/max and the stop.schema.json allOf conditionals are runtime
// work of contracts/reader.mjs and are never encoded here.
function fieldsOf(node, what, typeByField) {
  if (!isObject(node) || !isObject(node.properties)) fail(`${what}: no properties`);
  const required = new Set(requiredOf(node, what));
  const lines = [];
  for (const [field, spec] of Object.entries(node.properties)) {
    const type = typeByField[field];
    if (type === undefined) fail(`${what}: no projection rule for field ${field}`);
    lines.push(`  ${field}${required.has(field) ? '' : '?'}: ${type};`);
  }
  return lines;
}

export function renderWireTypes({ ownerLocales, catalogLayers, routeItems, catalogPointer, route, stop }) {

  const catalogRouteEntry = fieldsOf(routeItems, 'catalog.routes[]', {
    route_id: 'string', // identifier.schema.json — pattern runtime-validated
    version: 'string',
    locales: 'Locale[]',
    layers: 'Tier[]',
    product_id: 'string',
    sizes: '{ base: number; extended?: number }',
  });
  const pointerFields = fieldsOf(catalogPointer, 'catalog.discovery_index', {
    schema_version: '1', // const 1 — the only authoritative major today
    revision: 'string',
    path: 'string',
    bytes: 'number',
    sha256: 'string',
  });
  const routeStopFields = fieldsOf(stop, 'stop.schema.json', {
    origin: "'official' | 'imported'",
    id: 'string',
    position: 'number',
    place_id: 'string',
    access_tier: 'Tier',
    story_base_id: 'string',
    story_extended_id: 'string',
    trigger_radius_m: 'number',
    optional: 'boolean',
    preview: '{ name: LocalizedText; announce: LocalizedText }',
  });
  const routeDocFields = fieldsOf(route, 'route.schema.json', {
    origin: "'official' | 'imported'",
    route_id: 'string',
    version: 'string',
    city_id: 'string',
    access: "'free_base' | 'paid'",
    product_id_route: 'string',
    product_id_extension: 'string',
    distance_m: 'number',
    duration_min: 'number',
    cover: 'string',
    polyline: 'string',
    published: 'boolean',
    free_stop_count: 'number',
    stops: 'RouteStop[]',
  });

  const q = (value) => `'${String(value).replaceAll("'", "\\'")}'`;
  const locales = ownerLocales.map(q).join(' | ');
  const tier = catalogLayers.map(q).join(' | ');

  return `// GENERATED FILE — do not edit by hand.
// Generated by tools/contracts/generate-wire-types.mjs from the contracts
// schemas; regenerate with \`npm run contracts:wire\`, verify freshness with
// \`npm run contracts:wire:check\` (G20.19, issue #490; specification §V4).
// Sources: contracts/schemas/{localized-text,catalog,route,stop}.schema.json.
// The locale allowlist owner is localized-text.schema.json — every locale
// list below is derived from it, never re-declared.
// Not projected here on purpose: the legacy-v0 / unknown-major envelope
// policies and the looser device projections (services/catalog/envelope.ts);
// identifier/pattern/limit rules and the stop allOf conditionals
// (extended→story_extended_id, base→story_base_id) stay runtime-validated by
// contracts/reader.mjs — this projection does not replace that validation.

// Locale allowlist owner: localized-text.schema.json propertyNames.enum.
export const SCHEMA_LOCALES = [${ownerLocales.map(q).join(', ')}] as const;
export type Locale = ${locales};

// localized-text.schema.json: a subset of the allowlist mapped to non-empty strings.
export type LocalizedText = { [K in Locale]?: string };

// Tier domain: catalog.schema.json routes[].layers items, shared with
// stop.schema.json access_tier (asserted equal by the generator).
export type Tier = ${tier};

// catalog.schema.json routes[] — v1 wire shape, field names verbatim.
export interface CatalogRouteEntry {
${catalogRouteEntry.join('\n')}
}

// catalog.schema.json discovery_index — the versioned pointer to one city's
// index file; bytes/sha256 are verified before loading (reader.mjs).
export interface CatalogPointer {
${pointerFields.join('\n')}
}

// The validated v1 envelope as consumers see it: the reader policy owns
// catalog_schema_version/generated_at (the web renders the v1 envelope only),
// so the view projection carries the schema-owned members below.
export interface CatalogView {
  routes: CatalogRouteEntry[];
  discovery_index: CatalogPointer | null;
}

// stop.schema.json — one entry of route.json stops[].
export interface RouteStop {
${routeStopFields.join('\n')}
}

// route.schema.json — the bundle's route.json.
export interface RouteDoc {
${routeDocFields.join('\n')}
}
`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const extracted = extractSchemas(opts.schemas);
  const rendered = renderWireTypes(extracted);

  let onDisk = null;
  try {
    onDisk = fs.readFileSync(opts.out, 'utf8');
  } catch {
    if (opts.check) fail(`stale or missing output: ${opts.out} — regenerate with "npm run contracts:wire"`);
  }
  if (opts.check) {
    if (onDisk !== rendered) fail(`stale output: ${opts.out} does not match the schemas — regenerate with "npm run contracts:wire"`);
    console.log('wire-types: OK (fresh)');
    return;
  }
  if (onDisk === rendered) {
    console.log(`wire-types: already fresh (${opts.out})`);
    return;
  }
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, rendered);
  console.log(`wire-types: written (${opts.out})`);
}

// CLI only — the extract/render pair is importable for the guard tests
// (tools/contracts/wire-types.test.mjs) that prove staleness detection.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
