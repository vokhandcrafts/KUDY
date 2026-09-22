import { StopPage } from '../../../../../../components/stop-page.tsx';
import { getContentRoot, readSiteStopPage, stopStaticParams } from '../../../../../../lib/content/site.ts';
import { getUiStrings } from '../../../../../../lib/i18n/index.ts';

export function generateStaticParams() {
  return stopStaticParams();
}

export default async function StopEn({ params }: { params: Promise<{ route_id: string; stop_id: string }> }) {
  const { route_id, stop_id } = await params;
  return (
    <StopPage
      locale="en"
      data={readSiteStopPage(getContentRoot(), 'en', route_id, stop_id)}
      strings={getUiStrings('en')}
    />
  );
}
