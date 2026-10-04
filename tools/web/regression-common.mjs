// Shared seam for the tools/web browser regressions (map attribution, audio
// playback): both prove page behavior against the local static export only,
// so the export/shots argument parsing, the 127.0.0.1 static server and the
// offline chromium load live here once. Not wired into the standard runner —
// the chromium binary comes from `npx playwright install chromium` (the
// collector's loadPlaywright seam pattern).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../serve-static.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseExportArgs(argv) {
  const out = argv.includes('--out') ? resolve(argv[argv.indexOf('--out') + 1]) : join(REPO_ROOT, 'web', 'out');
  const shots = argv.includes('--shots') ? resolve(argv[argv.indexOf('--shots') + 1]) : null;
  return { outDir: out, shotsDir: shots };
}

export async function serveExport(root) {
  const server = createStaticServer(root);
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

export async function loadChromium() {
  const playwright = await import('playwright').catch(() => null);
  assert.ok(playwright, 'playwright is not installed — the browser regression needs: npm install && npx playwright install chromium');
  const executable = playwright.chromium.executablePath();
  assert.ok(existsSync(executable), `chromium binary is missing at ${executable} — run: npx playwright install chromium`);
  return playwright;
}
