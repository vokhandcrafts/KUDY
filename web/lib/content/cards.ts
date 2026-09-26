// G10.02.a step 4: OG/Twitter card metadata for the guide and stop pages,
// built only from the four public fields the plan names (cover, name,
// announce/summary, duration) — 16 G10.02: «метададзеныя не раскрываюць
// private». A locked stop's description is its preview announce, verbatim;
// a free stop's is the route summary. The transcript never reaches a card.
import type { Metadata } from 'next';
import { appLinks, type AppLinks } from '../app-links.ts';
import type { GuidePageData, StopPageData } from './site.ts';
import { readSiteGuidePage, readSiteStopPage } from './site.ts';
import type { UiLocale } from '../i18n/index.ts';

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
  return toMetadata(guideCardMeta(readSiteGuidePage(root, locale, routeId)));
}

export function stopPageMetadata(root: string, locale: UiLocale, routeId: string, stopId: string): Metadata {
  return toMetadata(stopCardMeta(readSiteStopPage(root, locale, routeId, stopId)));
}
