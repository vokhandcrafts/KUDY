import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Document shell of the exported locale trees (G21.01): the only place an
// <html lang> is written, server-rendered — never client-mutated. Next allows
// one root layout per route group, so each exported locale tree owns a thin
// layout file; both re-export this one implementation.
export const localeRootMetadata: Metadata = {
  title: 'KUDY',
  description: 'KUDY — аўдыёгіды; вольны пласт вэб-канала',
};

export function LocaleRootDocument({ lang, children }: { lang: string; children: ReactNode }) {
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
