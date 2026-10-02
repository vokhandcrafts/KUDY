// G14.04.d (issue #305) — the uk catalogs of the controller word
// dictionaries carry the same key shape as be/en (AC1: «усе ключы трох
// файлаў эквівалентныя»). A key added to one locale only fails here
// (implementation-rules 1); so does an empty word. The phrase-shaped lines
// stay governed by reason-strings.test.ts; this guard owns the key shape of
// every catalog the reason rule does not walk (and re-walks those too, so
// the shape claim holds for all five dictionaries in one place).
import test from 'node:test';
import assert from 'node:assert/strict';

import { previewStrings } from './catalog/previewController.ts';
import { runMapStrings } from './run/runMap.ts';
import { placeDetailStrings } from './place/placeDetailController.ts';
import { nearbyStrings } from './nearby/nearbySurfaceController.ts';
import { offerStrings } from './commerce/commerceController.ts';

// The key shape of a catalog: strings and functions are leaves (a function's
// signature is fixed by TypeScript, the shape guard owns the key's
// existence), objects are walked. Returns the sorted dotted key path list.
function keyShape(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyShape(child, prefix ? `${prefix}.${key}` : key),
  );
}

// Every string leaf the shape walk finds must be non-empty (the label names
// the failing word — this node:test build asserts through messages).
function assertNoEmptyWords(value: unknown, label: string): void {
  if (typeof value === 'string') {
    assert.ok(value.length > 0, `${label}: empty word`);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertNoEmptyWords(child, `${label}.${key}`);
    }
  }
}

const CATALOGS: Record<string, (locale: string) => unknown> = {
  preview: previewStrings,
  runMap: runMapStrings,
  placeDetail: placeDetailStrings,
  nearby: nearbyStrings,
  offer: offerStrings,
};

test('G14.04.d #305: every controller word dictionary carries the same be/en/uk key shape', () => {
  for (const [name, strings] of Object.entries(CATALOGS)) {
    const be = keyShape(strings('be')).sort();
    const en = keyShape(strings('en')).sort();
    const uk = keyShape(strings('uk')).sort();
    assert.deepEqual(uk, be, `${name}: uk key shape diverges from be`);
    assert.deepEqual(en, be, `${name}: en key shape diverges from be`);
    assert.ok(be.length > 5, `${name}: implausibly few keys`);
  }
});

test('G14.04.d #305: no word is empty in any locale of any controller dictionary', () => {
  for (const [name, strings] of Object.entries(CATALOGS)) {
    for (const locale of ['be', 'en', 'uk']) {
      assertNoEmptyWords(strings(locale), `${name}.${locale}`);
    }
  }
});
