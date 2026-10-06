// The stop page in the URL locale (G21.22, issue #554): the story transcript
// is server-rendered in the page's own text locale only; a route whose text
// is not published in the URL locale renders the localized unavailable state,
// never another language's transcript.
import { StopPage } from '../../../../../../components/stop-page.tsx';
import { TextUnavailablePage } from '../../../../../../components/text-unavailable.tsx';
import { stopPageMetadata } from '../../../../../../lib/content/cards.ts';
import {
  getContentRoot,
  readSiteStopPage,
  routeTextLocales,
  stopStaticParams,
} from '../../../../../../lib/content/site.ts';
import { getUiStrings, toUiLocale } from '../../../../../../lib/i18n/index.ts';

export function generateStaticParams() {
  return stopStaticParams();
}

export function generateMetadata({ params }: { params: Promise<{ locale: string; route_id: string; stop_id: string }> }) {
  return params.then(({ locale, route_id, stop_id }) =>
    stopPageMetadata(getContentRoot(), toUiLocale(locale), route_id, stop_id),
  );
}

export default async function Stop({ params }: { params: Promise<{ locale: string; route_id: string; stop_id: string }> }) {
  const { locale, route_id, stop_id } = await params;
  const ui = toUiLocale(locale);
  const strings = getUiStrings(ui);
  if (!routeTextLocales(getContentRoot(), route_id).includes(ui)) {
    return <TextUnavailablePage locale={ui} currentPath={`/guides/${route_id}/stops/${stop_id}`} strings={strings} />;
  }
  return (
    <StopPage
      locale={ui}
      data={readSiteStopPage(getContentRoot(), ui, route_id, stop_id)}
      strings={strings}
    />
  );
}
