import { AppPage } from '../../../components/app-page.tsx';
import { getUiStrings } from '../../../lib/i18n/index.ts';

export default function AppBe() {
  return <AppPage locale="be" strings={getUiStrings('be')} />;
}
