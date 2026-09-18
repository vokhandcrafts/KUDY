// Home = the city catalog in be, the default locale at the root (plan §4).
import { CatalogPage } from '../components/catalog-page.tsx';
import { getContentRoot, readSiteCatalogPage } from '../lib/content/site.ts';
import { getUiStrings } from '../lib/i18n/index.ts';

export default function Home() {
  return <CatalogPage locale="be" data={readSiteCatalogPage(getContentRoot(), 'be')} strings={getUiStrings('be')} />;
}
