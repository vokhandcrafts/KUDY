// The /app fallback page in be (16 G10.02: «неўсталяваны дадатак не дае
// тупік») — the root tree's sibling of the [locale] app page.
import { AppPage } from '../../../components/app-page.tsx';
import { chromePageMetadata } from '../../../lib/content/cards.ts';
import { getUiStrings } from '../../../lib/i18n/index.ts';

export function generateMetadata() {
  return chromePageMetadata('be', '/app');
}

export default function AppBe() {
  return <AppPage locale="be" strings={getUiStrings('be')} />;
}
