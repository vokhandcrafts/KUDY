// G21.50 (issue #711) — the release flag input under a SET environment. This
// file runs in its own runner process: the variable is set before the first
// import, so the module facts evaluate under a set flag exactly as a build
// would inline it. The flag names only unregistered codes here (no gated
// code exists in the real registry until #669/#670), so the facts must
// answer with the frozen eight — the same answer the absent-flag case gives.
process.env.EXPO_PUBLIC_OPEN_UI_LOCALES = 'bogus, ,ru';

import test from 'node:test';
import assert from 'node:assert/strict';

const { OPEN_UI_LOCALES, RELEASE_FLAG_ENV, releaseOpenUiLocales } = await import('../contracts/ui-locales.ts');
const { uiLocales, prefixedUiLocales, defaultUiLocale, isPrefixedUiLocale } = await import(
  '../web/lib/i18n/index.ts'
);

test('the module facts evaluate under the set flag and open nothing unregistered (criterion 1)', () => {
  assert.equal(RELEASE_FLAG_ENV, 'EXPO_PUBLIC_OPEN_UI_LOCALES');
  assert.deepEqual([...OPEN_UI_LOCALES], ['be', 'en', 'uk', 'de', 'es', 'fr', 'cs', 'sv']);
  assert.deepEqual([...releaseOpenUiLocales(process.env[RELEASE_FLAG_ENV])], [...OPEN_UI_LOCALES]);
});

test('the web route set derives from the same resolver output, not a second list (criterion 4)', () => {
  assert.deepEqual([...uiLocales], [...OPEN_UI_LOCALES]);
  assert.deepEqual([...prefixedUiLocales], [...OPEN_UI_LOCALES].filter((locale) => locale !== defaultUiLocale));
  assert.equal(isPrefixedUiLocale('en'), true);
  assert.equal(isPrefixedUiLocale('be'), false);
});
