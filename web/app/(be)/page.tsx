// Home = the city catalog in be, the default locale at the root (plan §4).
// G21.22 (issue #554): the data layer filters cards by actual published text
// — a locale with no matching text renders the localized empty-catalogue
// state; the canonical/hreflang links follow the same published-text fact.
import { CatalogPage } from '../../components/catalog-page.tsx';
import { chromePageMetadata } from '../../lib/content/cards.ts';
import { getContentRoot, readSiteCatalogPage } from '../../lib/content/site.ts';
import { getUiStrings } from '../../lib/i18n/index.ts';

export function generateMetadata() {
  return chromePageMetadata('be', '/');
}

export default function Home() {
  return <CatalogPage locale="be" data={readSiteCatalogPage(getContentRoot(), 'be')} strings={getUiStrings('be')} />;
}
