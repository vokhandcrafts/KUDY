// G10.02.a step 4: OG/Twitter card metadata for the guide and stop pages,
// built only from the four public fields the plan names (cover, name,
// announce/summary, duration) — 16 G10.02: «метададзеныя не раскрываюць
// private». A locked stop's description is its preview announce, verbatim;
// a free stop's is the route summary. The transcript never reaches a card.
// G21.22 (issue #554): the page metadata also owns the canonical/hreflang
// derivation — both follow actual published text, and an unavailable-language
// page is marked noindex instead of advertising an untranslated variant.
import type { Metadata } from 'next';
import { appLinks, type AppLinks } from '../app-links.ts';
import type { GuidePageData, StopPageData } from './site.ts';
import { localePath, readSiteGuidePage, readSiteStopPage, routeTextLocales } from './site.ts';
import { getUiStrings, uiLocales, type UiLocale } from '../i18n/index.ts';

export interface CardMeta {
  title: string;
  description: string;
  // The card image, absolutized against the config's siteOrigin. Null while
  // the origin is unpublished — no card carries a fabricated absolute URL,
  // and G10.02.b's publication switches this on with no contract change.
  image: string | null;
  card: 'summary' | 'summary_large_image';
}

// The route's cover is a site-served media reference (route.schema.json:
// free-form string). new URL(cover, origin) resolves bare names and paths
// alike against the single origin from the config.
export function cardImage(links: AppLinks, cover: string | null): string | null {
  return links.siteOrigin.kind === 'live' && cover ? new URL(cover, links.siteOrigin.href).toString() : null;
}

export function guideCardMeta(data: GuidePageData, links: AppLinks = appLinks): CardMeta {
  const image = cardImage(links, data.cover);
  return { title: data.title, description: data.summary, image, card: image ? 'summary_large_image' : 'summary' };
}

export function stopCardMeta(data: StopPageData, links: AppLinks = appLinks): CardMeta {
  const description = data.locked ? data.announce : data.route_summary;
  const image = cardImage(links, data.route_cover);
  return { title: data.name, description, image, card: image ? 'summary_large_image' : 'summary' };
}

// The page-level metadata builders: one derivation per surface kind, called
// by the be/en guide and stop pages — the pages stay thin, the card rules
// live here only.
function toMetadata(meta: CardMeta): Metadata {
  const openGraph: Metadata['openGraph'] = { title: meta.title, description: meta.description };
  if (meta.image) openGraph.images = [meta.image];
  const twitter: NonNullable<Metadata['twitter']> = {
    card: meta.card,
    title: meta.title,
    description: meta.description,
  };
  if (meta.image) twitter.images = [meta.image];
  return { openGraph, twitter };
}

export function guidePageMetadata(root: string, locale: UiLocale, routeId: string): Metadata {
  const textLocales = routeTextLocales(root, routeId);
  if (!textLocales.includes(locale)) return unavailablePageMetadata(locale);
  return {
    ...toMetadata(guideCardMeta(readSiteGuidePage(root, locale, routeId))),
    alternates: pageAlternates(locale, `/guides/${routeId}`, textLocales),
  };
}

export function stopPageMetadata(root: string, locale: UiLocale, routeId: string, stopId: string): Metadata {
  const textLocales = routeTextLocales(root, routeId);
  if (!textLocales.includes(locale)) return unavailablePageMetadata(locale);
  return {
    ...toMetadata(stopCardMeta(readSiteStopPage(root, locale, routeId, stopId))),
    alternates: pageAlternates(locale, `/guides/${routeId}/stops/${stopId}`, textLocales),
  };
}

// G21.22 (issue #554): canonical/hreflang follow actual published text. The
// paths stay root-relative — the site origin is unpublished and no link tag
// encodes a fabricated origin (the appLinks.siteOrigin rule); G10.02.b's
// publication can absolutize them with no contract change. A guide/stop page
// advertises hreflang only for the locales its text is actually published in;
// chrome pages, published in every UI locale, advertise all of them.
export function pageAlternates(locale: UiLocale, pagePath: string, textLocales: readonly UiLocale[]): Metadata['alternates'] {
  return {
    canonical: localePath(locale, pagePath),
    languages: Object.fromEntries(textLocales.map((code) => [code, localePath(code, pagePath)])),
  };
}

// Metadata of the chrome pages (catalog/map/app/privacy): the same derivation
// with the full UI locale set — these routes exist in every UI language.
export function chromePageMetadata(locale: UiLocale, pagePath: string): Metadata {
  return { alternates: pageAlternates(locale, pagePath, uiLocales) };
}

// The unavailable-language state (G21.22 criterion 3): a defined published
// page, kept out of the index so an untranslated guide variant is never
// advertised — no content fallback exists behind it.
export function unavailablePageMetadata(locale: UiLocale): Metadata {
  return { title: getUiStrings(locale).textUnavailableTitle, robots: { index: false, follow: true } };
}
