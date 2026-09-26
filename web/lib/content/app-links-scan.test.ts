// G10.02.a acceptance 1 (reverted-line check, implementation-rules 1): no
// external app/store URL may exist outside lib/app-links.ts — the config is
// the single source every CTA resolves through. A store host hardcoded
// anywhere else fails this scan, so the single-source rule cannot silently
// erode. The negative cases plant a URL in a scratch tree and prove the scan
// both catches it outside the config and allows it inside the config only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sourceFiles } from '../source-walk.ts';
import { writeTree } from './test-tree.ts';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const STORE_HOSTS = /apps\.apple\.com|play\.google\.com|itunes\.apple\.com|itms-apps:/i;
const SCAN_DIRS = ['app', 'components', 'lib', 'scripts'] as const;
const CONFIG_REL = 'lib/app-links.ts';

function scanForStoreUrls(webRoot: string): { violations: string[]; configSeen: boolean } {
  const violations: string[] = [];
  let configSeen = false;
  for (const dir of SCAN_DIRS) {
    if (!fs.existsSync(path.join(webRoot, dir))) continue;
    for (const { real, rel } of sourceFiles(webRoot, dir)) {
      // The guard scans production sources; this and other test files name
      // the hosts only inside their own regexes.
      if (rel.endsWith('.test.ts')) continue;
      if (rel === CONFIG_REL) {
        configSeen = true;
        continue;
      }
      if (STORE_HOSTS.test(fs.readFileSync(real, 'utf8'))) violations.push(rel);
    }
  }
  return { violations, configSeen };
}

test('store URLs appear only in lib/app-links.ts, nowhere else in the web sources', () => {
  const { violations, configSeen } = scanForStoreUrls(WEB_ROOT);
  assert.deepEqual(violations, [], `store URLs must live only in ${CONFIG_REL}, found in: ${violations.join(', ')}`);
  assert.ok(configSeen, `${CONFIG_REL} must be present as the single destination config`);
});

// The scratch trees the negative cases scan are built by the shared helper
// (test-tree.ts) with the same walk boundary the scanner itself applies.

test('the scan fails when a store URL is planted outside the config', () => {
  const tree = writeTree({
    'lib/app-links.ts': 'export const appLinks = { appStore: { kind: "unpublished" } };',
    'components/offer.tsx': 'export const link = "https://apps.apple.com/app/kudy";',
  });
  const { violations, configSeen } = scanForStoreUrls(tree);
  assert.equal(configSeen, true);
  assert.deepEqual(violations, ['components/offer.tsx']);
});

test('the scan allows a store URL inside the config — and only there', () => {
  const tree = writeTree({
    'lib/app-links.ts': 'export const appStore = "https://apps.apple.com/app/kudy";',
    'components/offer.tsx': 'export const href = "/app";',
  });
  const { violations, configSeen } = scanForStoreUrls(tree);
  assert.equal(configSeen, true);
  assert.deepEqual(violations, []);
});
