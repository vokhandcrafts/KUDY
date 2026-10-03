// G21.02 guard: the MapLibre legal controls are positioned only by the
// package stylesheet, so the import at the single web stylesheet boundary
// (components/city-map.tsx) is load-bearing — without it the attribution
// control renders in static flow, overflows the map container and collides
// with the server-side ODbL attribution below. Reverting the import or
// shipping a maplibre-gl version whose dist CSS lost the control rules fails
// here; the computed-layout proof itself runs in
// tools/web/map-attribution-regression.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFiles } from './lib/source-walk.ts';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const MAP_CSS_IMPORT = "import 'maplibre-gl/dist/maplibre-gl.css';";
const ATTRIB_RULES = ['.maplibregl-ctrl-attrib', '.maplibregl-ctrl-bottom-right'];

test('the city map component is the single stylesheet import boundary', () => {
  let boundarySeen = false;
  for (const dir of ['app', 'components', 'lib', 'scripts']) {
    for (const { real, rel } of sourceFiles(WEB_ROOT, dir)) {
      const source = fs.readFileSync(real, 'utf8');
      if (!source.includes('maplibre-gl')) continue;
      if (rel === 'components/city-map.tsx') {
        boundarySeen = true;
        assert.ok(
          source.includes(MAP_CSS_IMPORT),
          'components/city-map.tsx must import the pinned MapLibre stylesheet',
        );
        continue;
      }
      assert.doesNotMatch(
        source,
        /maplibre-gl[^\n']*\.css/,
        `the MapLibre stylesheet import must stay in components/city-map.tsx, found in ${rel}`,
      );
    }
  }
  assert.ok(boundarySeen, 'components/city-map.tsx must be present');
});

test('the pinned maplibre-gl package ships the attribution control styles', () => {
  const cssPath = path.join(WEB_ROOT, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl.css');
  assert.ok(fs.existsSync(cssPath), `maplibre-gl dist CSS is missing at ${cssPath} — run npm ci in web/`);
  const css = fs.readFileSync(cssPath, 'utf8');
  for (const rule of ATTRIB_RULES) {
    assert.ok(css.includes(rule), `the pinned maplibre-gl CSS must still define ${rule}`);
  }
});
