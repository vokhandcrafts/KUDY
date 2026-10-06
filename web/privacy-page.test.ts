// Issue #331 reverted-line check (implementation-rules 1): the public
// privacy page exists on both UI locales, and the required policy statements
// of the acceptance criteria are present in both string files. Deleting a
// route file, dropping a key from one locale or losing a required claim
// fails this test — the page cannot silently become a stub. G21.22 (issue
// #554): the root be tree stays, the seven prefixed locales render through
// the one [locale] privacy page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { be } from './lib/i18n/be.ts';
import { en } from './lib/i18n/en.ts';

const WEB_ROOT = path.dirname(fileURLToPath(import.meta.url));

const ROUTE_FILES = ['app/(be)/privacy/page.tsx', 'app/[locale]/privacy/page.tsx'];

// Short markers of the required statements (issue #331 criterion 2); they
// assert the claim, not the wording.
const REQUIRED_MARKERS: Record<string, string[]> = {
  be: [
    'не збірае акаўнтаў',
    'не пакідаюць прыладу',
    'не перадаюцца на сервер',
    'толькі па яўнай згодзе',
    '14 месяцаў',
    'My KUDY',
  ],
  en: [
    'collects no accounts',
    'never leave the device',
    'not sent to the server',
    'only with explicit consent',
    '14 months',
    'My KUDY',
  ],
};

const PRIVACY_KEYS = [
  'privacyTitle',
  'privacyIntro',
  'privacyWeb',
  'privacyAppData',
  'privacyLocation',
  'privacyAnalytics',
  'privacyRetention',
  'privacyDeletion',
  'privacyPurchases',
  'privacyContact',
] as const;

test('privacy page routes exist for both UI locales', () => {
  for (const rel of ROUTE_FILES) {
    assert.ok(fs.existsSync(path.join(WEB_ROOT, rel)), `${rel} must exist`);
  }
});

test('privacy page renders through SiteShell and binds the support link through lib/app-links.ts', () => {
  const source = fs.readFileSync(path.join(WEB_ROOT, 'components/privacy-page.tsx'), 'utf8');
  assert.match(source, /SiteShell/);
  assert.match(source, /appLinks\.supportIssuesUrl/);
  const config = fs.readFileSync(path.join(WEB_ROOT, 'lib/app-links.ts'), 'utf8');
  assert.match(config, /https:\/\/github\.com\/vokhandcrafts\/KUDY\/issues/);
});

test('privacy strings exist in both locales, none empty (key-set parity: lib/content/pages.test.ts)', () => {
  for (const key of PRIVACY_KEYS) {
    assert.ok(be[key].trim().length > 0, `be.${key} must be non-empty`);
    assert.ok(en[key].trim().length > 0, `en.${key} must be non-empty`);
  }
});

test('required privacy statements are present in both locales', () => {
  for (const [locale, strings] of [
    ['be', be],
    ['en', en],
  ] as const) {
    const text = PRIVACY_KEYS.map((key) => strings[key]).join(' ');
    for (const marker of REQUIRED_MARKERS[locale]) {
      assert.ok(text.includes(marker), `${locale} privacy text must contain "${marker}"`);
    }
  }
});
