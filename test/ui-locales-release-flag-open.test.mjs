// G21.50 (issue #711) — the web route set under a flag that OPENS a gated
// code. The first real gated consumer (zh) does not exist until #669/#670,
// so a mock registry module with a synthetic ninth code plays it: the mock
// replaces the registry before the web i18n module loads, and reverting the
// web module to a hard-coded locale list (or reading COMPLETE_UI_LOCALES)
// turns this file red. One mock scenario per process — the closed case is
// carried by test/ui-locales-release-flag.test.mjs and the resolver tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

const NINE = ['be', 'en', 'uk', 'de', 'es', 'fr', 'cs', 'sv', 'zz'];
const NAMES = {
  be: 'Беларуская',
  en: 'English',
  uk: 'Українська',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  cs: 'Čeština',
  sv: 'Svenska',
  zz: 'Testnine',
};

mock.module('../contracts/ui-locales.ts', {
  namedExports: {
    RELEASE_FLAG_ENV: 'EXPO_PUBLIC_OPEN_UI_LOCALES',
    isUiLocaleCode: (value) => NINE.includes(value),
    uiLocaleNativeName: (code) => {
      if (!(code in NAMES)) throw new Error(`ui-locale-unregistered: ${code}`);
      return NAMES[code];
    },
    releaseOpenUiLocales: () => NINE,
  },
});

const { uiLocales, prefixedUiLocales, defaultUiLocale, isPrefixedUiLocale } = await import(
  '../web/lib/i18n/index.ts'
);

test('the flag-opened code rides the whole web route derivation (criteria 4 and 7)', () => {
  assert.deepEqual([...uiLocales], NINE);
  assert.deepEqual([...prefixedUiLocales], NINE.filter((locale) => locale !== defaultUiLocale));
  assert.equal(isPrefixedUiLocale('zz'), true, 'the opened code becomes a URL prefix');
});
