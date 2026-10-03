// Root layout of the en tree — every page under the /en URL prefix declares
// lang=en on the document element (G21.01), server-rendered by the static
// export. The be tree's layout is its structural sibling.
import type { ReactNode } from 'react';
import { LocaleRootDocument, localeRootMetadata } from '../../components/locale-root.tsx';

export const metadata = localeRootMetadata;

export default function EnRootLayout({ children }: { children: ReactNode }) {
  return <LocaleRootDocument lang="en">{children}</LocaleRootDocument>;
}
