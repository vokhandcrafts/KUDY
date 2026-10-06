// The static city map in be (G10.01.b step 3) — the root tree's sibling of
// the [locale] map page; the route list applies the same published-text
// filter as the catalog (G21.22).
import { MapPage } from '../../../components/map-page.tsx';
import { chromePageMetadata } from '../../../lib/content/cards.ts';
import { getContentRoot, readSiteMapPage } from '../../../lib/content/site.ts';
import { getUiStrings } from '../../../lib/i18n/index.ts';

export function generateMetadata() {
  return chromePageMetadata('be', '/map');
}

export default function MapBe() {
  return <MapPage locale="be" data={readSiteMapPage(getContentRoot(), 'be')} strings={getUiStrings('be')} />;
}
