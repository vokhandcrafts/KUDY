// Root layout of the be tree — the URLs without a locale prefix; be is the
// site default locale (plan §4). The en tree's layout is its structural
// sibling: one exported locale tree per root layout.
import type { ReactNode } from 'react';
import { LocaleRootDocument, localeRootMetadata } from '../../components/locale-root.tsx';

export const metadata = localeRootMetadata;

export default function BeRootLayout({ children }: { children: ReactNode }) {
  return <LocaleRootDocument lang="be">{children}</LocaleRootDocument>;
}
