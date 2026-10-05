// G21.12 (issue #546) — the French catalogue's locale-specific rendering
// suite. The shipped-locale gate (tools/i18n/check-messages.mjs) proves the
// fr set's completeness, review evidence and output freshness; this suite
// proves the French words actually render through the production selectors:
// the adapter chains route fr, the discrete forms (numeric timeCap, named
// preview detail) render the French variants, and the composed textAudioLine
// drops its audio tail on an empty list. Deleting the fr catalogue or its
// generated outputs fails here through the missing imports and the gate —
// and every concrete word below fails the moment its data line is reverted.
import test from 'node:test';
import assert from 'node:assert/strict';

import { localeFamilies } from './ui-locale-families.mjs';
import { fr as webFr } from '../web/lib/i18n/fr.ts';
import { getUiStrings } from '../web/lib/i18n/index.ts';

test('the chrome adapter routes fr to the French catalogue', () => {
  const s = localeFamilies('fr').chrome;
  assert.equal(s.back, 'Retour');
  assert.equal(s.currentWalk, 'Visite en cours');
  assert.equal(s.catalogUnavailable, 'Catalogue indisponible');
  assert.equal(s.retry, 'Réessayer');
  // The registry self-names ride the registry call, never a translation:
  // every complete language is named from one table.
  assert.equal(s.languageSelfNames.fr, 'Français');
  assert.equal(s.languageSelfNames.be, 'Беларуская');
});

test('the French discrete forms render over the selector arguments', () => {
  const s = localeFamilies('fr').chrome;
  assert.equal(s.timeCap(30), "Jusqu'à 30 min");
  assert.equal(s.timeCap(60), "Jusqu'à une heure");
  assert.equal(s.timeCap(120), "Jusqu'à deux heures");
  assert.equal(s.timeCap(240), 'Une demi-journée');
  assert.equal(s.stopsCount(5), 'Étapes : 5');
  assert.equal(s.stopNumber(3), 'Étape 3');
  assert.equal(s.durationRange(45, 90), 'Durée : de 45 à 90 min');
  // The composed text/audio line keeps its tail guarded on a non-empty list.
  assert.equal(s.textAudioLine(['fr'], []), 'Texte : fr');
  assert.equal(s.textAudioLine(['fr'], ['en']), 'Texte : fr ; audio : en');
});

test('the French preview detail renders the named kind forms', () => {
  const { preview, previewReasonText } = localeFamilies('fr');
  assert.equal(preview.detail({ kind: 'damaged' }), 'paquet endommagé : nouveau téléchargement nécessaire');
  assert.equal(preview.detail({ kind: 'missing-files', count: 2 }), 'fichiers manquants : 2');
  assert.equal(preview.detail({ kind: 'stale' }), 'une mise à jour est disponible');
  assert.equal(preview.detail({ kind: 'other' }), 'paquet incomplet');
  assert.equal(previewReasonText('preview#purchase-required', preview), 'Achat requis.');
  // An unknown diagnostic renders as-is (the honest runMapReason idiom).
  assert.equal(previewReasonText('preview#unknown', preview), 'preview#unknown');
});

test('every French controller family routes and renders its words', () => {
  const f = localeFamilies('fr');
  assert.equal(f.guideHint.heading, 'Il y a un guide à proximité…');
  assert.equal(f.guideHint.paid, 'payant');
  assert.equal(f.run.endWalk, 'Terminer la visite');
  assert.equal(f.runReason('run#package-not-downloaded', f.run), "Le guide n'est pas téléchargé.");
  assert.equal(f.place.playLabel, 'Écouter le teaser');
  assert.equal(f.place.stopLabel, 'Arrêter');
  assert.equal(f.nearby.title, 'À proximité');
  assert.equal(f.offer.buy, 'Acheter');
  assert.equal(f.offer.dismiss, 'Pas maintenant');
  assert.equal(f.feedback.deleteButton, "Supprimer l'évaluation");
  assert.equal(f.feedback.ratingOf(4), '4 sur 5');
});

test('the French web catalogue renders through getUiStrings with the same key shape', () => {
  const be = getUiStrings('be');
  const fr = getUiStrings('fr');
  assert.equal(fr.catalogTitle, 'Guides de la ville');
  assert.equal(fr.nextStop, 'Prochaine étape');
  assert.equal(fr.privacyTitle, 'Confidentialité');
  assert.equal(fr.langSwitchName, 'English');
  // The generated projection keeps the key shape of the shipped sets.
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(be).sort());
  // No French word is blank (the shape guard's own rule, for fr).
  for (const [key, value] of Object.entries(fr)) {
    if (typeof value === 'string') assert.ok(value.length > 0, `${key}: empty word`);
  }
});
