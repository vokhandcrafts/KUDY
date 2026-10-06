// G21.22 (issue #554, criterion 4): the sitemap derivation follows actual
// published text. The chrome routes exist in every UI locale; guide and stop
// pages are advertised only for the locales whose text is actually published
// — an untranslated guide variant never enters the sitemap. Absolute URLs
// need the site origin: while appLinks.siteOrigin is unpublished the sitemap
// stays empty (no fabricated origin — the build-qr rule); the G10.02.b
// publication switches it on with no contract change.
import { appLinks, type AppLinks } from '../app-links.ts';
import { uiLocales } from '../i18n/index.ts';
import { guideStaticParams, localePath, routeTextLocales, stopStaticParams } from './site.ts';

// The chrome paths published in every UI locale (plan §4): the catalog, the
// map, the app fallback and the privacy policy.
const CHROME_PATHS: readonly string[] = ['/', '/map', '/app', '/privacy'];

// The advertised paths of one content root: chrome in every locale, guide and
// stop pages per published text locale. Root-relative — the same scheme
// localePath serves the hreflang links.
export function sitemapPaths(root: string): string[] {
  const paths: string[] = [];
  for (const chrome of CHROME_PATHS) {
    for (const locale of uiLocales) {
      paths.push(localePath(locale, chrome));
    }
  }
  const stopsByRoute = new Map<string, string[]>();
  for (const { route_id, stop_id } of stopStaticParams(root)) {
    const stops = stopsByRoute.get(route_id);
    if (stops) stops.push(stop_id);
    else stopsByRoute.set(route_id, [stop_id]);
  }
  for (const { route_id } of guideStaticParams(root)) {
    const textLocales = routeTextLocales(root, route_id);
    for (const locale of textLocales) {
      paths.push(localePath(locale, `/guides/${route_id}`));
    }
    for (const stop_id of stopsByRoute.get(route_id) ?? []) {
      for (const locale of textLocales) {
        paths.push(localePath(locale, `/guides/${route_id}/stops/${stop_id}`));
      }
    }
  }
  return paths;
}

// The sitemap entries of one content root: absolute URLs against the config's
// site origin, or nothing while the origin is unpublished.
export function buildSitemapEntries(root: string, links: AppLinks = appLinks): { url: string }[] {
  const origin = links.siteOrigin;
  if (origin.kind !== 'live') return [];
  return sitemapPaths(root).map((path) => ({ url: new URL(path, origin.href).toString() }));
}
