// Issue #209 criterion 2 — the same composition root that builds the app
// builds the test: fake ports go in, the sample controller is driven end to
// end in plain Node. No React, no React Native, no Expo; the service side is
// the real production code (services/contentRepo) over the synthetic package
// fixture from G04.03.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServices } from './createServices.ts';
import { createSampleController } from './sampleController.ts';
import { KEY, storeAt, tempPackage } from '../services/contentRepo/test-fixture.ts';
import type { PackageStore } from '../services/contentRepo/types.ts';

test('criterion 2: the root with a fake port drives the sample controller end to end', async () => {
  const { root, remove } = tempPackage();
  try {
    const services = createServices({ packageStore: storeAt(root) });
    assert.ok(services.contentRepo, 'the root constructs contentRepo from the provided port');

    const controller = createSampleController(services.contentRepo);
    assert.equal(controller.getState().readiness, null);
    assert.equal(controller.getState().loading, false);

    await controller.getState().refresh({ locale: 'be', tier: 'base' });

    const { readiness, loading, error } = controller.getState();
    assert.equal(error, null);
    assert.equal(loading, false);
    assert.equal(readiness?.status, 'ready');
    assert.deepEqual(readiness?.tierAvailable, ['base']);
  } finally {
    remove();
  }
});

test('criterion 2: without the port the root constructs no contentRepo (the app build today)', () => {
  const services = createServices({});
  assert.deepEqual(services, { contentRepo: undefined });
});

test('criterion 2: a failing port surfaces as a readiness card, not a crash', async () => {
  const services = createServices({
    packageStore: {
      key: KEY,
      readFile: () => Promise.reject(new Error('disk gone')),
      exists: () => Promise.reject(new Error('disk gone')),
    },
  });
  assert.ok(services.contentRepo);

  const controller = createSampleController(services.contentRepo);
  await controller.getState().refresh({ locale: 'be', tier: 'base' });

  const { readiness, loading, error } = controller.getState();
  assert.equal(error, null);
  assert.equal(loading, false);
  assert.equal(readiness?.status, 'incomplete');
  assert.ok(readiness?.status === 'incomplete' && readiness.missing.length > 0);
});

test('criterion 2: a superseded refresh never overwrites the newer result', async () => {
  const { root, remove } = tempPackage();
  try {
    // The first refresh is gated on a read that only resolves after the second
    // refresh has completed; when it finally lands it must be discarded.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gated = true;
    const base = storeAt(root);
    const gatedStore: PackageStore = {
      key: KEY,
      exists: (rel) => base.exists(rel),
      readFile: (rel) => {
        if (!gated) return base.readFile(rel);
        gated = false;
        return gate.then(() => Promise.reject(new Error('superseded read')));
      },
    };
    const services = createServices({ packageStore: gatedStore });
    assert.ok(services.contentRepo);
    const controller = createSampleController(services.contentRepo);

    const first = controller.getState().refresh({ locale: 'be', tier: 'base' });
    const second = controller.getState().refresh({ locale: 'be', tier: 'base' });
    await second;
    assert.equal(controller.getState().readiness?.status, 'ready');

    release();
    await first;
    assert.equal(controller.getState().readiness?.status, 'ready');
    assert.equal(controller.getState().error, null);
    assert.equal(controller.getState().loading, false);
  } finally {
    remove();
  }
});
