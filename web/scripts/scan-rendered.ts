// G10.01.b step 6 wiring: after `next build`, scan the static export (out/)
// for leak-class violations; any hit exits non-zero and fails the build
// (plan §5: the leak guard covers rendered output, not just data files).
// G21.01 adds the exported document language check to the same scan pass:
// every page must declare the language of its URL locale (G21.01), and a
// violation fails the build the same way.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRenderedOutput } from '../lib/content/leak-guard.ts';
import { checkExportedDocumentLanguage } from '../lib/content/exported-language.ts';
import { checkExportedAttribution } from '../lib/content/attribution-guard.ts';

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(webDir, 'out');

if (!fs.existsSync(outDir)) {
  console.error('rendered-output scan: out/ does not exist — run next build first');
  process.exit(1);
}
const result = scanRenderedOutput({ outDir });
if (!result.ok) {
  console.error(`rendered-output scan: ${result.violations.length} violation(s)`);
  for (const violation of result.violations) console.error(`  ${violation.code}: ${violation.path}`);
  process.exit(1);
}
console.log('rendered-output scan: clean');

const language = checkExportedDocumentLanguage({ outDir });
if (!language.ok) {
  console.error(`document-language scan: ${language.violations.length} violation(s)`);
  for (const violation of language.violations) {
    console.error(`  ${violation.code}: ${violation.path} (expected ${violation.expected}, got ${violation.actual})`);
  }
  process.exit(1);
}
console.log('document-language scan: clean');

const attribution = checkExportedAttribution({ outDir });
if (attribution.length > 0) {
  console.error(`content-attribution scan: ${attribution.length} violation(s)`);
  for (const violation of attribution) console.error(`  ${violation.code}: ${violation.path}`);
  process.exit(1);
}
console.log('content-attribution scan: clean');
