// The be stop page — the root tree's sibling of the [locale] stop page
// (G21.22, issue #554): the transcript renders in the page's own text locale
// only; a route without be text renders the localized unavailable state.
import { StopPage } from '../../../../../../components/stop-page.tsx';
import { TextUnavailablePage } from '../../../../../../components/text-unavailable.tsx';
import { stopPageMetadata } from '../../../../../../lib/content/cards.ts';
import {
  getContentRoot,
  readSiteStopPage,
  routeTextLocales,
  stopStaticParams,
} from '../../../../../../lib/content/site.ts';
import { getUiStrings } from '../../../../../../lib/i18n/index.ts';

export function generateStaticParams() {
  return stopStaticParams();
}

export function generateMetadata({ params }: { params: Promise<{ route_id: string; stop_id: string }> }) {
  return params.then(({ route_id, stop_id }) => stopPageMetadata(getContentRoot(), 'be', route_id, stop_id));
}

export default async function StopBe({ params }: { params: Promise<{ route_id: string; stop_id: string }> }) {
  const { route_id, stop_id } = await params;
  const strings = getUiStrings('be');
  if (!routeTextLocales(getContentRoot(), route_id).includes('be')) {
    return <TextUnavailablePage locale="be" currentPath={`/guides/${route_id}/stops/${stop_id}`} strings={strings} />;
  }
  return (
    <StopPage
      locale="be"
      data={readSiteStopPage(getContentRoot(), 'be', route_id, stop_id)}
      strings={strings}
    />
  );
}
