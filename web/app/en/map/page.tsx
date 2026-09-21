import { MapPage } from '../../../components/map-page.tsx';
import { getContentRoot, readSiteMapPage } from '../../../lib/content/site.ts';
import { getUiStrings } from '../../../lib/i18n/index.ts';

export default function MapEn() {
  return <MapPage locale="en" data={readSiteMapPage(getContentRoot(), 'en')} strings={getUiStrings('en')} />;
}
