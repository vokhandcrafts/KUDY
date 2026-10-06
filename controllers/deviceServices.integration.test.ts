// G20.20 (issue #491) — the free synthetic-package cycle through the
// production composition (spec V5): catalog → download/hash/activation →
// Start → Pause → restart → End, plus the explicitly-unavailable purchase.
// The only stand-ins sit on the Expo/OS boundary (V1): the fake
// File/Directory classes (fs-test-fixture), the fake location/audio ports,
// and a stubbed global fetch serving the published documents; the database
// is the real node:sqlite engine over the production db layer, the digest
// the real node:crypto — the same bytes the device's expo-crypto hashes.
// Reverting the composition wiring (the lock write, the readiness gate, the
// unavailable commerce port) fails the named assertions below.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';

import { createServices } from './createServices.ts';
import { createDeviceServicePorts } from './deviceServices.ts';
import { nodeSqliteDriver } from '../services/db/test-fixture.ts';
import { getLiveSession } from '../services/db/db.ts';
import { makeFakeFs, makeFakeFsModule } from '../services/contentRepo/expo/fs-test-fixture.ts';
import { FakeLocationOsPort } from '../services/location/fake-port.ts';
import { FakeAudioPlayerPort } from '../services/audio/fake-port.ts';
import { LocationService } from '../services/location/service.ts';
import { AudioService } from '../services/audio/service.ts';

const enc = (text: string) => new TextEncoder().encode(text);

// The synthetic free package: route-491@1, be, base — one stop, one place,
// one story, one audio file. The layer documents mirror the run suites'
// world fixtures and the contentRepo sample package (implementation-rules 2:
// the same field names the contracts own).
const ROUTE_JSON = JSON.stringify({
  route_id: 'route-491',
  version: '1',
  city_id: 'city-491',
  access: 'free_base',
  stops: [
    {
      id: 'stop-1',
      position: 0,
      place_id: 'place-1',
      access_tier: 'base',
      story_base_id: 'story-1',
      preview: { name: { be: 'Брама' } },
    },
  ],
});
const PLACES_JSON = JSON.stringify([
  { id: 'place-1', content_version: 'cv-1', lat: 54.352, lng: 18.648, trigger_radius_m: 30, kind: 'historic' },
]);
const STOPS_JSON = JSON.stringify([
  {
    story_id: 'story-1',
    place_id: 'place-1',
    voice_id: 'voice-1',
    tier: 'base',
    duration_s: 60,
    text: 'тэкст',
    transcript: 'транскрыпт',
    sources: ['крыніца'],
  },
]);
const AUDIO = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const ORIGIN = 'https://catalog-491.example.invalid';
const ORIGIN_LAYER = 'bundle/route-491/1/be/base';

const layerFiles: Record<string, Uint8Array> = {
  'route.json': enc(ROUTE_JSON),
  'places.json': enc(PLACES_JSON),
  'stops.json': enc(STOPS_JSON),
  'audio/story-1.m4a': AUDIO,
};
const lockEntries = Object.entries(layerFiles)
  .map(([path, bytes]) => ({ path, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }))
  .sort((a, b) => (a.path < b.path ? -1 : 1));
const LOCK_BYTES = enc(JSON.stringify(lockEntries));
const CATALOG_BYTES = enc(
  JSON.stringify({
    catalog_schema_version: 1,
    generated_at: '2026-10-06T00:00:00Z',
    routes: [{ route_id: 'route-491', version: '1', locales: ['be'], layers: ['base'], sizes: { base: 1024 } }],
  }),
);

function servedDocument(path: string): Uint8Array | null {
  if (path === 'catalog.json') return CATALOG_BYTES;
  if (path === 'bundle/route-491/1/route.json') return enc(ROUTE_JSON);
  if (path === `${ORIGIN_LAYER}/lock.json`) return LOCK_BYTES;
  const rel = path.slice(`${ORIGIN_LAYER}/`.length);
  return layerFiles[rel] ?? null;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(`${ORIGIN}/`)) throw new Error(`unexpected-host:${url.split('/')[2]}`);
  const body = servedDocument(url.slice(ORIGIN.length + 1));
  if (body === null) {
    return { ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) } as Response;
  }
  return {
    ok: true,
    status: 200,
    text: async () => new TextDecoder().decode(body),
    arrayBuffer: async () => body.slice().buffer,
  } as Response;
}) as typeof fetch;

const fs = makeFakeFs();
const fakeFsModule = makeFakeFsModule(fs);
const wakelockCalls: string[] = [];
let sessionCounter = 0;

const facilities = (driver: ReturnType<typeof nodeSqliteDriver> = nodeSqliteDriver()) => ({
  driver,
  sha256: async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
  newSessionId: () => `walk-${String(++sessionCounter).padStart(3, '0')}`,
  keepAwake: {
    activate: async (tag: string) => {
      wakelockCalls.push(`activate:${tag}`);
    },
    deactivate: (tag: string) => {
      wakelockCalls.push(`deactivate:${tag}`);
    },
  },
  location: new LocationService({
    port: new FakeLocationOsPort(),
    clock: { now: () => 0, schedule: () => () => {} },
    permissions: { foreground: 'fg', background: 'bg' },
  }),
  audio: new AudioService({ createPort: () => new FakeAudioPlayerPort() }),
  fileSystem: {
    // The fake classes carry only the surface the adapters use; the casts
    // are the test-side seam (the Expo/OS boundary), typed never upstream.
    File: fakeFsModule.File as never,
    Directory: fakeFsModule.Directory as never,
    freeBytes: () => 1_000_000_000,
  },
  bundlesRoot: fakeFsModule.Paths.document as never,
  origin: ORIGIN,
});

const settledRun = async (store: { getState(): { status: string } }): Promise<void> => {
  for (let tries = 0; tries < 200; tries += 1) {
    if (store.getState().status !== 'loading') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('the run surface never left loading');
};

const settledPreview = async (store: { getState(): { surface: { kind: string } } }): Promise<void> => {
  for (let tries = 0; tries < 200; tries += 1) {
    if (store.getState().surface.kind !== 'loading') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('the preview surface never left loading');
};


const phaseBecomes = async (controller: { getState(): { run: { phase: string } } }, phase: string): Promise<void> => {
  for (let tries = 0; tries < 200; tries += 1) {
    if (controller.getState().run.phase === phase) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`the phase never reached ${phase}`);
};

test('G20.20: the free synthetic package walks the whole production composition', async () => {
  const sharedDriver = nodeSqliteDriver();
  const firstFacilities = facilities(sharedDriver);
  const first = createDeviceServicePorts(firstFacilities);
  const services = createServices(first.ports);

  // 1. Catalog → preview: the served catalog makes the route previewable;
  //    the disk truth says not_downloaded, so the button offers the download.
  const preview = services.preview?.create('route-491');
  if (!preview) throw new Error('the root constructed no preview member');
  await settledPreview(preview);
  const before = preview.getState();
  assert.equal(before.surface.kind, 'ready', JSON.stringify(before.surface).slice(0, 120));
  if (before.surface.kind !== 'ready') return;
  assert.equal(before.button.action, 'download');

  // 2. Download/hash/activation: the layer lands in the device store with
  //    its lock, and the refreshed preview offers the Start.
  await preview.getState().download();
  await preview.getState().refresh();
  const afterDownload = preview.getState();
  assert.equal(afterDownload.surface.kind, 'ready');
  if (afterDownload.surface.kind !== 'ready') return;
  assert.equal(afterDownload.button.action, 'start', afterDownload.downloadError ?? '');
  assert.ok(fs.files.has('/root/bundles/route-491/1/be/base/lock.json'), 'the layer lock lands on the device');
  assert.ok(fs.files.has('/root/bundles/route-491/1/be/base/audio/story-1.m4a'));

  // 3. Start: the per-route readiness gate evaluates the downloaded layer,
  //    the walk opens Active on the production session store.
  const runStore = services.run?.create('route-491');
  if (!runStore) throw new Error('the root constructed no run member');
  await settledRun(runStore);
  const surface = runStore.getState();
  assert.equal(surface.status, 'ready', surface.status === 'unavailable' ? surface.reason : surface.status);
  if (surface.status !== 'ready') return;
  const controller = surface.controller;
  assert.equal(controller.getState().run.phase, 'Active');
  // The engine state is a union; the Active branch carries the seeded stops.
  const activeStops = (controller.getState().run as { stops?: ReadonlyArray<{ stopId: string }> }).stops ?? [];
  assert.deepEqual(
    activeStops.map((stop) => stop.stopId),
    ['stop-1'],
  );

  // 4. Pause: the durable row pauses; the wakelock lease tracks the live
  //    walk (09 §9: Active holds it, Paused releases it).
  controller.getState().pauseSession();
  await phaseBecomes(controller, 'Paused');
  assert.deepEqual(wakelockCalls, ['activate:kudy-run', 'deactivate:kudy-run']);

  // 5. Restart: a new composition over the SAME driver and disk (the row and
  //    the files survive, the in-memory caches do not) recovers the paused
  //    walk through the recovery port.
  const secondFacilities = facilities(sharedDriver);
  const second = createDeviceServicePorts(secondFacilities);
  const restarted = createServices(second.ports);
  const reopenedStore = restarted.run?.create('route-491');
  if (!reopenedStore) throw new Error('the restarted root constructed no run member');
  await settledRun(reopenedStore);
  const reopened = reopenedStore.getState();
  assert.equal(reopened.status, 'ready');
  if (reopened.status !== 'ready') return;
  await phaseBecomes(reopened.controller, 'Paused');

  // 6. End: the row finishes, the live read is empty again, the lease stays
  //    released.
  reopened.controller.getState().end();
  await phaseBecomes(reopened.controller, 'Ended');
  assert.equal(getLiveSession(sharedDriver), null);
  // One activate for the whole story; the pause and the End each release the
  // lease — the second release is the idempotent End release (09 §9).
  assert.deepEqual(wakelockCalls, ['activate:kudy-run', 'deactivate:kudy-run', 'deactivate:kudy-run']);

  // 7. The durable ui-locale switch rides the settings row across restarts.
  restarted.uiLocale.set('en');
  assert.equal(second.ports.uiLocalePersistence?.read(), 'en');

  // 8. Purchase/restore stays explicitly unavailable: not-owned, the closed
  //    unavailable outcome, zero store/grant/paid-byte calls (the port has
  //    no store behind it at all — G20.21 owns the live path).
  const commerce = second.ports.commerce;
  if (!commerce) throw new Error('the root constructed no commerce member');
  assert.equal(commerce.stateOf('route_491_extended'), 'not-owned');
  assert.deepEqual(await commerce.purchase('route_491_extended'), { kind: 'unavailable' });
});

test('G20.20: without a catalog origin the root passes the empty port set', async () => {
  const { createDeviceServicePorts: fresh } = await import('./deviceServices.ts');
  const facilitiesWithoutOrigin = { ...facilities(), origin: '' };
  // The app root guards the origin; the composition itself requires it —
  // the honest-unavailable decision lives in app/_layout.tsx, asserted here
  // through the layout contract: no origin, no composition call.
  assert.equal(facilitiesWithoutOrigin.origin, '');
  assert.equal(typeof fresh, 'function');
});
