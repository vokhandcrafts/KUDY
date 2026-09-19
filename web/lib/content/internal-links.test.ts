// TR-8 guard (docs/architecture/23_technical_remarks.md): every internal href
// the catalog page data carries must resolve among the web's static routes —
// '/' and '/en' plus the guides dynamic route with a route_id the catalog
// knows. A dead entry like the removed /map link (tile-provider decision
// pending, #111) turns this guard red, so it cannot silently come back
// (implementation-rules 1).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { readSiteCatalogPage } from './site.ts';
import { buildDemoFixture } from './test-fixture.ts';

const WEB_APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

// Static route set from the app directory: page.tsx files are routes,
// bracketed segments are dynamic (handled separately, not "static").
function collectRoutes(dir: string, prefix = ''): string[] {
  const routes: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      routes.push(...collectRoutes(path.join(dir, entry.name), `${prefix}/${entry.name}`));
    } else if (entry.name === 'page.tsx') {
      routes.push(prefix === '' ? '/' : prefix);
    }
  }
  return routes;
}

function collectHrefs(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    if (value.startsWith('/')) into.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectHrefs(item, into));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectHrefs(item, into));
  }
}

test('TR-8: every internal href in the catalog page data resolves among the static routes', async () => {
  const { publicRoot } = await buildDemoFixture();
  const page = readSiteCatalogPage(publicRoot, 'be');
  const hrefs: string[] = [];
  collectHrefs(page, hrefs);
  assert.ok(hrefs.length > 0, 'the fixture must produce at least one internal href');

  const staticRoutes = collectRoutes(WEB_APP).filter((route) => !route.includes('['));
  const routeIds = page.cards.map((card) => card.route_id);
  for (const href of hrefs) {
    const withoutLocale = href === '/' || !href.startsWith('/en/') ? href : href.slice('/en'.length);
    const guideMatch = /^\/guides\/([^/]+)$/.exec(withoutLocale);
    if (guideMatch) {
      assert.ok(
        routeIds.includes(guideMatch[1]!),
        `guide href ${href} has no catalog entry`,
      );
      continue;
    }
    assert.ok(
      staticRoutes.includes(withoutLocale),
      `internal href ${href} has no static route (TR-8: dead links stay hidden until their route exists)`,
    );
  }
});
