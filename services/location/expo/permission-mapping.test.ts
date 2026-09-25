// G05.02.c AC1 — the OS-permission answer mapping, every port value covered.
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapOsPermission } from './permission-mapping.ts';

test('AC1: the three OS permission answers map onto the port PermissionState values', () => {
  assert.equal(mapOsPermission({ status: 'granted' }), 'granted');
  assert.equal(mapOsPermission({ status: 'denied' }), 'denied');
  assert.equal(mapOsPermission({ status: 'undetermined' }), 'undetermined');
});
