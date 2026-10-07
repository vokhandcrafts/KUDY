import type { MetadataRoute } from 'next';

// ADR G21.44 §6 М3: only the public asset tree is excluded from crawlers.
// Guide, stop, map, catalog, and other page routes stay indexable.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/content/',
    },
  };
}
