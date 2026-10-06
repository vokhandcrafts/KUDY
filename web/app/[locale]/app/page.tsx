// The /app fallback page in the URL locale — the [locale] sibling of the root
// app page (16 G10.02: «неўсталяваны дадатак не дае тупік»).
import { AppPage } from '../../../components/app-page.tsx';
import { chromePageMetadata } from '../../../lib/content/cards.ts';
import { getUiStrings, toUiLocale } from '../../../lib/i18n/index.ts';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return params.then(({ locale }) => chromePageMetadata(toUiLocale(locale), '/app'));
}

export default async function App({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ui = toUiLocale(locale);
  return <AppPage locale={ui} strings={getUiStrings(ui)} />;
}
