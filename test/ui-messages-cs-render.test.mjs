// G21.13 (issue #547) — the Czech catalogue's locale-specific rendering
// suite. The shipped-locale gate (tools/i18n/check-messages.mjs) proves the
// cs set's completeness, review evidence and output freshness; this suite
// proves the Czech words actually render through the production selectors:
// the adapter chains route cs, the discrete forms (numeric timeCap, named
// preview detail) render the Czech variants, and the composed textAudioLine
// drops its audio tail on an empty list. Deleting the cs catalogue or its
// generated outputs fails here through the missing imports and the gate —
// and every concrete word below fails the moment its data line is reverted.
// The selector imports live in the shared families helper once (G21.12) —
// this suite imports the helper, it does not clone the import surface.
import test from 'node:test';
import assert from 'node:assert/strict';

import { localeFamilies } from './ui-locale-families.mjs';
import { cs as webCs } from '../web/lib/i18n/cs.ts';
import { getUiStrings } from '../web/lib/i18n/index.ts';

test('the chrome adapter routes cs to the Czech catalogue', () => {
  const s = localeFamilies('cs').chrome;
  assert.equal(s.back, 'Zpět');
  assert.equal(s.currentWalk, 'Aktuální procházka');
  assert.equal(s.catalogUnavailable, 'Katalog není dostupný');
  assert.equal(s.retry, 'Zkusit znovu');
  // The registry self-names ride the registry call, never a translation:
  // every complete language is named from one table.
  assert.equal(s.languageSelfNames.cs, 'Čeština');
  assert.equal(s.languageSelfNames.be, 'Беларуская');
});

test('the Czech discrete forms render over the selector arguments', () => {
  const s = localeFamilies('cs').chrome;
  assert.equal(s.timeCap(30), 'Do 30 min');
  assert.equal(s.timeCap(60), 'Do hodiny');
  assert.equal(s.timeCap(120), 'Do dvou hodin');
  assert.equal(s.timeCap(240), 'Půl dne');
  assert.equal(s.stopsCount(5), 'Zastavení: 5');
  assert.equal(s.stopNumber(3), 'Zastavení 3');
  assert.equal(s.durationRange(45, 90), 'Čas: od 45 do 90 min');
  // The composed text/audio line keeps its tail guarded on a non-empty list.
  assert.equal(s.textAudioLine(['cs'], []), 'Text: cs');
  assert.equal(s.textAudioLine(['cs'], ['en']), 'Text: cs; audio: en');
});

test('the Czech preview detail renders the named kind forms', () => {
  const { preview, previewReasonText } = localeFamilies('cs');
  assert.equal(preview.detail({ kind: 'damaged' }), 'Balík je poškozený: stáhni znovu');
  assert.equal(preview.detail({ kind: 'missing-files', count: 2 }), 'Chybí soubory: 2');
  assert.equal(preview.detail({ kind: 'stale' }), 'Je k dispozici aktualizace');
  assert.equal(preview.detail({ kind: 'other' }), 'Balík není úplný');
  assert.equal(previewReasonText('preview#purchase-required', preview), 'Vyžaduje se nákup.');
  // An unknown diagnostic renders as-is (the honest runMapReason idiom).
  assert.equal(previewReasonText('preview#unknown', preview), 'preview#unknown');
});

test('every Czech controller family routes and renders its words', () => {
  const f = localeFamilies('cs');
  assert.equal(f.guideHint.heading, 'Poblíž je průvodce…');
  assert.equal(f.guideHint.paid, 'placený');
  assert.equal(f.run.endWalk, 'Ukončit procházku');
  assert.equal(f.runReason('run#package-not-downloaded', f.run), 'Průvodce není stažený.');
  assert.equal(f.place.playLabel, 'Přehrát ukázku');
  assert.equal(f.place.stopLabel, 'Zastavit');
  assert.equal(f.nearby.title, 'Poblíž');
  assert.equal(f.offer.buy, 'Koupit');
  assert.equal(f.offer.dismiss, 'Teď ne');
  assert.equal(f.feedback.deleteButton, 'Smazat hodnocení');
  assert.equal(f.feedback.ratingOf(4), '4 z 5');
});

test('the Czech web catalogue renders through getUiStrings with the same key shape', () => {
  const be = getUiStrings('be');
  const cs = getUiStrings('cs');
  assert.equal(cs.catalogTitle, 'Průvodci po městě');
  assert.equal(cs.nextStop, 'Další zastavení');
  assert.equal(cs.privacyTitle, 'Soukromí');
  // The generated projection keeps the key shape of the shipped sets.
  assert.deepEqual(Object.keys(cs).sort(), Object.keys(be).sort());
  // No Czech word is blank (the shape guard's own rule, for cs).
  for (const [key, value] of Object.entries(cs)) {
    if (typeof value === 'string') assert.ok(value.length > 0, `${key}: empty word`);
  }
});
