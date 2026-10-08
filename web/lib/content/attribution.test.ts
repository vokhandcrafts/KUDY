import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { publicAttribution } from './attribution.ts';

test('only public files contribute media credits; author-owned photos are marked by fact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-attribution-'));
  const bundle = path.join(root, 'bundle', 'route', '1');
  fs.mkdirSync(bundle, { recursive: true });
  const items = [
    { rel: 'cover.webp', bytes: Buffer.from('author photo'), mime: 'image/webp', license: 'author_own', credit: 'KUDY author' },
    { rel: 'be/base/audio/story.m4a', bytes: Buffer.from('public audio'), mime: 'audio/mp4', license: 'public_domain', credit: 'Archive recording' },
    { rel: 'be/extended/audio/private.m4a', bytes: Buffer.from('private audio'), mime: 'audio/mp4', license: 'licensed', credit: 'PRIVATE CREDIT' },
  ];
  for (const item of items) {
    const file = path.join(bundle, item.rel);
    if (!item.rel.includes('/extended/')) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, item.bytes);
    }
  }
  const media = items.map((item, index) => ({
    media_id: `media-${index}`,
    sha256: createHash('sha256').update(item.bytes).digest('hex'),
    bytes: item.bytes.length,
    mime: item.mime,
    locale: 'be',
    license: item.license,
    credit: item.credit,
  }));
  fs.writeFileSync(path.join(bundle, 'media.json'), JSON.stringify(media));
  const result = publicAttribution(root, 'route', '1', ['Archive A', 'Archive A'], [
    '/content/bundle/route/1/cover.webp',
    '/content/bundle/route/1/be/base/audio/story.m4a',
  ]);
  assert.deepEqual(result, {
    sources: ['Archive A'],
    media: [
      { credit: 'KUDY author', authorPhoto: true },
      { credit: 'Archive recording', authorPhoto: false },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE CREDIT|public_domain|author_own/);
});

test('unmatched or private assets cannot be presented as public attribution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-attribution-'));
  const bundle = path.join(root, 'bundle', 'route', '1');
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(bundle, 'media.json'), '[]');
  fs.writeFileSync(path.join(bundle, 'cover.webp'), 'unrecorded');
  assert.throws(() => publicAttribution(root, 'route', '1', [], ['/content/bundle/route/1/cover.webp']), /attribution-media-unmatched/);
  assert.throws(() => publicAttribution(root, 'route', '1', [], ['/content/bundle/route/1/../other.webp']), /attribution-asset-path/);
  fs.writeFileSync(path.join(bundle, 'media.json'), '{broken');
  assert.throws(() => publicAttribution(root, 'route', '1', [], ['/content/bundle/route/1/cover.webp']), /attribution-media-invalid-json/);
});
