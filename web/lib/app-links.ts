// The single app-transition config (plan 2026-09-16-web-audio-version §3):
// every app destination — store URLs, the future deep-link base, the print
// origin, per-route product references — lives here, and every paid-content
// CTA resolves through appDestination. No page hardcodes an external app or
// store URL; the committed scan (lib/content/app-links-scan.test.ts) fails if
// one appears anywhere else (implementation-rules 1).
//
// The app is not published: store URLs do not exist and are never fabricated.
// A destination is therefore the explicit `unpublished` state or a `live`
// https URL — the two shapes are distinct variants, so a placeholder can
// never be confused with a real URL in the type system.

export type Unpublished = { kind: 'unpublished' };

export type LiveUrl<T extends string> = { kind: 'live'; href: T };

// A store URL: the explicit unpublished state or an https URL.
export type StoreUrl = Unpublished | LiveUrl<`https://${string}`>;

// The origin QR codes and card images absolutize against. Unpublished until
// the G10.02.b publication decides the domain — no QR or og:image encodes a
// fabricated origin before that.
export type SiteOrigin = Unpublished | LiveUrl<`https://${string}`>;

export type StoreKind = 'appStore' | 'playStore';

export interface AppLinks {
  appStore: StoreUrl;
  playStore: StoreUrl;
  // M7 universal links (09 §13): the app mirrors the stable web path scheme,
  // so the deep link of a page is deepLinkBase + the same path the web serves.
  // Unpublished until the app ships.
  deepLinkBase: Unpublished | LiveUrl<`https://${string}`>;
  siteOrigin: SiteOrigin;
  // The internal page every CTA lands on while the stores are unpublished —
  // 16 G10.02: «неўсталяваны дадатак не дае тупік».
  fallbackPath: '/app';
}

export const appLinks: AppLinks = {
  appStore: { kind: 'unpublished' },
  playStore: { kind: 'unpublished' },
  deepLinkBase: { kind: 'unpublished' },
  siteOrigin: { kind: 'unpublished' },
  fallbackPath: '/app',
};

// Where a paid-content CTA goes — the one mapping point pages bind their CTA
// hrefs to. A live store URL when the store is live; the internal /app page
// otherwise. An unpublished store is the «хутка» state, never a broken link.
export interface AppDestination {
  href: string;
  store: 'unpublished' | 'live';
}

export function appDestination(links: AppLinks, store: StoreKind): AppDestination {
  const url = links[store];
  return url.kind === 'live'
    ? { href: url.href, store: 'live' }
    : { href: links.fallbackPath, store: 'unpublished' };
}

// Per-route product references (catalog `product_id`, 09 §4): the single
// mapping point from a catalog route entry to the purchase product a future
// per-route deep link carries. Null when the catalog publishes none — the
// interim fixture catalog does not, a real G02.04 catalog can.
export function routeProductId(entry: { route_id: string; product_id?: string }): string | null {
  return entry.product_id ?? null;
}

// The deep link of a stable web path (M7): deepLinkBase + the same path.
// Unpublished base → null — the web page itself stays the target, which is
// what keeps the no-dead-end rule true before the app exists.
export function routeDeepLink(links: AppLinks, webPath: string): string | null {
  return links.deepLinkBase.kind === 'live' ? `${links.deepLinkBase.href}${webPath}` : null;
}
