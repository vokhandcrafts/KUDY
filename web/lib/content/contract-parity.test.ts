// TR-5 levels 2+3 (docs/architecture/23_technical_remarks.md) — behavioral
// tests through the real web reader and the key-parity guard, on the SAME
// fixtures the contentRepo reader tests use (contracts/fixtures/bundle-docs.ts).
// A contract drift on either reader fails on the same input; the typed
// fixture assignments make the compile step reject a restatement that drops a
// schema field, and the key-parity assertions reject a schema that grows a
// field the restatement does not carry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  catalogEntry,
  catalogEntryWithoutSizes,
  catalogEnvelope,
  nullRouteText,
  routeDoc,
  routeDocWithLegacyAccess,
} from '../../../contracts/fixtures/bundle-docs.ts';
import { readCatalog, readRoute } from './readers.ts';
import type { CatalogRouteEntry, RouteDoc } from './types.ts';

const CONTRACTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'contracts');

test('TR-5: the schema enum domain free_base|paid reads through the web reader', () => {
  for (const access of ['free_base', 'paid'] as const) {
    const res = readRoute(routeDoc(access));
    assert.equal(res.ok, true, access);
    if (res.ok) assert.equal(res.data.access, access);
  }
});

test('TR-5: access "free" is not in the schema domain — rejected with the enum diagnostic', () => {
  const res = readRoute(routeDocWithLegacyAccess());
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, 'schema-invalid');
    assert.ok(res.errors.some((e) => e.path === '$.access'), JSON.stringify(res.errors));
  }
});

test('TR-5: a literal null document is a diagnosed rejection, not a crash', () => {
  const res = readRoute(JSON.parse(nullRouteText));
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, 'schema-invalid');
    assert.ok(res.errors.some((e) => e.path === '$'), JSON.stringify(res.errors));
  }
});

test('TR-5: a complete catalog entry reads through the web reader', () => {
  const res = readCatalog(catalogEnvelope([catalogEntry()]));
  assert.equal(res.ok, true);
});

test('TR-5: a catalog entry without sizes is rejected — the field is schema-required', () => {
  const res = readCatalog(catalogEnvelope([catalogEntryWithoutSizes()]));
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, 'schema-invalid');
    assert.ok(res.errors.some((e) => e.path.endsWith('sizes')), JSON.stringify(res.errors));
  }
});

test('TR-5 key parity: the web RouteDoc restatement accepts the full schema fixture — compile pins every field', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(CONTRACTS, 'schemas', 'route.schema.json'), 'utf8'));
  const sample: RouteDoc = routeDoc();
  assert.deepEqual(Object.keys(sample).sort(), Object.keys(schema.properties).sort());
});

test('TR-5 key parity: the catalog entry restatement carries exactly the catalog.schema.json field names', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(CONTRACTS, 'schemas', 'catalog.schema.json'), 'utf8'));
  const entry: CatalogRouteEntry = catalogEntry();
  assert.deepEqual(Object.keys(entry).sort(), Object.keys(schema.properties.routes.items.properties).sort());
});
