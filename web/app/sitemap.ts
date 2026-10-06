import type { MetadataRoute } from 'next';
import { appLinks } from '../lib/app-links.ts';
import { buildSitemapEntries } from '../lib/content/sitemap.ts';
import { getContentRoot } from '../lib/content/site.ts';

// G21.22 (issue #554, criterion 4): the static export's sitemap.xml. The
// derivation advertises only actually published text; while the site origin
// is unpublished the urlset stays empty — nothing fabricated (the build-qr
// rule). The derivation itself is proven by lib/content/sitemap tests
// (sitemap_actual_translations).
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemapEntries(getContentRoot(), appLinks);
}
