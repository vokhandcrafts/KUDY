// Behavioral check on the rendered static export (G21.01, issue #534): every
// exported page must declare the language of its own URL locale on the
// <html> element — server-rendered by the locale root layouts, never
// client-mutated. be is the default at the root, every other UI locale is a
// URL prefix (the same contract localePath maps for hrefs), so the first URL
// segment decides the expectation. The single 404.html serves unknown URLs of
// both locales, has no URL locale of its own and carries the site default.
// Wired into web/scripts/scan-rendered.ts: a violation fails the build, so
// removing the locale root layouts fails here again.
import fs from 'node:fs';
import { listFiles } from './leak-guard.ts';
import { defaultUiLocale, uiLocales } from '../i18n/index.ts';

export type DocumentLanguageViolationCode = 'wrong-document-language' | 'missing-document-language';

export interface DocumentLanguageViolation {
  code: DocumentLanguageViolationCode;
  path: string;
  expected: string;
  actual: string | null;
}

export interface DocumentLanguageResult {
  ok: boolean;
  violations: DocumentLanguageViolation[];
}

const HTML_LANG_PATTERN = /<html[^>]*\slang="([^"]*)"/;

// Export files are flat or nested page files (`en.html` or `en/index.html`
// layouts both map to the /en URL): strip the .html suffix, drop a trailing
// index segment, then read the first URL segment as the locale prefix.
// rel comes from path.relative (listFiles), so on Windows the separators are
// backslashes — normalize to the URL form before reading the prefix (same
// idiom as unsafeSegments in leak-guard.ts).
export function expectedDocumentLocale(relPath: string): string {
  const segments = relPath.replaceAll('\\', '/').replace(/\.html$/, '').split('/').filter((s) => s !== 'index');
  const prefix = segments[0];
  const prefixed = uiLocales.filter((locale) => locale !== defaultUiLocale);
  return prefixed.includes(prefix as (typeof uiLocales)[number]) ? prefix! : defaultUiLocale;
}

export function checkExportedDocumentLanguage({ outDir }: { outDir: string }): DocumentLanguageResult {
  const violations: DocumentLanguageViolation[] = [];
  for (const { abs, rel } of listFiles(outDir)) {
    if (!abs.endsWith('.html')) continue;
    const expected = expectedDocumentLocale(rel);
    const match = HTML_LANG_PATTERN.exec(fs.readFileSync(abs, 'utf8'));
    const actual = match?.[1] ?? null;
    if (actual === expected) continue;
    violations.push({
      code: actual === null ? 'missing-document-language' : 'wrong-document-language',
      path: rel,
      expected,
      actual,
    });
  }
  return { ok: violations.length === 0, violations: violations.sort((a, b) => a.path.localeCompare(b.path)) };
}
