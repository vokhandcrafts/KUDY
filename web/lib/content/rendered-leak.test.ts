// G10.01.b step 6: scanRenderedOutput over a synthetic export tree — the same
// defect classes as the input scan, applied to the rendered files the build
// ships. The real export is scanned at build time by web/scripts/scan-rendered.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRenderedOutput } from './leak-guard.ts';

function writeTree(files: Record<string, string | Buffer>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-web-rendered-'));
  const rootAbs = path.resolve(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.resolve(rootAbs, rel);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
      throw new Error(`fixture key escapes the temp tree: ${rel}`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

test('a clean export passes the rendered-output scan', () => {
  const out = writeTree({
    'index.html': '<a href="/guides/demo-route-a1">гід</a><p>Поўная версія — у дадатку</p>',
    'guides/demo-route-a1.html': '<ol><li>Кропкі</li></ol>',
  });
  assert.equal(scanRenderedOutput({ outDir: out }).ok, true);
});

test('an extended/private path reference in rendered HTML is a violation', () => {
  const out = writeTree({ 'index.html': '<img src="/extended/audio/story.m4a">' });
  const res = scanRenderedOutput({ outDir: out });
  assert.equal(res.ok, false);
  assert.equal(res.violations[0]!.code, 'private-path-in-public');
});

test('an RSC-payload escaped path reference is caught too', () => {
  const out = writeTree({ 'index.txt': '{"href":"\\/private\\/bundle\\/x"}' });
  const res = scanRenderedOutput({ outDir: out });
  assert.equal(res.ok, false);
  assert.equal(res.violations[0]!.code, 'private-path-in-public');
});

test('a source map reference or a .map file is a violation', () => {
  const out = writeTree({
    '_next/static/chunk.js': '//# sourceMappingURL=chunk.js.map',
    '_next/static/data.map': '{}',
  });
  const res = scanRenderedOutput({ outDir: out });
  assert.equal(res.ok, false);
  assert.deepEqual(res.violations.map((v) => v.code), ['source-map-in-public', 'source-map-in-public']);
});

test('binary assets are skipped, not misread as text', () => {
  const out = writeTree({
    'media/story.m4a': Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x00]),
    'index.html': '<main>ok</main>',
  });
  assert.equal(scanRenderedOutput({ outDir: out }).ok, true);
});
