import { UsageRulesPage } from '../../../components/usage-rules-page.tsx';
import { chromePageMetadata } from '../../../lib/content/cards.ts';
import { getUiStrings, toUiLocale } from '../../../lib/i18n/index.ts';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return params.then(({ locale }) => {
    const ui = toUiLocale(locale);
    const strings = getUiStrings(ui);
    return { title: strings.usageRulesTitle, description: strings.usageRulesIntro, ...chromePageMetadata(ui, '/usage-rules') };
  });
}

export default async function UsageRules({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ui = toUiLocale(locale);
  return <UsageRulesPage locale={ui} strings={getUiStrings(ui)} />;
}
