// G10.02.a: the app-transition config's own contract. The unpublished/live
// variants are exhaustive — appDestination answers for both without a
// default branch, so a future shape change fails here first (rule 14).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appDestination, appLinks, routeDeepLink, routeProductId } from './app-links.ts';

test('appDestination: an unpublished store resolves to the /app fallback, never a URL', () => {
  assert.deepEqual(appDestination(appLinks, 'appStore'), { href: '/app', store: 'unpublished' });
  assert.deepEqual(appDestination(appLinks, 'playStore'), { href: '/app', store: 'unpublished' });
});

test('appDestination: a live store URL resolves to itself', () => {
  const links = { ...appLinks, appStore: { kind: 'live', href: 'https://apps.example.test/kudy' } as const };
  assert.deepEqual(appDestination(links, 'appStore'), { href: 'https://apps.example.test/kudy', store: 'live' });
});

test('routeProductId passes the catalog product_id through verbatim, null when absent', () => {
  assert.equal(routeProductId({ route_id: 'r1', product_id: 'prod.r1' }), 'prod.r1');
  assert.equal(routeProductId({ route_id: 'r1' }), null);
});

test('routeDeepLink is deepLinkBase + the same web path, null while unpublished', () => {
  assert.equal(routeDeepLink(appLinks, '/guides/demo-route-a1'), null);
  const links = {
    ...appLinks,
    deepLinkBase: { kind: 'live', href: 'https://app.example.test' } as const,
  };
  assert.equal(routeDeepLink(links, '/guides/demo-route-a1'), 'https://app.example.test/guides/demo-route-a1');
});
