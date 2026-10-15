import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { loadDemoBytes, loadDemoText, decodeDemoBytes } from '../controllers/demoCatalog.ts';
import { createServices } from '../controllers/createServices.ts';

test('offline demo is the published, hash-verified sample catalog', async () => {
  const catalog = JSON.parse(await loadDemoText('catalog.json'));
  assert.equal(catalog.catalog_schema_version, 1);
  assert.equal(catalog.routes.length, 1);
  const indexBytes = await loadDemoBytes(catalog.discovery_index.path);
  assert.equal(createHash('sha256').update(indexBytes).digest('hex'), catalog.discovery_index.sha256);
  const index = JSON.parse(new TextDecoder().decode(indexBytes));
  assert.equal(index.city_id, 'gdansk');
  assert.match(index.offers[0].localized.title.be, /дэма/);
  assert.match(index.offers[0].localized.title.en, /demo/);
  const route = JSON.parse(await loadDemoText('bundle/e2e-free-guide/1/be/base/route.json'));
  assert.equal(route.stops.length, 3);
  assert.equal(route.stops[0].preview.name.be, 'Пачатак гісторыі');
  assert.equal(route.stops[0].preview.announce.be, 'Знаёмства з дэманстрацыйным маршрутам');
  assert.equal(route.stops[2].preview.name.en, 'The final stop');
  assert.ok((await loadDemoBytes('bundle/e2e-free-guide/1/be/base/audio/story-free-1.m4a')).length > 1000);
});

test('demo source rejects unknown paths and malformed bytes', async () => {
  await assert.rejects(loadDemoBytes('../catalog.json'), /demo-file-unavailable/);
  assert.throws(() => decodeDemoBytes('bad'), /demo-base64-invalid/);
  assert.throws(() => decodeDemoBytes('a==='), /demo-base64-invalid/);
});

test('demo app installs separately from the production app', () => {
  const script = "const c=require('./app.config.js').expo; console.log(c.name+'|'+c.android.package)";
  const demo = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8', env: { ...process.env, EXPO_PUBLIC_DEMO_MODE: '1' },
  }).trim();
  const standard = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8', env: { ...process.env, EXPO_PUBLIC_DEMO_MODE: '' },
  }).trim();
  assert.equal(demo, 'KUDY Demo|by.kudy.app.demo');
  assert.equal(standard, 'KUDY|by.kudy.app');
});

test('the app composition reads the embedded guide as a normal catalog', async () => {
  const services = createServices({
    catalogLoader: loadDemoText,
    catalogSha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
  });
  assert.ok(services.catalog);
  await services.catalog.controller.getState().refresh();
  const surface = services.catalog.controller.getState().surface;
  assert.equal(surface.kind, 'ready');
  assert.match(surface.guides[0].title, /дэма/);
});

test('checked-in sample bytes match the publishing path', () => {
  const eol = execFileSync('git', ['check-attr', 'eol', '--', 'controllers/demoCatalog.generated.ts'], { encoding: 'utf8' });
  assert.match(eol, /: eol: lf\s*$/);
  const out = execFileSync(process.execPath, ['tools/demo/build-demo.mjs', '--check'], { encoding: 'utf8' });
  assert.match(out, /demo catalog:/);
});
