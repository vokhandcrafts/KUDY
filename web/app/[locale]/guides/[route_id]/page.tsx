// The guide page in the URL locale (G21.22, issue #554): the content is read
// in the page's own text locale only. A route whose text is not published in
// the URL locale renders the localized unavailable state — a direct link
// never falls back to another language's content. The metadata follows the
// same availability fact (canonical/hreflang per published text locale,
// noindex for the unavailable state).
import { GuidePage } from '../../../../components/guide-page.tsx';
import { TextUnavailablePage } from '../../../../components/text-unavailable.tsx';
import { guidePageMetadata } from '../../../../lib/content/cards.ts';
import { getContentRoot, guideStaticParams, readSiteGuidePage, routeTextLocales } from '../../../../lib/content/site.ts';
import { getUiStrings, toUiLocale } from '../../../../lib/i18n/index.ts';

export function generateStaticParams() {
  return guideStaticParams();
}

export function generateMetadata({ params }: { params: Promise<{ locale: string; route_id: string }> }) {
  return params.then(({ locale, route_id }) => guidePageMetadata(getContentRoot(), toUiLocale(locale), route_id));
}

export default async function Guide({ params }: { params: Promise<{ locale: string; route_id: string }> }) {
  const { locale, route_id } = await params;
  const ui = toUiLocale(locale);
  const strings = getUiStrings(ui);
  if (!routeTextLocales(getContentRoot(), route_id).includes(ui)) {
    return <TextUnavailablePage locale={ui} currentPath={`/guides/${route_id}`} strings={strings} />;
  }
  return <GuidePage locale={ui} data={readSiteGuidePage(getContentRoot(), ui, route_id)} strings={strings} />;
}
