// G10.01.b step 6 wiring: after `next build`, scan the static export (out/)
// for leak-class violations; any hit exits non-zero and fails the build
// (plan §5: the leak guard covers rendered output, not just data files).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRenderedOutput } from '../lib/content/leak-guard.ts';

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
