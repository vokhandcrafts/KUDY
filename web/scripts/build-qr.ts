// G10.02.a step 3 (build): write the print-ready QR assets for every
// published route URL into web/public/qr/ — generated, never committed
// (implementation-rules 5, web/.gitignore). With the site origin still
// unpublished the script states that explicitly and writes nothing: a QR
// asset that encodes a fabricated origin would be a defect, not a draft.
// The assets appear with no contract change once G10.02.b sets the origin.
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

import { appLinks } from '../lib/app-links.ts';
import { getContentRoot, guideStaticParams } from '../lib/content/site.ts';
import { uiLocales } from '../lib/i18n/index.ts';
import { routeQrTargets } from '../lib/qr.ts';

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The content root is already built when this runs (prebuild order:
// build-content → build-qr); the params read proves it loudly otherwise.
const routes = guideStaticParams();
const targets = routeQrTargets(appLinks, routes, uiLocales);

if (targets.length === 0) {
  console.log(`QR assets: none written — the site origin is unpublished (${routes.length} route(s) known); no fabricated origin is encoded`);
  process.exit(0);
}

const outDir = path.join(webDir, 'public', 'qr');
mkdirSync(outDir, { recursive: true });
for (const target of targets) {
  // Print-suitable: 1024 px square with a 4-module quiet zone.
  const png = await QRCode.toBuffer(target.url, { type: 'png', width: 1024, margin: 4, errorCorrectionLevel: 'M' });
  const name = target.locale === 'be' ? `${target.route_id}.png` : `${target.route_id}.${target.locale}.png`;
  writeFileSync(path.join(outDir, name), png);
  console.log(`QR asset: public/qr/${name} → ${target.url}`);
}
console.log(`QR assets: ${targets.length} written to public/qr/`);
