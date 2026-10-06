// The static city map in the URL locale — the [locale] sibling of the root
// map page (plan §4); the route list applies the same published-text filter
// as the catalog (G21.22).
import { MapPage } from '../../../components/map-page.tsx';
import { chromePageMetadata } from '../../../lib/content/cards.ts';
import { getContentRoot, readSiteMapPage } from '../../../lib/content/site.ts';
import { getUiStrings, toUiLocale } from '../../../lib/i18n/index.ts';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return params.then(({ locale }) => chromePageMetadata(toUiLocale(locale), '/map'));
}

export default async function Map({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ui = toUiLocale(locale);
  return <MapPage locale={ui} data={readSiteMapPage(getContentRoot(), ui)} strings={getUiStrings(ui)} />;
}
