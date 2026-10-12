// #727 — the preview's evaluateLayer port (sessionPorts): the verdict reads
// the run's own map facts, so the unit matrix pins the refusal vocabulary
// (run-map#*) and the corrupt-input diagnostics — the gate can never widen.
// The store is the production expo adapter over the fake File/Directory
// classes; the only stand-in sits on the Expo/OS boundary (V1). The package
// documents ride the shared controllers fixture.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEvaluateLayer } from './sessionPorts.ts';
import { PLACES_JSON, ROUTE_JSON, enc } from './test-fixture.ts';
import { createExpoBundlesStore } from '../services/contentRepo/expo/expo-package-store.ts';
import { makeFakeFs, makeFakeFsModule } from '../services/contentRepo/expo/fs-test-fixture.ts';

function layerWith(files: Record<string, string>): { store: ReturnType<typeof createExpoBundlesStore> } {
  const fs = makeFakeFs();
  for (const [name, body] of Object.entries(files)) {
    fs.files.set(`/root/bundles/route-491/1/be/base/${name}`, enc(body));
  }
  const fakeFsModule = makeFakeFsModule(fs);
  return {
    store: createExpoBundlesStore(
      { File: fakeFsModule.File as never, Directory: fakeFsModule.Directory as never },
      fakeFsModule.Paths.document as never,
    ),
  };
}

test('#727: a complete layer answers ready from the map facts', async () => {
  const { store } = layerWith({ 'route.json': ROUTE_JSON, 'places.json': PLACES_JSON });
  const evaluate = createEvaluateLayer({ bundlesStore: store });
  assert.deepEqual(await evaluate({ routeId: 'route-491', version: '1', locale: 'be', tier: 'base' }), {
    status: 'ready',
    routeId: 'route-491',
    version: '1',
    tier: 'base',
    tierAvailable: ['base'],
  });
});

test('#727: a missing run document is a named refusal, never a ready verdict', async () => {
  const withoutRoute = layerWith({ 'places.json': PLACES_JSON });
  assert.deepEqual(
    await createEvaluateLayer({ bundlesStore: withoutRoute.store })({
      routeId: 'route-491',
      version: '1',
      locale: 'be',
      tier: 'base',
    }),
    { status: 'incomplete', missing: ['run-map#route-json-missing'] },
  );
  const withoutPlaces = layerWith({ 'route.json': ROUTE_JSON });
  assert.deepEqual(
    await createEvaluateLayer({ bundlesStore: withoutPlaces.store })({
      routeId: 'route-491',
      version: '1',
      locale: 'be',
      tier: 'base',
    }),
    { status: 'incomplete', missing: ['run-map#places-json-missing'] },
  );
});

test('#727: a foreign route document is an identity refusal', async () => {
  const foreign = layerWith({
    'route.json': ROUTE_JSON.replace('"route-491"', '"route-other"'),
    'places.json': PLACES_JSON,
  });
  assert.deepEqual(
    await createEvaluateLayer({ bundlesStore: foreign.store })({
      routeId: 'route-491',
      version: '1',
      locale: 'be',
      tier: 'base',
    }),
    { status: 'incomplete', missing: ['run-map#route-json-identity'] },
  );
});

test('#727: a stop without its place geometry refuses the whole read', async () => {
  const unplaced = layerWith({
    'route.json': ROUTE_JSON.replace('"place-1"', '"place-missing"'),
    'places.json': PLACES_JSON,
  });
  assert.deepEqual(
    await createEvaluateLayer({ bundlesStore: unplaced.store })({
      routeId: 'route-491',
      version: '1',
      locale: 'be',
      tier: 'base',
    }),
    { status: 'incomplete', missing: ['run-map#stop-unplaced:stop-1'] },
  );
});

test('#727: unsafe key segments are diagnostics, never a filesystem call', async () => {
  const { store } = layerWith({ 'route.json': ROUTE_JSON, 'places.json': PLACES_JSON });
  const evaluate = createEvaluateLayer({ bundlesStore: store });
  assert.deepEqual(
    await evaluate({ routeId: '../evil', version: '1', locale: 'be', tier: 'base' }),
    { status: 'incomplete', missing: ['route_id#unsafe-path:../evil'] },
  );
  assert.deepEqual(
    await evaluate({ routeId: 'route-491', version: '1', locale: 'be', tier: 'premium' as never }),
    { status: 'incomplete', missing: ['tier#type'] },
  );
});

test('#727: extended stays access-locked — the device has no grant source', async () => {
  const { store } = layerWith({ 'route.json': ROUTE_JSON, 'places.json': PLACES_JSON });
  assert.deepEqual(
    await createEvaluateLayer({ bundlesStore: store })({
      routeId: 'route-491',
      version: '1',
      locale: 'be',
      tier: 'extended',
    }),
    { status: 'access-locked', tier: 'extended' },
  );
});
