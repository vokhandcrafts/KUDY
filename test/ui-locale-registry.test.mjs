// G21.09 (issue #542) — the one UI-locale registry: the eight requested codes
// and native names verbatim (criterion 1), the complete subset the adapters
// may advertise (criterion 4), and the per-locale native catalogue
// completeness (criterion 5). Deleting a registry entry, a complete code or a
// catalogue family fails here through the standard runner; the store's
// unknown-input semantics are asserted unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UI_LOCALES,
  COMPLETE_UI_LOCALES,
  uiLocaleNativeName,
  isUiLocaleCode,
  isCompleteUiLocale,
} from '../contracts/ui-locales.ts';
import { createUiLocaleStore, UiLocaleError } from '../controllers/uiLocaleStore.ts';
import { uiStrings } from '../components/ui-strings.ts';
import { previewStrings } from '../controllers/catalog/previewController.ts';
import { runMapStrings } from '../controllers/run/runMap.ts';
import { placeDetailStrings } from '../controllers/place/placeDetailController.ts';
import { nearbyStrings } from '../controllers/nearby/nearbySurfaceController.ts';
import { offerStrings } from '../controllers/commerce/commerceController.ts';

// Issue #542 criterion 1 verbatim: the eight requested UI codes and native
// names.
const EIGHT = [
  { code: 'be', nativeName: 'Беларуская' },
  { code: 'en', nativeName: 'English' },
  { code: 'uk', nativeName: 'Українська' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'es', nativeName: 'Español' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'cs', nativeName: 'Čeština' },
  { code: 'sv', nativeName: 'Svenska' },
];

test('the registry defines the eight requested UI codes and native names once (criterion 1)', () => {
  assert.deepEqual([...UI_LOCALES], EIGHT);
  for (const { code, nativeName } of EIGHT) {
    assert.equal(uiLocaleNativeName(code), nativeName);
  }
  assert.throws(() => uiLocaleNativeName('ru'), /ui-locale-unregistered/);
});

test('the complete set is be/en/uk/de/es/fr/cs; planned codes stay registered but incomplete (criterion 4)', () => {
  assert.deepEqual([...COMPLETE_UI_LOCALES], ['be', 'en', 'uk', 'de', 'es', 'fr', 'cs']);
  for (const { code } of EIGHT) {
    assert.equal(isUiLocaleCode(code), true, `${code} is registered`);
  }
  for (const code of COMPLETE_UI_LOCALES) {
    assert.equal(isCompleteUiLocale(code), true, `${code} is complete`);
  }
  for (const code of ['sv']) {
    assert.equal(isCompleteUiLocale(code), false, `${code} has no catalogue yet`);
  }
  assert.equal(isCompleteUiLocale('ru'), false);
});

test('every complete locale renders every registered native message family (criterion 5)', () => {
  for (const locale of COMPLETE_UI_LOCALES) {
    const families = {
      chrome: uiStrings(locale),
      preview: previewStrings(locale),
      run: runMapStrings(locale),
      place: placeDetailStrings(locale),
      nearby: nearbyStrings(locale),
      offer: offerStrings(locale),
    };
    for (const [name, catalog] of Object.entries(families)) {
      assert.equal(typeof catalog, 'object', `${name}(${locale}) renders a catalog`);
      assert.ok(Object.keys(catalog).length > 0, `${name}(${locale}) is non-empty`);
    }
    // The chrome catalog's self-name table covers exactly the complete codes
    // — the picker never names an unregistered or incomplete language.
    assert.deepEqual(Object.keys(uiStrings(locale).languageSelfNames).sort(), [...COMPLETE_UI_LOCALES].sort());
  }
});

test('the store derives its vocabulary from the registry and keeps unknown-input semantics (criterion 4)', () => {
  const store = createUiLocaleStore();
  assert.equal(store.current(), 'be');
  store.set('en');
  assert.equal(store.current(), 'en');
  // The planned languages are registered but incomplete — the store refuses
  // them exactly like an unregistered code (the named UiLocaleError, no
  // silent state), and a refused switch keeps the current locale. A complete
  // catalogue joins the store's vocabulary the commit it lands (es, G21.11
  // issue #545; fr, G21.12 issue #546; cs, G21.13 issue #547): the positive
  // siblings of the refusals.
  for (const planned of ['sv', 'ru']) {
    assert.throws(() => store.set(planned), UiLocaleError);
    assert.equal(store.current(), 'en');
  }
  store.set('es');
  assert.equal(store.current(), 'es');
  store.set('fr');
  assert.equal(store.current(), 'fr');
  store.set('cs');
  assert.equal(store.current(), 'cs');
  store.set('be');
  assert.equal(store.current(), 'be');
});
