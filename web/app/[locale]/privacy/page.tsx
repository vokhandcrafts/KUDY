// The public privacy policy in the URL locale — the [locale] sibling of the
// root privacy page (issue #331: one permanent page per UI locale).
import { PrivacyPage } from '../../../components/privacy-page.tsx';
import { chromePageMetadata } from '../../../lib/content/cards.ts';
import { getUiStrings, toUiLocale } from '../../../lib/i18n/index.ts';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return params.then(({ locale }) => {
    const ui = toUiLocale(locale);
    const strings = getUiStrings(ui);
    return {
      title: strings.privacyTitle,
      description: strings.privacyIntro,
      ...chromePageMetadata(ui, '/privacy'),
    };
  });
}

export default async function Privacy({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ui = toUiLocale(locale);
  return <PrivacyPage locale={ui} strings={getUiStrings(ui)} />;
}
