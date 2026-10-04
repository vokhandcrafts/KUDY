// G21.09 (issue #542, criteria 2 and 5) — the key/parameter contract of the
// message catalogs walked against the G21.24 canonical records: every native
// record of contracts/ui-messages/source.json resolves to its catalog leaf
// and the leaf's runtime shape matches the record (plain → string;
// template/composed/discreteForms → callable with the record's parameter
// count). Deleting a record, renaming a key or changing a catalog value's
// shape fails here through the standard runner. The guideHint domain (four
// plain records) stays anchored by the inventory test — GuideHintCard.tsx is
// JSX and cannot be imported under node strip-types; web.ui rides the web
// parity tests.
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadUiMessagesSource } from '../contracts/ui-messages/ui-messages.mjs';
import { uiStrings } from '../components/ui-strings.ts';
import { previewStrings } from '../controllers/catalog/previewController.ts';
import { runMapStrings } from '../controllers/run/runMap.ts';
import { placeDetailStrings } from '../controllers/place/placeDetailController.ts';
import { nearbyStrings } from '../controllers/nearby/nearbySurfaceController.ts';
import { offerStrings } from '../controllers/commerce/commerceController.ts';
import { feedbackStrings } from '../controllers/useFeedbackController.ts';

const CATALOGS = {
  'native.chrome': () => uiStrings('be'),
  'native.preview': () => previewStrings('be'),
  'native.run': () => runMapStrings('be'),
  'native.place': () => placeDetailStrings('be'),
  'native.nearby': () => nearbyStrings('be'),
  'native.offer': () => offerStrings('be'),
  'native.feedback': () => feedbackStrings('be'),
};

function leaf(obj, path) {
  let current = obj;
  for (const part of path.split('.')) {
    current = current?.[part];
    if (current === undefined) return undefined;
  }
  return current;
}

const doc = loadUiMessagesSource();

test('every native record matches its catalog leaf shape and parameter count', () => {
  const checkedDomains = new Set();
  for (const record of doc.records) {
    const parts = record.id.split('.');
    const domain = parts.slice(0, 2).join('.');
    const catalog = CATALOGS[domain];
    if (!catalog) continue;
    checkedDomains.add(domain);
    const value = leaf(catalog(), parts.slice(2).join('.'));
    assert.ok(value !== undefined, `record ${record.id} has a catalog leaf`);
    const expectCallable =
      record.format === 'template' || Boolean(record.composed) || Boolean(record.discreteForms);
    assert.equal(
      typeof value === 'function',
      expectCallable,
      `record ${record.id}: ${expectCallable ? 'a callable with parameters' : 'a plain string'}`,
    );
    if (expectCallable) {
      assert.equal(value.length, record.parameters.length, `record ${record.id} parameter count`);
    }
  }
  // The walk covered every imported native domain — no domain silently
  // dropped from the guard.
  assert.deepEqual([...checkedDomains].sort(), Object.keys(CATALOGS).sort());
});

test('every canonical domain is guarded or in the documented exception list', () => {
  // A domain added to source.json must extend CATALOGS (runtime walk) or the
  // exception list below — never silently skip the guard. Exceptions:
  // native.guideHint is JSX-anchored by the inventory suite (GuideHintCard
  // cannot be imported under node strip-types); web.ui rides the web
  // channel's own parity tests.
  const EXCEPTIONS = ['native.guideHint', 'web.ui'];
  const recordDomains = new Set(doc.records.map((record) => record.id.split('.').slice(0, 2).join('.')));
  for (const domain of recordDomains) {
    assert.ok(
      domain in CATALOGS || EXCEPTIONS.includes(domain),
      `domain ${domain} from source.json is not guarded: extend CATALOGS or EXCEPTIONS`,
    );
  }
});
