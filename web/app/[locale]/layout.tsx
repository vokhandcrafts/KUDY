// The [locale] tree (G21.22, issue #554): one dynamic segment serves the
// seven prefixed UI locales — en, uk, de, es, fr, cs, sv, straight from the
// registry's non-default codes. The be default tree stays at the root without
// a prefix (plan §4); an unregistered or default code is never prerendered
// (the unknown URL reaches the shared 404), and the notFound() here is the
// dev-time backstop. The document language is declared server-rendered per
// locale (G21.01) — the scan (scan-rendered.ts) fails the build if it is
// lost.
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { LocaleRootDocument, localeRootMetadata } from '../../components/locale-root.tsx';
import { isPrefixedUiLocale, prefixedUiLocales } from '../../lib/i18n/index.ts';

export const metadata = localeRootMetadata;

export function generateStaticParams() {
  return prefixedUiLocales.map((locale) => ({ locale }));
}

export default async function LocaleRootLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isPrefixedUiLocale(locale)) notFound();
  return <LocaleRootDocument lang={locale}>{children}</LocaleRootDocument>;
}
