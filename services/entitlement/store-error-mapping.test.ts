// G08.03 — behavioral tests of the closed store-failure mapping (criterion
// 1: cancel/error/delay are nameable honest states). Reverting any table
// row, the unknown fail-closed branches or the sanitizer makes these fail
// (implementation-rules 1). The mapper is pure: synthetic thrown shapes in,
// closed answers out.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CATEGORY_BY_CODE, executorCodeOf, mapStoreFailure } from './store-error-mapping.ts';
import { rcError } from './fake-port.ts';

// The PURCHASES_ERROR_CODE values of the pinned
// @revenuecat/purchases-typescript-internal (dist/generated/error-codes.d.ts
// of react-native-purchases 10.9.1), copied verbatim. The mapping table must
// decide a category for exactly this set — an SDK bump that adds a value
// fails here until the table answers it (implementation-rules 2: the closed
// list is a restatement guarded against drift).
const RC_ERROR_CODE_VALUES = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14',
  '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '28',
  '29', '30', '31', '32', '33', '34', '35', '42',
];

test('the closed table covers exactly the pinned RC error-code enum', () => {
  assert.deepEqual(Object.keys(CATEGORY_BY_CODE).sort(), [...RC_ERROR_CODE_VALUES].sort());
});

test('every user-meaningful store answer lands on its honest category', () => {
  const expectations: Array<[string, string]> = [
    ['1', 'cancelled'],
    ['20', 'payment-pending'],
    ['6', 'already-owned'],
    ['3', 'not-allowed'],
    ['18', 'not-allowed'],
    ['5', 'product-unavailable'],
    ['10', 'unavailable'],
    ['15', 'unavailable'],
    ['32', 'unavailable'],
    ['33', 'unavailable'],
    ['35', 'unavailable'],
    ['2', 'store-problem'],
    ['11', 'executor-error'],
    ['14', 'executor-error'],
    ['23', 'executor-error'],
  ];
  for (const [code, category] of expectations) {
    const mapped = mapStoreFailure(rcError(code));
    assert.ok(!('kind' in mapped), `code ${code} must map, not fail shape`);
    assert.equal(mapped.category, category, `code ${code}`);
    assert.equal(mapped.code, code);
  }
});

test('a code outside the closed table is unknown with a sanitized diagnostic', () => {
  const mapped = mapStoreFailure(rcError('99'));
  assert.deepEqual(mapped, {
    kind: 'unknown',
    diagnostics: ['store-error#unrecognized-code:99'],
  });
  const hostile = mapStoreFailure(rcError('a b\nc;drop'));
  assert.deepEqual(hostile, {
    kind: 'unknown',
    diagnostics: ['store-error#unrecognized-code:raw'],
  });
});

test('a thrown value without a code shape is unknown, never a crash', () => {
  for (const thrown of [null, undefined, 'store exploded', 42, new Error('native bridge'), {}]) {
    const mapped = mapStoreFailure(thrown);
    assert.deepEqual(mapped, { kind: 'unknown', diagnostics: ['store-error#shape'] });
  }
});

test('empty-string code is a shape failure, not a recognized code', () => {
  assert.deepEqual(mapStoreFailure({ code: '' }), {
    kind: 'unknown',
    diagnostics: ['store-error#shape'],
  });
});

test('executor codes refine to the app defect they name', () => {
  assert.equal(executorCodeOf('14'), 'invalid-app-user');
  assert.equal(executorCodeOf('11'), 'invalid-credentials');
  assert.equal(executorCodeOf('23'), 'configuration');
  assert.equal(executorCodeOf('24'), 'configuration');
});
