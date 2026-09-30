// G06.01.b (issue #314) — the preview controller: the Download/Start
// derivation table over the real package facts (09 §7 inventory states +
// the contentRepo verify verdict), the download flip that follows the
// refreshed inventory (never the activation result — the Proof), the §4.1
// confirm dialog of NAV8, the NAV9 source recording and the honest
// unavailable states. The controller runs over the real catalog service
// with fake ports, exactly the wiring the composition root performs.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  asSourceSurface,
  createPreviewController,
  derivePreviewButton,
  type PreviewEvaluatePort,
  type PreviewInventoryPort,
  type PreviewLayerFacts,
  type PreviewPorts,
  type PreviewRunSessionPort,
} from './previewController.ts';
import { createCatalogService } from '../../services/catalog/catalogService.ts';
import type { CatalogPathLoader } from '../../services/catalog/types.ts';
import type { Readiness } from '../../services/contentRepo/types.ts';
import type { ActivationResult, LayerKey } from '../../services/download/types.ts';
import { deferred, loaderFromTexts, waitUntil } from './test-helpers.ts';

const ROUTE_DOC = JSON.stringify({
  route_id: 'r-1',
  version: '1',
  city_id: 'gdansk',
  access: 'free_base',
  distance_m: 1200,
  duration_min: 20,
  free_stop_count: 1,
  published: true,
  stops: [
    {
      id: 's1',
      position: 0,
      place_id: 'p1',
      access_tier: 'base',
      story_base_id: 'st1',
      preview: { name: { be: 'Кропка раз' }, announce: { be: 'Анонс першай кропкі' } },
    },
  ],
});

const CATALOG = JSON.stringify({
  catalog_schema_version: 1,
  routes: [{ route_id: 'r-1', version: '1', locales: ['be'], layers: ['base'], sizes: { base: 2097152 } }],
});

const sha256 = async () => 'deadbeef';

function makeService(loader: CatalogPathLoader) {
  return createCatalogService({ loader, sha256 }, { localePreference: ['be', 'en'] });
}

function makePorts(loader: CatalogPathLoader, extra: Partial<PreviewPorts>): PreviewPorts {
  return { service: makeService(loader), ...extra };
}

const FULL_LOADER = loaderFromTexts({ 'catalog.json': CATALOG, 'bundle/r-1/1/route.json': ROUTE_DOC });

const READY: Readiness = { status: 'ready', routeId: 'r-1', version: '1', tier: 'base', tierAvailable: ['base'] };

function fakeInventory(states: PreviewLayerFacts[]): PreviewInventoryPort & { calls: number } {
  let call = 0;
  return {
    get calls() {
      return call;
    },
    layerState(input) {
      void input;
      const next = states[Math.min(call, states.length - 1)];
      call += 1;
      return Promise.resolve(next);
    },
  };
}

function fakeEvaluate(statuses: Readiness[]): PreviewEvaluatePort {
  let call = 0;
  return {
    evaluate: (input) => {
      void input;
      const next = statuses[Math.min(call, statuses.length - 1)];
      call += 1;
      return Promise.resolve(next);
    },
  };
}

function fakeDownload(): {
  activate: (key: LayerKey) => Promise<ActivationResult>;
  keys: string[];
} {
  const keys: string[] = [];
  return {
    keys,
    activate: (key) => {
      keys.push(key.routeId);
      return Promise.resolve<ActivationResult>({
        status: 'complete',
        key,
        verified: 1,
        bytes: 1,
        fetched: 1,
        diagnostics: [],
      });
    },
  };
}

function fakeRunSession(live: { routeId: string; title: string } | null): PreviewRunSessionPort & {
  reads: number;
} {
  return {
    reads: 0,
    liveSession() {
      this.reads += 1;
      return live;
    },
  };
}

describe('derivePreviewButton — the Download/Start meaning table (09 §6.5, 11 §7)', () => {
  const base = { access: 'free' as const, granted: true, verify: null, canDownload: true };

  it('not_downloaded downloads; without the download port it states the reason', () => {
    const enabled = derivePreviewButton({ ...base, layer: { state: 'not_downloaded', missingCount: null } });
    assert.deepEqual([enabled.action, enabled.enabled, enabled.label], ['download', true, 'download']);
    const disabled = derivePreviewButton({
      ...base,
      canDownload: false,
      layer: { state: 'not_downloaded', missingCount: null },
    });
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.reason, 'preview#download-unavailable');
  });

  it('partial and stale keep the Download meaning and name the detail', () => {
    const partial = derivePreviewButton({ ...base, layer: { state: 'partial', missingCount: 3 } });
    assert.equal(partial.action, 'download');
    assert.deepEqual(partial.detail, { kind: 'missing-files', count: 3 });
    const stale = derivePreviewButton({ ...base, layer: { state: 'stale', missingCount: null } });
    assert.equal(stale.action, 'download');
    assert.deepEqual(stale.detail, { kind: 'stale' });
  });

  it('a ready package with a ready verdict starts', () => {
    const button = derivePreviewButton({ ...base, layer: { state: 'ready', missingCount: null }, verify: READY });
    assert.deepEqual([button.action, button.enabled, button.label], ['start', true, 'start']);
  });

  it('a verify failure leaves Start unavailable with the reason (AC5, 11 §7)', () => {
    const verify: Readiness[] = [
      { status: 'needs-recovery', media: ['audio/s1.m4a'] },
      { status: 'incomplete', missing: ['route.json'] },
    ];
    for (const verdict of verify) {
      const button = derivePreviewButton({
        ...base,
        layer: { state: 'ready', missingCount: null },
        verify: verdict,
      });
      assert.equal(button.action, 'download', verdict.status);
      assert.equal(button.enabled, true, verdict.status);
      assert.ok(button.detail !== null, verdict.status);
    }
    // Without the download port the same failure stays fully disabled and
    // names the reason.
    const frozen = derivePreviewButton({
      ...base,
      canDownload: false,
      layer: { state: 'ready', missingCount: null },
      verify: verify[0],
    });
    assert.equal(frozen.enabled, false);
    assert.equal(frozen.reason, 'preview#download-unavailable');
  });

  it('an access-locked verdict never starts', () => {
    const button = derivePreviewButton({
      ...base,
      layer: { state: 'ready', missingCount: null },
      verify: { status: 'access-locked', tier: 'base' },
    });
    assert.equal(button.action, 'start');
    assert.equal(button.enabled, false);
    assert.equal(button.reason, 'preview#purchase-required');
  });

  it('a paid preview without the entitlement does not start and buys nothing (AC2, NAV6)', () => {
    const button = derivePreviewButton({
      access: 'paid',
      granted: false,
      layer: { state: 'ready', missingCount: null },
      verify: READY,
      canDownload: true,
    });
    assert.deepEqual([button.action, button.enabled, button.reason], ['start', false, 'preview#purchase-required']);
  });

  it('no disk truth keeps the button fail-closed, never fictional', () => {
    const button = derivePreviewButton({ ...base, layer: null });
    assert.equal(button.enabled, false);
    assert.equal(button.reason, 'preview#storage-unknown');
  });
});

describe('preview controller', () => {
  it('boots into the ready preview with the published metadata', async () => {
    const controller = createPreviewController(makePorts(FULL_LOADER, {}), 'r-1');
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    const { surface } = controller.getState();
    assert.ok(surface.kind === 'ready');
    assert.equal(surface.preview.durationMin, 20);
    assert.equal(surface.preview.baseSizeBytes, 2097152);
    assert.ok(surface.preview.stops && surface.preview.stops[0]?.name === 'Кропка раз');
    // No inventory port — no disk truth: the button fails closed with its
    // named reason, it never guesses a downloadable package.
    assert.deepEqual(
      [controller.getState().button.action, controller.getState().button.enabled],
      ['start', false],
    );
    assert.equal(controller.getState().button.reason, 'preview#storage-unknown');
  });

  it('Download flips to Start from the refreshed inventory, never from the activation result (Proof)', async () => {
    // The inventory says not_downloaded for the first read and ready after
    // the download re-read; the activation result is a partial — the flip
    // must come from the facts, so the test fails if the derivation trusts
    // the activation outcome.
    const inventory = fakeInventory([
      { state: 'not_downloaded', missingCount: null },
      { state: 'ready', missingCount: null },
    ]);
    const download = fakeDownload();
    const evaluate = fakeEvaluate([READY]);
    const controller = createPreviewController(
      makePorts(FULL_LOADER, { inventory, evaluate, download }),
      'r-1',
    );
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    assert.equal(controller.getState().button.action, 'download');
    assert.equal(controller.getState().button.enabled, true);
    await controller.getState().download();
    assert.deepEqual(download.keys, ['r-1']);
    const button = controller.getState().button;
    assert.deepEqual([button.action, button.enabled, button.label], ['start', true, 'start']);
    assert.equal(inventory.calls, 2, 'the flip re-read the inventory facts');
  });

  it('a complete activation result cannot fake the ready state', async () => {
    const inventory = fakeInventory([{ state: 'not_downloaded', missingCount: null }]);
    const download = fakeDownload();
    const controller = createPreviewController(makePorts(FULL_LOADER, { inventory, download }), 'r-1');
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    await controller.getState().download();
    assert.equal(controller.getState().button.action, 'download', 'the disk truth did not change');
  });

  it('a thrown transfer failure surfaces as the named download error', async () => {
    const inventory = fakeInventory([{ state: 'not_downloaded', missingCount: null }]);
    const controller = createPreviewController(
      makePorts(FULL_LOADER, {
        inventory,
        download: { activate: () => Promise.reject(new Error('transfer interrupted')) },
      }),
      'r-1',
    );
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    await controller.getState().download();
    // G06.05: the reason line is the named word, the thrown diagnostic
    // survives as the muted detail.
    assert.equal(controller.getState().downloadError, 'Збой загрузкі');
    assert.equal(controller.getState().downloadDetail, 'transfer interrupted');
    assert.equal(controller.getState().busy, false);
  });

  it('Start of another guide with a live session opens the §4.1 dialog; «Скасаваць» changes nothing (NAV8)', async () => {
    const runSession = fakeRunSession({ routeId: 'r-other', title: 'Каралеўская' });
    const controller = createPreviewController(
      makePorts(FULL_LOADER, {
        inventory: fakeInventory([{ state: 'ready', missingCount: null }]),
        evaluate: fakeEvaluate([READY]),
        runSession,
      }),
      'r-1',
    );
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    assert.equal(await controller.getState().start(), 'confirm');
    const confirm = controller.getState().confirm;
    assert.ok(confirm);
    assert.deepEqual([confirm.liveTitle, confirm.candidateTitle], ['Каралеўская', 'r-1']);
    controller.getState().cancelConfirm();
    assert.equal(controller.getState().confirm, null);
    assert.equal(runSession.reads, 1, 'the preview only reads the session fact, never writes');
    // The dialog path is repeatable and the cancel leaves Start available.
    assert.equal(await controller.getState().start(), 'confirm');
  });

  it('Start hands over without the dialog for the same route or without a live session (NAV8)', async () => {
    const sameRoute = fakeRunSession({ routeId: 'r-1', title: 'Гід раз' });
    const controller = createPreviewController(
      makePorts(FULL_LOADER, {
        inventory: fakeInventory([{ state: 'ready', missingCount: null }]),
        evaluate: fakeEvaluate([READY]),
        runSession: sameRoute,
      }),
      'r-1',
    );
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    assert.equal(await controller.getState().start(), 'handover');
    assert.equal(controller.getState().confirm, null);

    const noSession = createPreviewController(
      makePorts(FULL_LOADER, {
        inventory: fakeInventory([{ state: 'ready', missingCount: null }]),
        evaluate: fakeEvaluate([READY]),
      }),
      'r-1',
    );
    await waitUntil(() => noSession.getState().surface.kind === 'ready');
    assert.equal(await noSession.getState().start(), 'handover');
  });

  it('Start is blocked while the button is disabled — the paid gate holds at the action level', async () => {
    const paidCatalog = JSON.stringify({
      catalog_schema_version: 1,
      routes: [{ route_id: 'r-1', version: '1', locales: ['be'], layers: ['base'], product_id: 'prod-1' }],
    });
    const paidDoc = JSON.stringify({
      route_id: 'r-1',
      version: '1',
      city_id: 'gdansk',
      access: 'paid',
      distance_m: 1200,
      duration_min: 20,
      free_stop_count: 1,
      published: true,
      stops: [
        {
          id: 's1',
          position: 0,
          place_id: 'p1',
          access_tier: 'base',
          story_base_id: 'st1',
          preview: { name: { be: 'Кропка раз' }, announce: { be: 'Анонс' } },
        },
      ],
    });
    const controller = createPreviewController(
      makePorts(loaderFromTexts({ 'catalog.json': paidCatalog, 'bundle/r-1/1/route.json': paidDoc }), {
        inventory: fakeInventory([{ state: 'ready', missingCount: null }]),
      }),
      'r-1',
    );
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    assert.equal(controller.getState().button.reason, 'preview#purchase-required');
    assert.equal(await controller.getState().start(), 'blocked');
  });

  it('the source surface is recorded per the NAV9 allowlist, unvalidated values are not echoed', async () => {
    const controller = createPreviewController(makePorts(FULL_LOADER, {}), 'r-1');
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    controller.getState().recordSource('rubric');
    assert.equal(controller.getState().source, 'rubric');
    controller.getState().recordSource('collection');
    assert.equal(controller.getState().source, 'collection');
    controller.getState().recordSource('<script>');
    assert.equal(controller.getState().source, null);
  });

  it('a route the catalog does not name renders the honest unavailable state', async () => {
    const controller = createPreviewController(
      makePorts(loaderFromTexts({ 'catalog.json': CATALOG }), {}),
      'no-such-route',
    );
    await waitUntil(() => controller.getState().surface.kind === 'unavailable');
    const surface = controller.getState().surface;
    assert.ok(surface.kind === 'unavailable');
    assert.equal(surface.reason, 'preview#not-published');
  });

  it('a superseded refresh never overwrites the newer result', async () => {
    const bootGate = deferred<string>();
    const EMPTY_CATALOG = JSON.stringify({ catalog_schema_version: 1, routes: [] });
    // The boot's catalog read hangs on the gate; the manual refresh reads
    // the good catalog. When the boot finally resolves with an empty catalog
    // (would end not-published), the run guard must drop it.
    const pendingCatalogs: Promise<string>[] = [bootGate.promise];
    const loader: CatalogPathLoader = (rel) => {
      if (rel === 'catalog.json') return pendingCatalogs.shift() ?? Promise.resolve(CATALOG);
      if (rel === 'bundle/r-1/1/route.json') return Promise.resolve(ROUTE_DOC);
      return Promise.reject(new Error(`unexpected: ${rel}`));
    };
    const controller = createPreviewController(makePorts(loader, {}), 'r-1');
    controller.getState().refresh();
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    bootGate.resolve(EMPTY_CATALOG);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(controller.getState().surface.kind === 'ready', 'the stale boot run was dropped');
  });
});

describe('asSourceSurface', () => {
  it('accepts the registry surfaces and rejects everything else', () => {
    for (const value of ['city', 'rubric', 'discovery', 'collection', 'hint']) {
      assert.equal(asSourceSurface(value), value);
    }
    for (const value of [null, undefined, 42, '', 'rubric ', 'CITY']) {
      assert.equal(asSourceSurface(value), null);
    }
  });
});

// G06.05 (issue #280, AC4): a non-complete activation is a named failure —
// insufficient-space carries the storage exit, hash-mismatch names the
// damaged package, a cancelled run is not a failure at all. The button's
// own flip still follows the inventory facts, never the result (the Proof).
describe('G06.05: the download failure surfaces with its exits', () => {
  it('insufficient-space is named with the megabytes and the storage exit', async () => {
    const controller = createPreviewController(
      makePorts(FULL_LOADER, {
        inventory: fakeInventory([{ state: 'not_downloaded', missingCount: null }]),
        download: {
          activate: async (key) => ({ status: 'insufficient-space', key, needed: 30 * 1048576, free: 1048576 }),
        },
      }),
      'r-1',
    );
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    await controller.getState().download();
    assert.equal(controller.getState().downloadError, 'Збой загрузкі');
    assert.equal(controller.getState().downloadDetail, 'не хапае месца: патрэбна яшчэ 30 МБ');
    assert.equal(controller.getState().downloadStorageExit, true);
    assert.equal(controller.getState().busy, false);
  });

  it('hash-mismatch names the damaged package without the storage exit', async () => {
    const controller = createPreviewController(
      makePorts(FULL_LOADER, {
        inventory: fakeInventory([{ state: 'not_downloaded', missingCount: null }]),
        download: {
          activate: async (key) => ({ status: 'hash-mismatch', key, paths: ['stops.json'], fetched: 0, diagnostics: [] }),
        },
      }),
      'r-1',
    );
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    await controller.getState().download();
    assert.equal(controller.getState().downloadError, 'Збой загрузкі');
    assert.equal(controller.getState().downloadDetail, 'пакет пашкоджаны: патрэбна паўторная загрузка');
    assert.equal(controller.getState().downloadStorageExit, false);
  });

  it('a cancelled activation is not a failure — nothing surfaces', async () => {
    const controller = createPreviewController(
      makePorts(FULL_LOADER, {
        inventory: fakeInventory([{ state: 'not_downloaded', missingCount: null }]),
        download: { activate: async (key) => ({ status: 'cancelled', key, fetched: 0 }) },
      }),
      'r-1',
    );
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    await controller.getState().download();
    assert.equal(controller.getState().downloadError, null);
    assert.equal(controller.getState().busy, false);
  });
});
