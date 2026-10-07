import { UsageRulesPage } from '../../../components/usage-rules-page.tsx';
import { chromePageMetadata } from '../../../lib/content/cards.ts';
import { getUiStrings } from '../../../lib/i18n/index.ts';

export function generateMetadata() {
  const strings = getUiStrings('be');
  return { title: strings.usageRulesTitle, description: strings.usageRulesIntro, ...chromePageMetadata('be', '/usage-rules') };
}

export default function UsageRulesBe() {
  return <UsageRulesPage locale="be" strings={getUiStrings('be')} />;
}
