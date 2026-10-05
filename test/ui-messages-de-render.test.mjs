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

import { localeFamilies } from './ui-locale-families.mjs';
import { de as webDe } from '../web/lib/i18n/de.ts';
import { getUiStrings } from '../web/lib/i18n/index.ts';

test('the chrome adapter routes de to the German catalogue', () => {
  const s = localeFamilies('de').chrome;
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
  const s = localeFamilies('de').chrome;
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
  const { preview, previewReasonText } = localeFamilies('de');
  assert.equal(preview.detail({ kind: 'damaged' }), 'Paket beschädigt: erneutes Laden nötig');
  assert.equal(preview.detail({ kind: 'missing-files', count: 2 }), 'Fehlende Dateien: 2');
  assert.equal(preview.detail({ kind: 'stale' }), 'Ein Update ist verfügbar');
  assert.equal(preview.detail({ kind: 'other' }), 'Paket unvollständig');
  assert.equal(previewReasonText('preview#purchase-required', preview), 'Kauf erforderlich.');
  // An unknown diagnostic renders as-is (the honest runMapReason idiom).
  assert.equal(previewReasonText('preview#unknown', preview), 'preview#unknown');
});

test('every German controller family routes and renders its words', () => {
  const f = localeFamilies('de');
  assert.equal(f.guideHint.heading, 'In der Nähe gibt es einen Guide…');
  assert.equal(f.guideHint.paid, 'kostenpflichtig');
  assert.equal(f.run.endWalk, 'Rundgang beenden');
  assert.equal(f.runReason('run#package-not-downloaded', f.run), 'Der Guide ist nicht geladen.');
  assert.equal(f.place.playLabel, 'Teaser anhören');
  assert.equal(f.place.stopLabel, 'Stop');
  assert.equal(f.nearby.title, 'In der Nähe');
  assert.equal(f.offer.buy, 'Kaufen');
  assert.equal(f.offer.dismiss, 'Nicht jetzt');
  assert.equal(f.feedback.deleteButton, 'Bewertung löschen');
  assert.equal(f.feedback.ratingOf(4), '4 von 5');
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
