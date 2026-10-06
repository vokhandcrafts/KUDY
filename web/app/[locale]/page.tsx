// Home = the city catalog in the URL locale (plan §4); be is the default at
// the root, every other UI locale lives under its prefix. G21.22 (issue
// #554): the catalog is published in every UI locale — a locale whose guides
// carry no matching text renders the localized empty-catalogue state (the
// data layer filters by actual published text before the read).
import { CatalogPage } from '../../components/catalog-page.tsx';
import { chromePageMetadata } from '../../lib/content/cards.ts';
import { getContentRoot, readSiteCatalogPage } from '../../lib/content/site.ts';
import { getUiStrings, toUiLocale } from '../../lib/i18n/index.ts';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return params.then(({ locale }) => chromePageMetadata(toUiLocale(locale), '/'));
}

export default async function Catalog({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ui = toUiLocale(locale);
  return <CatalogPage locale={ui} data={readSiteCatalogPage(getContentRoot(), ui)} strings={getUiStrings(ui)} />;
}
