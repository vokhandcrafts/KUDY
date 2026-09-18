import { GuidePage } from '../../../components/guide-page.tsx';
import { getContentRoot, guideStaticParams, readSiteGuidePage } from '../../../lib/content/site.ts';
import { getUiStrings } from '../../../lib/i18n/index.ts';

export const generateStaticParams = guideStaticParams;

export default async function GuideBe({ params }: { params: Promise<{ route_id: string }> }) {
  const { route_id } = await params;
  return <GuidePage locale="be" data={readSiteGuidePage(getContentRoot(), 'be', route_id)} strings={getUiStrings('be')} />;
}
