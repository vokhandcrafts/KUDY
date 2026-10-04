import type { Metadata } from 'next';

import { PrivacyPage } from '../../../../components/privacy-page.tsx';
import { getUiStrings } from '../../../../lib/i18n/index.ts';

const strings = getUiStrings('en');

export const metadata: Metadata = {
  title: strings.privacyTitle,
  description: strings.privacyIntro,
};

export default function PrivacyEn() {
  return <PrivacyPage locale="en" strings={strings} />;
}
