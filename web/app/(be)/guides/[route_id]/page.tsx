// The be guide page — the root tree's sibling of the [locale] guide page
// (G21.22, issue #554): content is read in the page's own text locale only;
// a route without be text renders the localized unavailable state, never a
// content fallback.
import { GuidePage } from '../../../../components/guide-page.tsx';
import { TextUnavailablePage } from '../../../../components/text-unavailable.tsx';
import { guidePageMetadata } from '../../../../lib/content/cards.ts';
import { getContentRoot, guideStaticParams, readSiteGuidePage, routeTextLocales } from '../../../../lib/content/site.ts';
import { getUiStrings } from '../../../../lib/i18n/index.ts';

export function generateStaticParams() {
  return guideStaticParams();
}

export function generateMetadata({ params }: { params: Promise<{ route_id: string }> }) {
  return params.then(({ route_id }) => guidePageMetadata(getContentRoot(), 'be', route_id));
}

export default async function GuideBe({ params }: { params: Promise<{ route_id: string }> }) {
  const { route_id } = await params;
  const strings = getUiStrings('be');
  if (!routeTextLocales(getContentRoot(), route_id).includes('be')) {
    return <TextUnavailablePage locale="be" currentPath={`/guides/${route_id}`} strings={strings} />;
  }
  return <GuidePage locale="be" data={readSiteGuidePage(getContentRoot(), 'be', route_id)} strings={strings} />;
}
