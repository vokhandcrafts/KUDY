import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkExportedAttribution } from './attribution-guard.ts';
import { writeTree } from './test-tree.ts';

test('the rendered build scan runs the attribution guard', () => {
  const scan = fs.readFileSync(fileURLToPath(new URL('../../scripts/scan-rendered.ts', import.meta.url)), 'utf8');
  assert.match(scan, /checkExportedAttribution\(\{ outDir \}\)/);
});

test('all public guide and stop pages require an attribution block and locale-specific rules link', () => {
  const outDir = writeTree({
    'guides/route.html': '<section data-content-attribution="true"><a href="/usage-rules">rules</a></section>',
    'guides/route/stops/one.html': '<section data-content-attribution="true"><a href="/usage-rules">rules</a></section>',
    'en/guides/route.html': '<section data-content-attribution="true"><a href="/en/usage-rules">rules</a></section>',
    'en/guides/route/stops/two.html': '<section data-content-attribution="true"><a href="/en/usage-rules">rules</a></section>',
  });
  assert.deepEqual(checkExportedAttribution({ outDir }), []);
});

test('removing the block or its rules link makes the named content page fail', () => {
  const outDir = writeTree({
    'guides/route.html': '<main>guide without attribution</main>',
    'en/guides/route/stops/one.html': '<section data-content-attribution="true">no link</section>',
  });
  assert.deepEqual(checkExportedAttribution({ outDir }), [
    { path: 'en/guides/route/stops/one.html', code: 'missing-usage-rules-link' },
    { path: 'guides/route.html', code: 'missing-content-attribution' },
    { path: 'guides/route.html', code: 'missing-usage-rules-link' },
  ]);
});
