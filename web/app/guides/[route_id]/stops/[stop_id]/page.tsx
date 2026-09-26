import { StopPage } from '../../../../../components/stop-page.tsx';
import { stopPageMetadata } from '../../../../../lib/content/cards.ts';
import { getContentRoot, readSiteStopPage, stopStaticParams } from '../../../../../lib/content/site.ts';
import { getUiStrings } from '../../../../../lib/i18n/index.ts';

export function generateStaticParams() {
  return stopStaticParams();
}

export function generateMetadata({ params }: { params: Promise<{ route_id: string; stop_id: string }> }) {
  return params.then(({ route_id, stop_id }) => stopPageMetadata(getContentRoot(), 'be', route_id, stop_id));
}

export default async function StopBe({ params }: { params: Promise<{ route_id: string; stop_id: string }> }) {
  const { route_id, stop_id } = await params;
  return (
    <StopPage
      locale="be"
      data={readSiteStopPage(getContentRoot(), 'be', route_id, stop_id)}
      strings={getUiStrings('be')}
    />
  );
}
