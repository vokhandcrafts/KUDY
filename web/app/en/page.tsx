import { CatalogPage } from '../../components/catalog-page.tsx';
import { getContentRoot, readSiteCatalogPage } from '../../lib/content/site.ts';
import { getUiStrings } from '../../lib/i18n/index.ts';

export default function HomeEn() {
  return <CatalogPage locale="en" data={readSiteCatalogPage(getContentRoot(), 'en')} strings={getUiStrings('en')} />;
}
