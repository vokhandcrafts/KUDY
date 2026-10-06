// The public privacy policy in be (issue #331) — the root tree's sibling of
// the [locale] privacy page; the canonical/hreflang links follow the
// published-text fact (G21.22).
import { PrivacyPage } from '../../../components/privacy-page.tsx';
import { chromePageMetadata } from '../../../lib/content/cards.ts';
import { getUiStrings } from '../../../lib/i18n/index.ts';

export function generateMetadata() {
  const strings = getUiStrings('be');
  return {
    title: strings.privacyTitle,
    description: strings.privacyIntro,
    ...chromePageMetadata('be', '/privacy'),
  };
}

export default function PrivacyBe() {
  return <PrivacyPage locale="be" strings={getUiStrings('be')} />;
}
