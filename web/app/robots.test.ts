import { test } from 'node:test';
import assert from 'node:assert/strict';

import robots from './robots.ts';

test('G21.44.c robots policy excludes only the content asset tree', () => {
  assert.deepEqual(robots(), {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/content/',
    },
  });
});
