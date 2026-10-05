// G21.10 (issue #544) — the German catalogue's locale-specific rendering
// suite. The shipped-locale gate (tools/i18n/check-messages.mjs) proves the
// de set's completeness, review evidence and output freshness; this suite
// proves the German words actually render through the production selectors:
// the adapter chains route de, the discrete forms (numeric timeCap, named
// preview detail) render the German variants, and the composed textAudioLine
// drops its audio tail on an empty list. Deleting the de catalogue or its
// generated outputs fails here through the missing imports and the gate —
// and every concrete word below fails the moment its data line is reverted.
import test from 'node:test';
import assert from 'node:assert/strict';

import { uiStrings } from '../components/ui-strings.ts';
// GuideHintCard.tsx is JSX (node cannot import it); the generated data module
// is pure TS and carries the words the card's selector returns (the golden
// test's idiom).
import { GUIDE_HINT_STRINGS } from '../components/guide-hint-strings.generated.ts';
import { previewStrings, previewReasonText } from '../controllers/catalog/previewController.ts';
import { runMapStrings, runMapReason } from '../controllers/run/runMap.ts';
import { placeDetailStrings } from '../controllers/place/placeDetailController.ts';
import { nearbyStrings } from '../controllers/nearby/nearbySurfaceController.ts';
import { offerStrings } from '../controllers/commerce/commerceController.ts';
import { feedbackStrings } from '../controllers/useFeedbackController.ts';
import { de as webDe } from '../web/lib/i18n/de.ts';
import { getUiStrings } from '../web/lib/i18n/index.ts';

test('the chrome adapter routes de to the German catalogue', () => {
  const s = uiStrings('de');
  assert.equal(s.back, 'Zurück');
  assert.equal(s.currentWalk, 'Aktueller Rundgang');
  assert.equal(s.catalogUnavailable, 'Katalog nicht verfügbar');
  assert.equal(s.retry, 'Erneut versuchen');
  // The registry self-names ride the registry call, never a translation:
  // every complete language is named from one table.
  assert.equal(s.languageSelfNames.de, 'Deutsch');
  assert.equal(s.languageSelfNames.be, 'Беларуская');
});

test('the German discrete forms render over the selector arguments', () => {
  const s = uiStrings('de');
  assert.equal(s.timeCap(30), 'Bis zu 30 Min.');
  assert.equal(s.timeCap(60), 'Bis zu einer Stunde');
  assert.equal(s.timeCap(120), 'Bis zu zwei Stunden');
  assert.equal(s.timeCap(240), 'Ein halber Tag');
  assert.equal(s.stopsCount(5), 'Stationen: 5');
  assert.equal(s.stopNumber(3), 'Station 3');
  assert.equal(s.durationRange(45, 90), 'Zeit: 45 bis 90 Min.');
  // The composed text/audio line keeps its tail guarded on a non-empty list.
  assert.equal(s.textAudioLine(['de'], []), 'Text: de');
  assert.equal(s.textAudioLine(['de'], ['en']), 'Text: de; Audio: en');
});

test('the German preview detail renders the named kind forms', () => {
  const s = previewStrings('de');
  assert.equal(s.detail({ kind: 'damaged' }), 'Paket beschädigt: erneutes Laden nötig');
  assert.equal(s.detail({ kind: 'missing-files', count: 2 }), 'Fehlende Dateien: 2');
  assert.equal(s.detail({ kind: 'stale' }), 'Ein Update ist verfügbar');
  assert.equal(s.detail({ kind: 'other' }), 'Paket unvollständig');
  assert.equal(previewReasonText('preview#purchase-required', s), 'Kauf erforderlich.');
  // An unknown diagnostic renders as-is (the honest runMapReason idiom).
  assert.equal(previewReasonText('preview#unknown', s), 'preview#unknown');
});

test('every German controller family routes and renders its words', () => {
  assert.equal(GUIDE_HINT_STRINGS.de.heading, 'In der Nähe gibt es einen Guide…');
  assert.equal(GUIDE_HINT_STRINGS.de.paid, 'kostenpflichtig');
  assert.equal(runMapStrings('de').endWalk, 'Rundgang beenden');
  assert.equal(runMapReason('run#package-not-downloaded', runMapStrings('de')), 'Der Guide ist nicht geladen.');
  assert.equal(placeDetailStrings('de').playLabel, 'Teaser anhören');
  assert.equal(placeDetailStrings('de').stopLabel, 'Stop');
  assert.equal(nearbyStrings('de').title, 'In der Nähe');
  assert.equal(offerStrings('de').buy, 'Kaufen');
  assert.equal(offerStrings('de').dismiss, 'Nicht jetzt');
  assert.equal(feedbackStrings('de').deleteButton, 'Bewertung löschen');
  assert.equal(feedbackStrings('de').ratingOf(4), '4 von 5');
});

test('the German web catalogue renders through getUiStrings with the same key shape', () => {
  const be = getUiStrings('be');
  const de = getUiStrings('de');
  assert.equal(de.catalogTitle, 'Stadt-Guides');
  assert.equal(de.nextStop, 'Nächste Station');
  assert.equal(de.privacyTitle, 'Datenschutz');
  assert.equal(de.langSwitchName, 'English');
  // The generated projection keeps the key shape of the shipped sets.
  assert.deepEqual(Object.keys(de).sort(), Object.keys(be).sort());
  // No German word is blank (the shape guard's own rule, for de).
  for (const [key, value] of Object.entries(de)) {
    if (typeof value === 'string') assert.ok(value.length > 0, `${key}: empty word`);
  }
});
