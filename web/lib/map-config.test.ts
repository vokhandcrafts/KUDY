// G10.01.b step 3 provider guard (implementation-rules 1): the recorded
// founder decision — OpenFreeMap, 2026-09-21, docs/agent-tasks/results/
// G10.01.b.md — is the only tile source the web may reference. Reverting the
// config to any other host, or hardcoding a tile URL outside
// lib/map-config.ts, fails here (acceptance 4: tiles from the recorded
// provider only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapProvider } from './map-config.ts';
import { sourceFiles } from './source-walk.ts';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TILE_HOSTS =
  /tiles\.openfreemap\.org|maptiler|tile\.openstreetmap\.org|basemaps\.cartocdn\.com|tiles\.stadiamaps\.com/i;

test('the recorded provider is OpenFreeMap and the attribution target is the OSM copyright page', () => {
  assert.equal(mapProvider.providerName, 'OpenFreeMap');
  assert.match(mapProvider.styleUrl, /^https:\/\/tiles\.openfreemap\.org\/styles\/[a-z0-9-]+$/);
  assert.equal(mapProvider.osmCopyrightUrl, 'https://www.openstreetmap.org/copyright');
});

test('tile hosts appear only in lib/map-config.ts, nowhere else in the web sources', () => {
  let configSeen = false;
  for (const dir of ['app', 'components', 'lib', 'scripts']) {
    for (const { real, rel } of sourceFiles(WEB_ROOT, dir)) {
      // The guard scans production sources; this and other test files name
      // the hosts only inside their own regexes.
      if (rel.endsWith('.test.ts')) continue;
      const source = fs.readFileSync(real, 'utf8');
      if (rel === 'lib/map-config.ts') {
        configSeen = true;
        assert.match(source, TILE_HOSTS, 'the config must still record the provider');
        continue;
      }
      assert.doesNotMatch(source, TILE_HOSTS, `tile URLs must live only in lib/map-config.ts, found in ${rel}`);
    }
  }
  assert.ok(configSeen, 'lib/map-config.ts must be present and record the provider');
});

test('the map page renders the server-side ODbL attribution bound to the config', () => {
  const source = fs.readFileSync(path.join(WEB_ROOT, 'components', 'map-page.tsx'), 'utf8');
  assert.match(source, /mapProvider\.osmCopyrightUrl/, 'the attribution link must resolve through lib/map-config.ts');
  assert.match(source, /strings\.mapAttribution/, 'the attribution text must come from the UI strings');
});
