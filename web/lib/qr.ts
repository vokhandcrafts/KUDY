// G10.02.a step 3: QR payloads for the route URLs — 06 §3: the link works
// without install, so it is the thing a QR carries. Every payload is built
// here, through the app-links config and the localePath URL builder — never
// hand-typed — and nothing is generated while the site origin is unpublished:
// a QR is only as real as the URL it encodes, and a fabricated origin would
// send a scanned visitor to a foreign domain. The build script
// (scripts/build-qr.ts) writes the print assets when the origin goes live;
// the round-trip decode test (lib/qr.test.ts) proves encode → decode identity
// for the same targets.
import { type AppLinks } from './app-links.ts';
import { localePath } from './content/site.ts';
import type { UiLocale } from './i18n/index.ts';

export interface RouteQrTarget {
  route_id: string;
  locale: UiLocale;
  url: string;
}

// One target per published route × UI locale: the stable guide-page scheme
// (plan §3.3) with the locale prefix the URL builder owns.
export function routeQrTargets(
  links: AppLinks,
  routes: readonly { route_id: string }[],
  locales: readonly UiLocale[],
): RouteQrTarget[] {
  if (links.siteOrigin.kind !== 'live') return [];
  const targets: RouteQrTarget[] = [];
  for (const { route_id } of routes) {
    for (const locale of locales) {
      targets.push({
        route_id,
        locale,
        url: `${links.siteOrigin.href}${localePath(locale, `/guides/${route_id}`)}`,
      });
    }
  }
  return targets;
}
