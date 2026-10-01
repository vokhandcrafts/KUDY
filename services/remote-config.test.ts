// G09.05 — acceptance suite for services/remote-config (issue #295,
// criteria 3–4). The checker and the defaults are the canonical contract
// module (the same documents the device wiring passes), so the suite
// exercises the production composition: an invalid response or a corrupt
// cache answers with named diagnostics and the next fallback — network →
// cache → defaults — and never throws (criterion 3); the cache row is
// replaced only by an accepted document and survives offline (criterion 4).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkRemoteConfig, loadDefaultRemoteConfig } from '../contracts/config/remote-config.mjs';
import { getSetting } from './db/db.ts';
import { openDatabase } from './db/db.ts';
import { nodeSqliteFileDriver } from './db/test-fixture.ts';
import { readRemoteConfig, refreshRemoteConfig } from './remote-config.ts';
import type { ConfigHttpTransport, RemoteConfigDocument } from './remote-config.ts';
import type { SqlDriver } from './db/types.ts';

const DEFAULTS = loadDefaultRemoteConfig() as RemoteConfigDocument;

function freshStore(): SqlDriver {
  const { driver } = nodeSqliteFileDriver(':memory:');
  openDatabase(driver);
  return driver;
}

const acceptedDoc = (): RemoteConfigDocument => ({ ...DEFAULTS, dwell_ms: 7000 });

function fakeHttp(
  responses: Array<{ status: number; body: unknown } | { failure: string }>,
): { transport: ConfigHttpTransport; calls: () => number } {
  let served = 0;
  return {
    transport: {
      async getConfig() {
        const next = responses[served];
        served += 1;
        if (!next) throw new Error('no scripted response');
        if ('failure' in next) throw new Error(next.failure);
        return next;
      },
    },
    calls: () => served,
  };
}

test('criterion 3: a valid network document is applied and cached', async () => {
  const driver = freshStore();
  const { transport } = fakeHttp([{ status: 200, body: acceptedDoc() }]);
  const result = await refreshRemoteConfig({
    baseUrl: 'https://example.invalid/functions/v1',
    driver,
    check: checkRemoteConfig,
    defaults: DEFAULTS,
    transport,
  });
  assert.equal(result.source, 'network');
  assert.equal(result.config.dwell_ms, 7000);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(JSON.parse(getSetting(driver, 'remote_config_cache') ?? 'null'), acceptedDoc());
});

test('criterion 3: a contract-invalid response falls back to the cache and never overwrites it', async () => {
  const driver = freshStore();
  // Seed the cache with the previously accepted document.
  setSettingRow(driver, 'remote_config_cache', JSON.stringify(acceptedDoc()));
  const { transport } = fakeHttp([{ status: 200, body: { ...DEFAULTS, dwell_ms: 1, unlock_extended: true } }]);
  const result = await refreshRemoteConfig({
    baseUrl: 'https://example.invalid/functions/v1',
    driver,
    check: checkRemoteConfig,
    defaults: DEFAULTS,
    transport,
  });
  assert.equal(result.source, 'cache');
  assert.equal(result.config.dwell_ms, 7000, 'the last accepted document must keep serving');
  const rules = result.diagnostics.map((entry) => entry.rule);
  assert.ok(rules.includes('config-unknown-field'), JSON.stringify(result.diagnostics));
  assert.ok(rules.includes('config-value-below-minimum'), JSON.stringify(result.diagnostics));
  assert.deepEqual(JSON.parse(getSetting(driver, 'remote_config_cache') ?? 'null'), acceptedDoc());
});

test('criterion 4: an unlock-flag response is refused — the closed dictionary cannot open paid content', async () => {
  const driver = freshStore();
  const { transport } = fakeHttp([{ status: 200, body: { ...DEFAULTS, unlock_extended: true } }]);
  const result = await refreshRemoteConfig({
    baseUrl: 'https://example.invalid/functions/v1',
    driver,
    check: checkRemoteConfig,
    defaults: DEFAULTS,
    transport,
  });
  assert.equal(result.source, 'defaults');
  assert.deepEqual(result.config, DEFAULTS);
  assert.deepEqual(
    result.diagnostics.map((entry) => entry.rule),
    ['config-unknown-field'],
  );
});

test('criterion 3: a non-200 answer is a named diagnostic plus the fallback', async () => {
  const driver = freshStore();
  const { transport } = fakeHttp([{ status: 503, body: null }]);
  const result = await refreshRemoteConfig({
    baseUrl: 'https://example.invalid/functions/v1',
    driver,
    check: checkRemoteConfig,
    defaults: DEFAULTS,
    transport,
  });
  assert.equal(result.source, 'defaults');
  assert.deepEqual(result.diagnostics, [{ rule: 'config-fetch-failed', detail: 'status 503' }]);
});

test('criterion 3: a transport failure (offline) answers with the cache, never a throw', async () => {
  const driver = freshStore();
  setSettingRow(driver, 'remote_config_cache', JSON.stringify(acceptedDoc()));
  const { transport } = fakeHttp([{ failure: 'network unreachable' }]);
  const result = await refreshRemoteConfig({
    baseUrl: 'https://example.invalid/functions/v1',
    driver,
    check: checkRemoteConfig,
    defaults: DEFAULTS,
    transport,
  });
  assert.equal(result.source, 'cache');
  assert.equal(result.config.dwell_ms, 7000);
  assert.deepEqual(result.diagnostics, [{ rule: 'config-fetch-failed', detail: 'network unreachable' }]);
});

test('criterion 3: an unparseable body answers with the checker diagnostics, never a throw', async () => {
  const driver = freshStore();
  const { transport } = fakeHttp([{ status: 200, body: '<html>gateway noise</html>' }]);
  const result = await refreshRemoteConfig({
    baseUrl: 'https://example.invalid/functions/v1',
    driver,
    check: checkRemoteConfig,
    defaults: DEFAULTS,
    transport,
  });
  assert.equal(result.source, 'defaults');
  assert.deepEqual(
    result.diagnostics.map((entry) => entry.rule),
    ['config-field-type'],
  );
});

test('criterion 4 offline read: the cache serves without any network work', () => {
  const driver = freshStore();
  setSettingRow(driver, 'remote_config_cache', JSON.stringify(acceptedDoc()));
  const result = readRemoteConfig({ driver, check: checkRemoteConfig, defaults: DEFAULTS });
  assert.equal(result.source, 'cache');
  assert.equal(result.config.dwell_ms, 7000);
  assert.deepEqual(result.diagnostics, []);
});

test('offline read: no cache row means the canonical defaults, no diagnostics', () => {
  const driver = freshStore();
  const result = readRemoteConfig({ driver, check: checkRemoteConfig, defaults: DEFAULTS });
  assert.equal(result.source, 'defaults');
  assert.deepEqual(result.config, loadDefaultRemoteConfig());
  assert.deepEqual(result.diagnostics, []);
});

test('offline read: a corrupt cache row answers with the named diagnostic and the defaults', () => {
  const driver = freshStore();
  setSettingRow(driver, 'remote_config_cache', '{not json');
  const result = readRemoteConfig({ driver, check: checkRemoteConfig, defaults: DEFAULTS });
  assert.equal(result.source, 'defaults');
  assert.deepEqual(result.diagnostics, [
    { rule: 'config-cache-corrupt', detail: 'the cached document is not valid JSON' },
  ]);
});

test('offline read: a contract-invalid cache row is not trusted and not repaired', () => {
  const driver = freshStore();
  setSettingRow(
    driver,
    'remote_config_cache',
    JSON.stringify({ ...DEFAULTS, dwell_ms: 999 }),
  );
  const result = readRemoteConfig({ driver, check: checkRemoteConfig, defaults: DEFAULTS });
  assert.equal(result.source, 'defaults');
  const rules = result.diagnostics.map((entry) => entry.rule);
  assert.deepEqual(rules, ['config-value-below-minimum', 'config-cache-invalid']);
});

function setSettingRow(driver: SqlDriver, key: string, value: string): void {
  driver.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
}
