// Every exported guide and stop URL, including a locale-unavailable state,
// carries the visible attribution block and a link to usage rules.
import fs from 'node:fs';
import { listFiles } from './leak-guard.ts';
import { expectedDocumentLocale } from './exported-language.ts';
import { localePath } from './site.ts';
import { toUiLocale, uiLocales } from '../i18n/index.ts';

export interface AttributionViolation {
  path: string;
  code: 'missing-content-attribution' | 'missing-usage-rules-link';
}

export function checkExportedAttribution({ outDir }: { outDir: string }): AttributionViolation[] {
  const violations: AttributionViolation[] = [];
  for (const { abs, rel } of listFiles(outDir)) {
    if (!rel.endsWith('.html')) continue;
    const urlPath = rel.replaceAll('\\', '/').replace(/\.html$/, '').replace(/\/index$/, '');
    const segments = urlPath.split('/');
    if (uiLocales.some((locale) => locale === segments[0])) segments.shift();
    if (segments[0] !== 'guides' || !segments[1] ||
      !(segments.length === 2 || (segments.length === 4 && segments[2] === 'stops' && segments[3]))) continue;
    const html = fs.readFileSync(abs, 'utf8');
    if (!html.includes('data-content-attribution="true"')) {
      violations.push({ path: rel, code: 'missing-content-attribution' });
    }
    const usageHref = localePath(toUiLocale(expectedDocumentLocale(rel)), '/usage-rules');
    if (!html.includes(`href="${usageHref}"`)) {
      violations.push({ path: rel, code: 'missing-usage-rules-link' });
    }
  }
  return violations.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
}
