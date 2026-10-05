// G21.01: checkExportedDocumentLanguage over a synthetic export tree — the
// seven /en pages the issue reproduces (home, app, map, privacy, guide, two
// stops) plus the shared 404.html. The real export is scanned at build time
// by web/scripts/scan-rendered.ts, right beside the leak scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkExportedDocumentLanguage, expectedDocumentLocale } from './exported-language.ts';
import { writeTree } from './test-tree.ts';

const page = (lang: string) => `<!doctype html><html lang="${lang}"><body><main>гід</main></body></html>`;

test('a clean export passes: en pages declare en, be pages and the shared 404 declare the default', () => {
  const out = writeTree({
    'index.html': page('be'),
    'app.html': page('be'),
    'map.html': page('be'),
    'privacy.html': page('be'),
    'guides/demo-route-a1.html': page('be'),
    'guides/demo-route-a1/stops/stop-1.html': page('be'),
    'guides/demo-route-a1/stops/stop-2.html': page('be'),
    '404.html': page('be'),
    'en.html': page('en'),
    'en/app.html': page('en'),
    'en/map.html': page('en'),
    'en/privacy.html': page('en'),
    'en/guides/demo-route-a1.html': page('en'),
    'en/guides/demo-route-a1/stops/stop-1.html': page('en'),
    'en/guides/demo-route-a1/stops/stop-2.html': page('en'),
  });
  assert.equal(checkExportedDocumentLanguage({ outDir: out }).ok, true);
});

test('an en page reporting be is a wrong-document-language violation (the issue defect)', () => {
  const out = writeTree({
    'index.html': page('be'),
    'en.html': page('be'),
    'en/app.html': page('be'),
    'en/map.html': page('be'),
    'en/privacy.html': page('be'),
    'en/guides/demo-route-a1.html': page('be'),
    'en/guides/demo-route-a1/stops/stop-1.html': page('be'),
    'en/guides/demo-route-a1/stops/stop-2.html': page('be'),
  });
  const res = checkExportedDocumentLanguage({ outDir: out });
  assert.equal(res.ok, false);
  assert.deepEqual(
    res.violations.map((v) => v.path),
    ['en.html', 'en/app.html', 'en/guides/demo-route-a1.html', 'en/guides/demo-route-a1/stops/stop-1.html', 'en/guides/demo-route-a1/stops/stop-2.html', 'en/map.html', 'en/privacy.html'],
  );
  assert.deepEqual(
    res.violations.map((v) => [v.code, v.expected, v.actual]),
    res.violations.map(() => ['wrong-document-language', 'en', 'be']),
  );
});

test('a page without a lang attribute is a missing-document-language violation', () => {
  const out = writeTree({ 'en.html': '<!doctype html><html><body></body></html>' });
  const res = checkExportedDocumentLanguage({ outDir: out });
  assert.equal(res.ok, false);
  assert.equal(res.violations[0]!.code, 'missing-document-language');
  assert.equal(res.violations[0]!.actual, null);
});

test('the shared 404.html carries the site default, not a URL locale', () => {
  assert.equal(expectedDocumentLocale('404.html'), 'be');
  const out = writeTree({ '404.html': page('en') });
  const res = checkExportedDocumentLanguage({ outDir: out });
  assert.equal(res.ok, false);
  assert.deepEqual([res.violations[0]!.code, res.violations[0]!.path, res.violations[0]!.expected], ['wrong-document-language', '404.html', 'be']);
});

test('the locale expectation follows the URL prefix in flat and nested export layouts', () => {
  assert.equal(expectedDocumentLocale('en.html'), 'en');
  assert.equal(expectedDocumentLocale('en/index.html'), 'en');
  assert.equal(expectedDocumentLocale('en/guides/demo-route-a1.html'), 'en');
  assert.equal(expectedDocumentLocale('index.html'), 'be');
  assert.equal(expectedDocumentLocale('guides/demo-route-a1/stops/stop-1.html'), 'be');
});

test('backslash rel paths (a Windows export walk) resolve the same URL locale as slash paths', () => {
  // Every exported page shape, in both separators: a backslash path must read
  // as the same URL, not fall through to the site default (the G21.35 defect).
  const cases: [path: string, expected: string][] = [
    ['en.html', 'en'],
    ['en/app.html', 'en'],
    ['en/index.html', 'en'],
    ['en/guides/demo-route-a1.html', 'en'],
    ['en/guides/demo-route-a1/stops/stop-1.html', 'en'],
    ['index.html', 'be'],
    ['app.html', 'be'],
    ['guides/demo-route-a1/stops/stop-1.html', 'be'],
    ['404.html', 'be'],
  ];
  for (const [p, expected] of cases) {
    assert.equal(expectedDocumentLocale(p), expected, p);
    assert.equal(expectedDocumentLocale(p.replaceAll('/', '\\')), expected, p);
  }
});

test('non-html assets are not read as pages', () => {
  const out = writeTree({ 'en/data.json': '{"lang":"be"}', 'media/story.m4a': Buffer.from([0x00, 0x01, 0x02]) });
  assert.equal(checkExportedDocumentLanguage({ outDir: out }).ok, true);
});
