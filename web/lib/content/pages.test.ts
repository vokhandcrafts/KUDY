// G10.01.b acceptance 1/2/3/5: the catalog and guide page data render the
// demo-route fixture by fact — locale availability, locked previews with the
// closed four-field set, no paid text anywhere — and the app-links guard keeps
// every CTA on the single config. Component rendering itself is proven by the
// build-time scan over the real export (web/scripts/scan-rendered.ts) and the
// Showboat demo; node --test does not execute JSX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { be } from '../i18n/be.ts';
import { en } from '../i18n/en.ts';
import { SiteDataError, readSiteCatalogPage, readSiteGuidePage } from './site.ts';
import { buildDemoFixture } from './test-fixture.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const { publicRoot } = await buildDemoFixture();

test('the home shows the fixture card and no dead links — no placeholder cards (acceptance 3)', () => {
  const page = readSiteCatalogPage(publicRoot, 'be');
  assert.equal(page.cards.length, 1);
  assert.equal(page.cards[0]!.title, 'Дэма-гід: сукнаны двор');
  assert.equal(page.cards[0]!.href, '/guides/demo-route-a1');
  assert.equal(page.cards[0]!.duration_min, 40);
  assert.equal(page.cards[0]!.distance_m, 2500);
  assert.equal(page.cards[0]!.stop_count, 2);
  // The founder's tile-provider decision (2026-09-21, results/G10.01.b.md)
  // wired the /map route, so the catalog exposes the locale-prefixed entry —
  // the TR-8 hiding is resolved, not silently reverted.
  assert.equal(page.mapHref, '/map');
});

test('the en home renders the en facts behind the locale prefix', () => {
  const page = readSiteCatalogPage(publicRoot, 'en');
  assert.equal(page.cards[0]!.title, 'Demo guide: the cloth courtyard');
  assert.equal(page.cards[0]!.href, '/en/guides/demo-route-a1');
  assert.equal(page.mapHref, '/en/map');
});

test('per-locale availability is shown by fact — uk is text-only (09 §8)', () => {
  const page = readSiteCatalogPage(publicRoot, 'en');
  assert.deepEqual(page.cards[0]!.languages, [
    { locale: 'be', audio: true },
    { locale: 'en', audio: true },
    { locale: 'uk', audio: false },
  ]);
});

test('the guide page lists the ordered stops; the locked one is the closed four-field preview (acceptance 2)', () => {
  const guide = readSiteGuidePage(publicRoot, 'be', 'demo-route-a1');
  assert.equal(guide.title, 'Дэма-гід: сукнаны двор');
  assert.deepEqual(guide.stops.map((stop) => stop.stop_id), ['stop-1', 'stop-2']);
  const free = guide.stops[0]!;
  assert.equal(free.locked, false);
  assert.equal(free.name, 'Двор сукнараў (дэма)');
  assert.equal(free.announce, null);
  const locked = guide.stops[1]!;
  assert.deepEqual(Object.keys(locked).sort(), ['announce', 'locked', 'name', 'place_id', 'stop_id']);
  assert.equal(locked.locked, true);
  assert.equal(locked.place_id, 'place-2');
  assert.equal(locked.name, 'Млынавая калона (дэма)');
  assert.match(locked.announce!, /млына/);
});

test('the en guide page shows en text for both the place name and the locked preview', () => {
  const guide = readSiteGuidePage(publicRoot, 'en', 'demo-route-a1');
  assert.equal(guide.stops[0]!.name, "Cloth Merchants' Courtyard (demo)");
  assert.equal(guide.stops[1]!.name, 'The Mill Column (demo)');
});

test('no paid text reaches the page data (acceptance 2: no paid text in what gets rendered)', () => {
  const extended = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'fixtures', 'content', 'demo-route', 'be', 'extended', 'stops.json'), 'utf8'),
  );
  const story = extended[0];
  assert.ok(story.text.length > 40);
  const rendered = JSON.stringify([
    readSiteCatalogPage(publicRoot, 'be'),
    readSiteGuidePage(publicRoot, 'be', 'demo-route-a1'),
    readSiteGuidePage(publicRoot, 'en', 'demo-route-a1'),
  ]);
  assert.ok(!rendered.includes(story.text));
  assert.ok(!rendered.includes(story.transcript));
});

test('defined rejections fail the site build instead of rendering empty pages', () => {
  const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-web-site-'));
  assert.throws(
    () => readSiteCatalogPage(missing, 'be'),
    (err: unknown) => err instanceof SiteDataError && err.code === 'not-found',
  );
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-web-site-'));
  fs.writeFileSync(
    path.join(legacyRoot, 'catalog.json'),
    fs.readFileSync(path.join(REPO_ROOT, 'fixtures', 'discovery-contract', 'catalog-legacy.json'), 'utf8'),
  );
  assert.throws(
    () => readSiteCatalogPage(legacyRoot, 'be'),
    (err: unknown) => err instanceof SiteDataError && err.code === 'not-found',
  );
  assert.throws(
    () => readSiteGuidePage(publicRoot, 'be', 'no-such-route'),
    (err: unknown) => err instanceof SiteDataError && err.code === 'not-found',
  );
});

test('the be and en string files keep the same key set (09 §8: UI localization from the first page)', () => {
  assert.deepEqual(Object.keys(be).sort(), Object.keys(en).sort());
});

test('no page or component hardcodes an href or an external URL (acceptance 5: CTAs resolve through lib/app-links.ts)', () => {
  const sources: string[] = [];
  const collect = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) sources.push(fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'));
    }
  };
  collect(path.join(REPO_ROOT, 'web', 'app'));
  collect(path.join(REPO_ROOT, 'web', 'components'));
  assert.ok(sources.length > 0);
  for (const source of sources) {
    assert.doesNotMatch(source, /href\s*=\s*["']/, 'href must be a bound expression from appLinks or page data');
    assert.doesNotMatch(
      source,
      /https?:\/\//,
      'external URLs live only in the lib/ configs (app-links.ts, map-config.ts)',
    );
  }
});
