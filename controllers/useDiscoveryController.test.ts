// G15.03 (issue #70) — the discovery controller tests: the controller runs
// over the real discovery index service with fixture ports, exactly the
// wiring the composition root performs. The criteria cases mirror the
// G01.06 fixture suite (fixtures/discovery-contract/criteria-cases.json) —
// the controller re-proves them at its boundary, with the analytics port
// pinned to the exact five-field payload allowlist.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { DiscoveryIndexV1 } from '../core/discovery/selectDiscovery.ts';
import { loadDiscoveryIndex, type DiscoveryIndexState, type DiscoverySnapshotStore } from '../services/contentRepo/discoveryIndex.ts';
import {
  createDiscoveryController,
  offersById,
  type DiscoveryAnalyticsPort,
  type DiscoveryControllerState,
  type DiscoveryOfferEvent,
} from './useDiscoveryController.ts';
import { deferred, loaderFromTexts, waitUntil } from './catalog/test-helpers.ts';

const fixture = (name: string): string =>
  readFileSync(new URL('../fixtures/discovery-contract/' + name, import.meta.url), 'utf8');

const CATALOG = fixture('catalog-with-discovery.json');
const INDEX = fixture('index-valid.json');
const POINTER = 'discovery/city-a/r-2026-09-14-1/index.json';
const REVISION = 'r-2026-09-14-1';

const sha256 = async (bytes: Uint8Array): Promise<string> => createHash('sha256').update(bytes).digest('hex');

function memorySnapshot(initial: Uint8Array | null = null): DiscoverySnapshotStore {
  let bytes = initial;
  return { read: async () => bytes, write: async (next) => void (bytes = next) };
}

function controllerOver(
  paths: Record<string, string>,
  snapshot: DiscoverySnapshotStore = memorySnapshot(),
  analytics?: DiscoveryAnalyticsPort,
) {
  return createDiscoveryController({
    service: { load: () => loadDiscoveryIndex({ loader: loaderFromTexts(paths), sha256, snapshot }) },
    criteriaLocale: 'be',
    analytics,
  });
}

const booted = async (controller: ReturnType<typeof controllerOver>): Promise<DiscoveryControllerState> => {
  await waitUntil(() => controller.getState().surface.kind !== 'loading');
  return controller.getState();
};

function analyticsSpy() {
  const shown: DiscoveryOfferEvent[] = [];
  const opened: DiscoveryOfferEvent[] = [];
  return { shown, opened, port: { offerShown: (e: DiscoveryOfferEvent) => void shown.push(e), offerOpened: (e: DiscoveryOfferEvent) => void opened.push(e) } };
}

const minimalIndex = (revision: string): DiscoveryIndexV1 => ({
  schema_version: 1,
  revision,
  city_id: 'city-a',
  themes: [],
  offers: [],
  collections: [],
});

describe('useDiscoveryController — boot over the real index service', () => {
  it('loads the fixture index fresh: 6 be-eligible exact offers, en-only one excluded', async () => {
    const state = await booted(controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX }));
    assert.ok(state.surface.kind === 'ready');
    assert.equal(state.surface.stale, false);
    assert.equal(state.surface.revision, REVISION);
    assert.equal(state.surface.result.exact.length, 6);
    assert.ok(state.surface.result.exact.every((match) => match.offer_id !== 'offer-e1-place'));
  });

  it('controls expose only choices that split the eligible set', async () => {
    const state = await booted(controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX }));
    assert.deepEqual(state.controls.timeLimits, [60, 120, 240]);
    // architecture lives only on the en-only offer — it cannot change a
    // be-locale choice set, so its chip never renders (no fake form).
    assert.deepEqual(state.controls.themeIds, ['theme-history', 'theme-sea']);
    assert.deepEqual(state.controls.seasons, ['summer', 'autumn']);
  });

  it('offline restart over a stored snapshot boots stale with the same revision', async () => {
    const snapshot = memorySnapshot(new TextEncoder().encode(INDEX));
    const state = await booted(controllerOver({}, snapshot));
    assert.ok(state.surface.kind === 'ready');
    assert.equal(state.surface.stale, true);
    assert.equal(state.surface.staleReason, 'catalog-unavailable');
    assert.equal(state.surface.revision, REVISION);
  });

  it('no pointer and no snapshot boots honestly unavailable', async () => {
    const state = await booted(controllerOver({ 'catalog.json': fixture('catalog-legacy.json') }));
    assert.deepEqual(state.surface, { kind: 'unavailable', reason: 'discovery-not-published' });
  });
});

describe('useDiscoveryController — criteria at the boundary (21 §4)', () => {
  it('60 minutes: three exact, the rest labeled alternatives', async () => {
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX });
    await booted(controller);
    controller.getState().setTimeLimit(60);
    const surface = controller.getState().surface;
    assert.ok(surface.kind === 'ready');
    assert.deepEqual(
      surface.result.exact.map((match) => match.offer_id).sort(),
      ['offer-a1-place', 'offer-g1-place', 'offer-h1-place'],
    );
    assert.equal(surface.result.alternatives.length, 3);
  });

  it('60 minutes plus explicit autumn: the single exact result stands alone', async () => {
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX });
    await booted(controller);
    controller.getState().setTimeLimit(60);
    controller.getState().setSeason('autumn');
    const surface = controller.getState().surface;
    assert.ok(surface.kind === 'ready');
    assert.deepEqual(surface.result.exact.map((match) => match.offer_id), ['offer-h1-place']);
  });

  it('theme chips OR-match: sea keeps the place and the collection', async () => {
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX });
    await booted(controller);
    controller.getState().toggleTheme('theme-sea');
    const surface = controller.getState().surface;
    assert.ok(surface.kind === 'ready');
    assert.deepEqual(surface.result.exact.map((match) => match.offer_id).sort(), ['offer-c1-place', 'offer-f1-collection']);
  });

  it('unknown themes, off-list limits and unknown seasons are rejected at the boundary', async () => {
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX });
    await booted(controller);
    const before = controller.getState();
    controller.getState().toggleTheme('theme-nope');
    controller.getState().setTimeLimit(90);
    controller.getState().setSeason('monsoon' as never);
    assert.equal(controller.getState().themeIds.length, 0);
    assert.equal(controller.getState().timeLimit, null);
    assert.equal(controller.getState().season, null);
    assert.equal(controller.getState().surface, before.surface);
  });

  it('a narrow query with zero exact keeps every eligible offer as a labeled alternative', async () => {
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX });
    await booted(controller);
    // 60 minutes + the sea theme: the only sea offers are the unknown-time
    // place (duration_unknown) and the 120-minute collection (over_time) —
    // nothing stays exact, nothing is widened (21 §4 rule 7).
    controller.getState().setTimeLimit(60);
    controller.getState().toggleTheme('theme-sea');
    const surface = controller.getState().surface;
    assert.ok(surface.kind === 'ready');
    assert.equal(surface.result.exact.length, 0);
    // All six eligible offers stay as labeled alternatives: the sea pair by
    // time (unknown / over_time), the rest by theme_mismatch — nothing is
    // silently widened or dropped (21 §4 rule 7).
    assert.equal(surface.result.alternatives.length, 6);
    const byId = new Map(surface.result.alternatives.map((match) => [match.offer_id, match]));
    assert.ok(byId.get('offer-c1-place')!.differences.includes('duration_unknown'));
    assert.ok(byId.get('offer-f1-collection')!.differences.includes('over_time'));
    assert.ok(byId.get('offer-a1-place')!.differences.includes('theme_mismatch'));
  });

  it('showAlternatives is the explicit disclosure the selector rules require', async () => {
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX });
    await booted(controller);
    assert.equal(controller.getState().alternativesShown, false);
    controller.getState().showAlternatives();
    assert.equal(controller.getState().alternativesShown, true);
  });
});

describe('useDiscoveryController — analytics allowlist (event-table.v1.json)', () => {
  it('shown fires once per offer per surface, collections never emit, payload is exactly five fields', async () => {
    const spy = analyticsSpy();
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX }, memorySnapshot(), spy.port);
    const state = await booted(controller);
    assert.ok(state.surface.kind === 'ready');
    const offers = offersById(state.surface.index);
    const batch = [offers.get('offer-b1-guide')!, offers.get('offer-a1-place')!, offers.get('offer-f1-collection')!];
    controller.getState().recordShown(batch, 'discovery');
    controller.getState().recordShown(batch, 'discovery');
    assert.equal(spy.shown.length, 2); // b1 + a1; the collection offer is not in the enum
    assert.deepEqual(
      spy.shown.map((event) => event.offer_id),
      ['offer-b1-guide', 'offer-a1-place'],
    );
    assert.equal(Object.keys(spy.shown[0]).length, 5);
    controller.getState().recordShown([offers.get('offer-a1-place')!], 'collection');
    assert.equal(spy.shown.length, 3);
    assert.equal(spy.shown[2].surface, 'collection');
  });

  it('a remount (beginPresentation) re-emits shown for the same revision, scoped to its surface', async () => {
    const spy = analyticsSpy();
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX }, memorySnapshot(), spy.port);
    const state = await booted(controller);
    assert.ok(state.surface.kind === 'ready');
    const offers = offersById(state.surface.index);
    const batch = [offers.get('offer-b1-guide')!, offers.get('offer-a1-place')!];
    controller.getState().recordShown(batch, 'discovery');
    controller.getState().recordShown(batch, 'collection');
    assert.equal(spy.shown.length, 4);
    // The remount restarts only its own surface's per-presentation dedupe
    // (21 §7: shown once per offer per foreground presentation); the same
    // revision re-emits because the key carries it.
    controller.getState().beginPresentation('discovery');
    controller.getState().recordShown(batch, 'discovery');
    assert.equal(spy.shown.length, 6);
    controller.getState().recordShown(batch, 'discovery');
    assert.equal(spy.shown.length, 6);
  });

  it('opened carries the exact allowlisted payload for the tapped offer', async () => {
    const spy = analyticsSpy();
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX }, memorySnapshot(), spy.port);
    const state = await booted(controller);
    assert.ok(state.surface.kind === 'ready');
    const guide = offersById(state.surface.index).get('offer-b1-guide')!;
    controller.getState().recordOpened(guide, 'discovery');
    assert.deepEqual(spy.opened, [
      {
        discovery_revision: REVISION,
        offer_id: 'offer-b1-guide',
        kind: 'guide',
        content_locale: 'be',
        surface: 'discovery',
      },
    ]);
  });

  it('without an analytics port the choice works and nothing is emitted', async () => {
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX });
    const state = await booted(controller);
    assert.ok(state.surface.kind === 'ready');
    const offer = offersById(state.surface.index).get('offer-a1-place')!;
    assert.doesNotThrow(() => controller.getState().recordShown([offer], 'discovery'));
    assert.doesNotThrow(() => controller.getState().recordOpened(offer, 'discovery'));
  });
});

describe('useDiscoveryController — refresh policy', () => {
  it('a superseded refresh never overwrites the newer result', async () => {
    const first = deferred<DiscoveryIndexState>();
    const second = deferred<DiscoveryIndexState>();
    const loads = [first.promise, second.promise];
    const controller = createDiscoveryController({
      service: { load: () => loads.shift()! },
      criteriaLocale: 'be',
    });
    await waitUntil(() => loads.length === 1); // the boot load took the first slot
    void controller.getState().refresh();
    second.resolve({ kind: 'ready', index: minimalIndex('r-new'), revision: 'r-new', stale: false, reason: null });
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    first.resolve({ kind: 'ready', index: minimalIndex('r-old'), revision: 'r-old', stale: false, reason: null });
    await new Promise((resolve) => setImmediate(resolve));
    const surface = controller.getState().surface;
    assert.ok(surface.kind === 'ready');
    assert.equal(surface.revision, 'r-new');
  });

  it('criteria survive a refresh: the limits re-apply to the next index', async () => {
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX });
    await booted(controller);
    controller.getState().setTimeLimit(60);
    await controller.getState().refresh();
    const surface = controller.getState().surface;
    assert.ok(surface.kind === 'ready');
    assert.equal(controller.getState().timeLimit, 60);
    assert.equal(surface.result.exact.length, 3);
  });

  // G21.17 (issue #551): the query language is the selected UI language —
  // the switch re-selects over the loaded index, the published-text filter
  // follows, and an unknown code never moves the state (the setTimeLimit
  // boundary idiom).
  it('selected_text_locale_filter: the switch re-selects over all eight UI locales', async () => {
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX });
    await booted(controller);
    const bootedSurface = controller.getState().surface;
    assert.ok(bootedSurface.kind === 'ready');
    assert.ok(bootedSurface.result.exact.length > 0, 'be text offers are eligible at boot');
    const bootCount = bootedSurface.result.exact.length;
    for (const locale of ['de', 'es', 'fr', 'cs', 'sv'] as const) {
      controller.getState().setCriteriaLocale(locale);
      const surface = controller.getState().surface;
      assert.ok(surface.kind === 'ready');
      assert.deepEqual(surface.result.exact, [], `${locale} has no published guide text in the fixture`);
    }
    // The fixture's offers carry per-locale availability: uk and en each see
    // their own published subset — never the full be answer.
    for (const locale of ['uk', 'en'] as const) {
      controller.getState().setCriteriaLocale(locale);
      const surface = controller.getState().surface;
      assert.ok(surface.kind === 'ready');
      assert.ok(surface.result.exact.length > 0, `${locale} text offers stay eligible`);
      assert.ok(surface.result.exact.length <= bootCount, 'the filter never widens the be answer');
    }
    controller.getState().setCriteriaLocale('en');
    const enSurface = controller.getState().surface;
    assert.ok(enSurface.kind === 'ready');
    assert.ok(enSurface.result.exact.length > 0, 'en text offers return');
    controller.getState().setCriteriaLocale('be');
    const backSurface = controller.getState().surface;
    assert.ok(backSurface.kind === 'ready');
    assert.equal(backSurface.result.exact.length, bootCount, 'the boot locale restores the full answer');
  });

  it('selected_text_locale_filter: an unknown code is rejected, the previous locale stays', async () => {
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX });
    await booted(controller);
    controller.getState().setCriteriaLocale('fr');
    controller.getState().setCriteriaLocale('ua');
    controller.getState().setCriteriaLocale('');
    assert.equal(controller.getState().criteriaLocale, 'fr');
  });

  it('selected_text_locale_filter: the analytics payload carries the switched locale', async () => {
    const spy = analyticsSpy();
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX }, memorySnapshot(), spy.port);
    await booted(controller);
    controller.getState().setCriteriaLocale('fr');
    const surface = controller.getState().surface;
    assert.ok(surface.kind === 'ready');
    const offer = surface.index.offers[0];
    if (offer === undefined) throw new Error('the fixture carries offers');
    controller.getState().recordShown([offer], 'discovery');
    assert.equal(spy.shown[0]?.content_locale, 'fr');
  });

  it('setCriteriaLocale recomputes the controls over the locale-eligible offers', async () => {
    const controller = controllerOver({ 'catalog.json': CATALOG, [POINTER]: INDEX });
    await booted(controller);
    const before = controller.getState().controls;
    controller.getState().setCriteriaLocale('fr');
    const after = controller.getState().controls;
    assert.deepEqual(after, { timeLimits: [], themeIds: [], seasons: [] });
    assert.notDeepEqual(before, after);
  });
});
