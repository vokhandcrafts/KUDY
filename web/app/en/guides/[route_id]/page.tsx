import { GuidePage } from '../../../../components/guide-page.tsx';
import { guidePageMetadata } from '../../../../lib/content/cards.ts';
import { getContentRoot, guideStaticParams, readSiteGuidePage } from '../../../../lib/content/site.ts';
import { getUiStrings } from '../../../../lib/i18n/index.ts';

export const generateStaticParams = guideStaticParams;

export function generateMetadata({ params }: { params: Promise<{ route_id: string }> }) {
  return params.then(({ route_id }) => guidePageMetadata(getContentRoot(), 'en', route_id));
}

export default async function GuideEn({ params }: { params: Promise<{ route_id: string }> }) {
  const { route_id } = await params;
  return <GuidePage locale="en" data={readSiteGuidePage(getContentRoot(), 'en', route_id)} strings={getUiStrings('en')} />;
}
