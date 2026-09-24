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
