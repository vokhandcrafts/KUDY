// Public-page attribution uses only the story's source strings and media
// records matched to files that the public site actually serves. A media.json
// entry alone is insufficient: the manifest can also describe private media.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readBundleMedia } from './bundle.ts';
import type { MediaRecord } from './types.ts';

export interface AttributionData {
  sources: string[];
  media: { credit: string; authorPhoto: boolean }[];
}

const PUBLIC_ASSET_PREFIX = '/content/';

export function publicAttribution(
  root: string,
  routeId: string,
  version: string,
  sources: string[],
  assets: string[],
): AttributionData {
  const uniqueSources = [...new Set(sources.map((source) => source.trim()).filter(Boolean))];
  if (assets.length === 0) return { sources: uniqueSources, media: [] };

  const manifest = readBundleMedia(root, routeId, version);
  if (!manifest.ok) throw new Error(`attribution-media-${manifest.code}: ${routeId}@${version}`);
  const media: AttributionData['media'] = [];
  const seen = new Set<string>();
  const publicRoot = fs.realpathSync(root);
  const routePrefix = `bundle/${routeId}/${version}/`;

  for (const asset of assets) {
    if (!asset.startsWith(PUBLIC_ASSET_PREFIX)) throw new Error(`attribution-asset-path: ${asset}`);
    const rel = asset.slice(PUBLIC_ASSET_PREFIX.length);
    if (!rel.startsWith(routePrefix) || rel.split('/').includes('..')) {
      throw new Error(`attribution-asset-path: ${asset}`);
    }
    const file = path.resolve(publicRoot, ...rel.split('/'));
    if (!file.startsWith(`${publicRoot}${path.sep}`)) throw new Error(`attribution-asset-path: ${asset}`);
    const actualFile = fs.realpathSync(file);
    if (!actualFile.startsWith(`${publicRoot}${path.sep}`)) throw new Error(`attribution-asset-path: ${asset}`);
    const bytes = fs.readFileSync(actualFile);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const matches: MediaRecord[] = manifest.data.filter((candidate) =>
      candidate.sha256 === sha256 && candidate.bytes === bytes.length,
    );
    if (matches.length !== 1) throw new Error(`attribution-media-${matches.length === 0 ? 'unmatched' : 'ambiguous'}: ${asset}`);
    const record = matches[0]!;
    const expectedMime = path.extname(actualFile) === '.webp' ? 'image/webp' : 'audio/mp4';
    if (record.mime !== expectedMime) throw new Error(`attribution-media-mime: ${asset}`);
    const authorPhoto = record.mime === 'image/webp' && record.license === 'author_own';
    const key = `${record.credit}\0${authorPhoto}`;
    if (!seen.has(key)) {
      media.push({ credit: record.credit, authorPhoto });
      seen.add(key);
    }
  }
  return { sources: uniqueSources, media };
}
