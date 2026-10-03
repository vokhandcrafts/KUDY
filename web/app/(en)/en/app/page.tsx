import { AppPage } from '../../../../components/app-page.tsx';
import { getUiStrings } from '../../../../lib/i18n/index.ts';

export default function AppEn() {
  return <AppPage locale="en" strings={getUiStrings('en')} />;
}
