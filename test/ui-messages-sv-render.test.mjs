// G21.14 (issue #548) — the Swedish catalogue's locale-specific rendering
// suite. The shipped-locale gate (tools/i18n/check-messages.mjs) proves the
// sv set's completeness, review evidence and output freshness; this suite
// proves the Swedish words actually render through the production selectors:
// the adapter chains route sv, the discrete forms (numeric timeCap, named
// preview detail) render the Swedish variants, and the composed textAudioLine
// drops its audio tail on an empty list. Deleting the sv catalogue or its
// generated outputs fails here through the missing imports and the gate —
// and every concrete word below fails the moment its data line is reverted.
// The selector imports live in the shared families helper once (G21.12) —
// this suite imports the helper, it does not clone the import surface.
import test from 'node:test';
import assert from 'node:assert/strict';

import { localeFamilies } from './ui-locale-families.mjs';
import { sv as webSv } from '../web/lib/i18n/sv.ts';
import { getUiStrings } from '../web/lib/i18n/index.ts';

test('the chrome adapter routes sv to the Swedish catalogue', () => {
  const s = localeFamilies('sv').chrome;
  assert.equal(s.back, 'Tillbaka');
  assert.equal(s.currentWalk, 'Aktuell promenad');
  assert.equal(s.catalogUnavailable, 'Katalogen är inte tillgänglig');
  assert.equal(s.retry, 'Försök igen');
  // The registry self-names ride the registry call, never a translation:
  // every complete language is named from one table.
  assert.equal(s.languageSelfNames.sv, 'Svenska');
  assert.equal(s.languageSelfNames.be, 'Беларуская');
});

test('the Swedish discrete forms render over the selector arguments', () => {
  const s = localeFamilies('sv').chrome;
  assert.equal(s.timeCap(30), 'Upp till 30 min');
  assert.equal(s.timeCap(60), 'Upp till en timme');
  assert.equal(s.timeCap(120), 'Upp till två timmar');
  assert.equal(s.timeCap(240), 'Halva dagen');
  // stop (ett) is invariant in numbers — "Stopp: 1/2/5" is correct without ICU.
  assert.equal(s.stopsCount(5), 'Stopp: 5');
  assert.equal(s.stopNumber(3), 'Stopp 3');
  assert.equal(s.durationRange(45, 90), 'Tid: från 45 till 90 min');
  // The composed text/audio line keeps its tail guarded on a non-empty list.
  assert.equal(s.textAudioLine(['sv'], []), 'Text: sv');
  assert.equal(s.textAudioLine(['sv'], ['en']), 'Text: sv; ljud: en');
});

test('the Swedish preview detail renders the named kind forms', () => {
  const { preview, previewReasonText } = localeFamilies('sv');
  assert.equal(preview.detail({ kind: 'damaged' }), 'Paketet är skadat: ladda ner igen');
  assert.equal(preview.detail({ kind: 'missing-files', count: 2 }), 'Filer saknas: 2');
  assert.equal(preview.detail({ kind: 'stale' }), 'En uppdatering är tillgänglig');
  assert.equal(preview.detail({ kind: 'other' }), 'Paketet är ofullständigt');
  assert.equal(previewReasonText('preview#purchase-required', preview), 'Köp krävs.');
  // An unknown diagnostic renders as-is (the honest runMapReason idiom).
  assert.equal(previewReasonText('preview#unknown', preview), 'preview#unknown');
});

test('every Swedish controller family routes and renders its words', () => {
  const f = localeFamilies('sv');
  assert.equal(f.guideHint.heading, 'Det finns en guide i närheten…');
  assert.equal(f.guideHint.paid, 'betald');
  assert.equal(f.run.endWalk, 'Avsluta promenaden');
  assert.equal(f.runReason('run#package-not-downloaded', f.run), 'Guiden är inte nedladdad.');
  assert.equal(f.place.playLabel, 'Lyssna på smakprovet');
  assert.equal(f.place.stopLabel, 'Stoppa');
  assert.equal(f.nearby.title, 'I närheten');
  assert.equal(f.offer.buy, 'Köp');
  assert.equal(f.offer.dismiss, 'Inte nu');
  assert.equal(f.feedback.deleteButton, 'Ta bort betyget');
  assert.equal(f.feedback.ratingOf(4), '4 av 5');
});

test('the Swedish web catalogue renders through getUiStrings with the same key shape', () => {
  const be = getUiStrings('be');
  const sv = getUiStrings('sv');
  assert.equal(sv.catalogTitle, 'Stadsguider');
  assert.equal(sv.nextStop, 'Nästa stopp');
  assert.equal(sv.privacyTitle, 'Integritet');
  assert.equal(sv.langSwitchName, 'English');
  // The generated projection keeps the key shape of the shipped sets.
  assert.deepEqual(Object.keys(sv).sort(), Object.keys(be).sort());
  // No Swedish word is blank (the shape guard's own rule, for sv).
  for (const [key, value] of Object.entries(sv)) {
    if (typeof value === 'string') assert.ok(value.length > 0, `${key}: empty word`);
  }
});
