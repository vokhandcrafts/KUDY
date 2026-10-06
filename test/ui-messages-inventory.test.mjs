// G21.24 — the canonical inventory guard (issue #557 criterion 1): the records
// of contracts/ui-messages/source.json are the actual messages of the shipped
// catalogs, not an assumed set. Every be leaf of the seven importable catalogs
// must have exactly one record anchored to it via migratedFrom, plain words
// verbatim; the guideHint words ride their generated data module (G21.25 —
// GuideHintCard.tsx itself is JSX, node cannot import it). Deleting a record,
// renaming a key or editing a catalog word fails this test — the source cannot
// silently drift from the catalogs it documents.
import test from 'node:test';
import assert from 'node:assert/strict';

import { uiStrings } from '../components/ui-strings.ts';
import { previewStrings } from '../controllers/catalog/previewController.ts';
import { runMapStrings } from '../controllers/run/runMap.ts';
import { placeDetailStrings } from '../controllers/place/placeDetailController.ts';
import { nearbyStrings } from '../controllers/nearby/nearbySurfaceController.ts';
import { offerStrings } from '../controllers/commerce/commerceController.ts';
import { feedbackStrings } from '../controllers/useFeedbackController.ts';
import { be as webBe } from '../web/lib/i18n/be.ts';
import { GUIDE_HINT_STRINGS } from '../components/guide-hint-strings.generated.ts';

import { loadUiMessagesSource } from '../contracts/ui-messages/ui-messages.mjs';

const CATALOGS = {
  'native.chrome': { value: uiStrings('be'), file: 'components/ui-strings.ts' },
  'native.preview': { value: previewStrings('be'), file: 'controllers/catalog/previewController.ts' },
  'native.run': { value: runMapStrings('be'), file: 'controllers/run/runMap.ts' },
  'native.place': { value: placeDetailStrings('be'), file: 'controllers/place/placeDetailController.ts' },
  'native.nearby': { value: nearbyStrings('be'), file: 'controllers/nearby/nearbySurfaceController.ts' },
  'native.offer': { value: offerStrings('be'), file: 'controllers/commerce/commerceController.ts' },
  'native.feedback': { value: feedbackStrings('be'), file: 'controllers/useFeedbackController.ts' },
  'web.ui': { value: webBe, file: 'web/lib/i18n/be.ts' },
};

// GuideHintCard.tsx cannot be imported under node strip-types (JSX); since
// G21.25 the card's words live in the generated data module, which is pure
// TS and imported here — the check reads the shipped words, not a restatement.
const GUIDE_HINT = {
  'native.guideHint.heading': GUIDE_HINT_STRINGS.be.heading,
  'native.guideHint.paid': GUIDE_HINT_STRINGS.be.paid,
  'native.guideHint.openHint': GUIDE_HINT_STRINGS.be.openHint,
  'native.guideHint.dismiss': GUIDE_HINT_STRINGS.be.dismiss,
};

function leaves(value, prefix = '') {
  if (value === null || typeof value !== 'object') return [{ key: prefix, leaf: value }];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
}

// G21.09 (issue #542): the chrome selfNames subtree is projected from the one
// locale registry (completeUiLocaleSelfNames()), not from the canonical
// records — the registry table owns the self-name words, so a complete code
// the records never carried (de, G21.10 #544; es, G21.11 #545;
// fr, G21.12 #546; cs, G21.13 #547; sv, G21.14 #548) appears there by
// design. The walk skips the subtree together with its legacy migration
// anchors.
function registryProjected(key) {
  return key.startsWith('languageSelfNames.');
}

const doc = loadUiMessagesSource();

test('every catalog key path has exactly one canonical record anchored to it', () => {
  for (const [domain, { value: catalog, file }] of Object.entries(CATALOGS)) {
    const walked = leaves(catalog).filter(({ key }) => !registryProjected(key));
    const owned = doc.records.filter((record) =>
      record.migratedFrom.some(
        (anchor) => anchor.startsWith(`${file}#`) && !registryProjected(anchor.slice(file.length + 1)),
      ),
    );
    const anchored = new Set(
      owned.flatMap((record) =>
        record.migratedFrom.filter((anchor) => anchor.startsWith(`${file}#`)).map((anchor) => anchor.slice(file.length + 1)),
      ),
    );
    const missing = walked.filter(({ key }) => !anchored.has(key)).map(({ key }) => `${file}#${key}`);
    assert.deepEqual(missing, [], `${file}: catalog keys without a canonical record`);
    const phantom = [...anchored].filter((key) => !walked.some(({ key: walkedKey }) => walkedKey === key));
    assert.deepEqual(phantom, [], `${file}: records anchored to keys the catalog does not have`);
    // Exactly one record per anchored key: no blind merging of same wording
    // under one id, no double anchoring either.
    const byKey = new Map();
    for (const record of owned) {
      for (const anchor of record.migratedFrom) {
        if (!anchor.startsWith(`${file}#`)) continue;
        const key = anchor.slice(file.length + 1);
        byKey.set(key, (byKey.get(key) ?? 0) + 1);
      }
    }
    const doubled = [...byKey.entries()].filter(([, count]) => count > 1).map(([key]) => key);
    assert.deepEqual(doubled, [], `${file}: keys anchored by more than one record`);
  }
});

test('plain catalog words are verbatim in the canonical records', () => {
  for (const [domain, { value: catalog, file }] of Object.entries(CATALOGS)) {
    for (const { key, leaf } of leaves(catalog).filter(({ key }) => !registryProjected(key))) {
      const record = doc.records.find((candidate) => candidate.migratedFrom.includes(`${file}#${key}`));
      assert.ok(record, `${file}#${key} has no record`);
      if (typeof leaf === 'string') {
        assert.equal(record.format, 'plain', `${record.id}: a catalog string stays plain`);
        assert.equal(record.source, leaf, `${record.id}: the be source must be verbatim`);
        assert.deepEqual(record.parameters, [], `${record.id}: a plain word takes no parameters`);
      } else {
        assert.equal(record.format, 'template', `${record.id}: a catalog phrase is a template`);
        assert.ok(record.parameters.length > 0, `${record.id}: a catalog phrase declares parameters`);
      }
    }
  }
});

test('the four composites the walk cannot express carry their canonical shape', () => {
  const timeCap = doc.records.find((record) => record.id === 'native.chrome.timeCap');
  assert.equal(timeCap.source, 'Да ${minutes} хв');
  assert.deepEqual(timeCap.discreteForms, { 60: 'Да гадзіны', 120: 'Да дзвюх гадзін', 240: 'На паўдня' });
  const detail = doc.records.find((record) => record.id === 'native.preview.detail');
  assert.equal(detail.source, 'пакет няпоўны');
  assert.deepEqual(detail.discreteForms, {
    damaged: 'пакет пашкоджаны: патрэбна паўторная загрузка',
    'missing-files': 'не хапае файлаў: ${count}',
    stale: 'даступна абнаўленне',
  });
  const languages = doc.records.find((record) => record.id === 'native.chrome.languagesLine');
  assert.deepEqual(languages.parameters, [{ name: 'textLocales', type: 'list', join: ', ' }]);
  const textAudio = doc.records.find((record) => record.id === 'native.chrome.textAudioLine');
  assert.equal(textAudio.composed, true);
});

test('the JSX card catalog is inventoried verbatim (hand-anchored)', () => {
  for (const [id, source] of Object.entries(GUIDE_HINT)) {
    const record = doc.records.find((candidate) => candidate.id === id);
    assert.ok(record, `${id} has no record`);
    assert.deepEqual(record.migratedFrom, [`components/GuideHintCard.tsx#${id.split('.').pop()}`]);
    assert.equal(record.source, source);
  }
});

test('every record is anchored to a real repository file', () => {
  const knownFiles = new Set([...Object.values(CATALOGS).map(({ file }) => file), 'components/GuideHintCard.tsx']);
  for (const record of doc.records) {
    for (const anchor of record.migratedFrom) {
      // The separating '#' is the first one: reason keys themselves carry '#'
      // (e.g. refusalText.moment#audio-unpublished).
      const file = anchor.slice(0, anchor.indexOf('#'));
      assert.ok(knownFiles.has(file), `${record.id}: anchor ${anchor} points outside the inventoried catalogs`);
    }
  }
});
