import { MapPage } from '../../components/map-page.tsx';
import { getContentRoot, readSiteMapPage } from '../../lib/content/site.ts';
import { getUiStrings } from '../../lib/i18n/index.ts';

export default function MapBe() {
  return <MapPage locale="be" data={readSiteMapPage(getContentRoot(), 'be')} strings={getUiStrings('be')} />;
}
