// G21.11 (issue #545) — the Spanish catalogue's locale-specific rendering
// suite. The shipped-locale gate (tools/i18n/check-messages.mjs) proves the
// es set's completeness, review evidence and output freshness; this suite
// proves the Spanish words through the production selectors themselves: the
// adapter chains route es, the discrete forms (numeric timeCap, named
// preview detail) render the Spanish variants, and the composed textAudioLine
// drops its audio tail on an empty list. Deleting the es catalogue or its
// generated outputs fails here through the missing imports and the gate —
// and every concrete word below fails the moment its data line is reverted.
import test from 'node:test';
import assert from 'node:assert/strict';

// The es suite walks the controller families in run order (chrome, hint,
// preview, run, place, nearby, offer, feedback, web) — the same production
// entrypoints the run screen exercises, imported straight so a deleted
// catalogue fails the import, not the assertion.
import { uiStrings } from '../components/ui-strings.ts';
import { GUIDE_HINT_STRINGS } from '../components/guide-hint-strings.generated.ts';
import { previewReasonText, previewStrings } from '../controllers/catalog/previewController.ts';
import { runMapReason, runMapStrings } from '../controllers/run/runMap.ts';
import { placeDetailStrings } from '../controllers/place/placeDetailController.ts';
import { nearbyStrings } from '../controllers/nearby/nearbySurfaceController.ts';
import { offerStrings } from '../controllers/commerce/commerceController.ts';
import { feedbackStrings } from '../controllers/useFeedbackController.ts';
import { es as webEs } from '../web/lib/i18n/es.ts';
import { getUiStrings } from '../web/lib/i18n/index.ts';

test('the chrome adapter routes es to the Spanish catalogue', () => {
  const s = uiStrings('es');
  assert.equal(s.back, 'Atrás');
  assert.equal(s.currentWalk, 'Recorrido actual');
  assert.equal(s.catalogUnavailable, 'Catálogo no disponible');
  assert.equal(s.retry, 'Reintentar');
  // The registry self-names ride the registry call, never a translation:
  // every complete language is named from one table.
  assert.equal(s.languageSelfNames.es, 'Español');
  assert.equal(s.languageSelfNames.be, 'Беларуская');
});

test('the Spanish discrete forms render over the selector arguments', () => {
  const s = uiStrings('es');
  assert.equal(s.timeCap(30), 'Hasta 30 min');
  assert.equal(s.timeCap(60), 'Hasta una hora');
  assert.equal(s.timeCap(120), 'Hasta dos horas');
  assert.equal(s.timeCap(240), 'Medio día');
  assert.equal(s.stopsCount(5), 'Paradas: 5');
  assert.equal(s.stopNumber(3), 'Parada 3');
  assert.equal(s.durationRange(45, 90), 'Tiempo: de 45 a 90 min');
  // The composed text/audio line keeps its tail guarded on a non-empty list.
  assert.equal(s.textAudioLine(['de'], []), 'Texto: de');
  assert.equal(s.textAudioLine(['de'], ['en']), 'Texto: de; audio: en');
});

test('the Spanish preview detail renders the named kind forms', () => {
  const s = previewStrings('es');
  assert.equal(s.detail({ kind: 'damaged' }), 'Paquete dañado: hace falta descargar de nuevo');
  assert.equal(s.detail({ kind: 'missing-files', count: 2 }), 'Faltan archivos: 2');
  assert.equal(s.detail({ kind: 'stale' }), 'Hay una actualización disponible');
  assert.equal(s.detail({ kind: 'other' }), 'Paquete incompleto');
  assert.equal(previewReasonText('preview#purchase-required', s), 'Se requiere compra.');
  // An unknown diagnostic renders as-is (the honest runMapReason idiom).
  assert.equal(previewReasonText('preview#unknown', s), 'preview#unknown');
});

test('every Spanish controller family routes and renders its words', () => {
  assert.equal(GUIDE_HINT_STRINGS.es.heading, 'Cerca hay una guía…');
  assert.equal(GUIDE_HINT_STRINGS.es.paid, 'de pago');
  assert.equal(runMapStrings('es').endWalk, 'Terminar el recorrido');
  assert.equal(runMapReason('run#package-not-downloaded', runMapStrings('es')), 'La guía no está descargada.');
  assert.equal(placeDetailStrings('es').playLabel, 'Escuchar el avance');
  assert.equal(placeDetailStrings('es').stopLabel, 'Detener');
  assert.equal(nearbyStrings('es').title, 'Cerca');
  assert.equal(offerStrings('es').buy, 'Comprar');
  assert.equal(offerStrings('es').dismiss, 'Ahora no');
  assert.equal(feedbackStrings('es').deleteButton, 'Eliminar la valoración');
  assert.equal(feedbackStrings('es').ratingOf(4), '4 de 5');
});

test('the Spanish web catalogue renders through getUiStrings with the same key shape', () => {
  const be = getUiStrings('be');
  const es = getUiStrings('es');
  assert.equal(es.catalogTitle, 'Guías de la ciudad');
  assert.equal(es.nextStop, 'Siguiente parada');
  assert.equal(es.privacyTitle, 'Privacidad');
  assert.equal(es.langSwitchName, 'English');
  // The generated projection keeps the key shape of the shipped sets.
  assert.deepEqual(Object.keys(es).sort(), Object.keys(be).sort());
  // No Spanish word is blank (the shape guard's own rule, for es).
  for (const [key, value] of Object.entries(es)) {
    if (typeof value === 'string') assert.ok(value.length > 0, `${key}: empty word`);
  }
});
