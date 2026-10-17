// G21.46 (issue #670) — the Simplified Chinese catalogue's locale-specific
// rendering suite. The shipped-locale gate (tools/i18n/check-messages.mjs)
// proves the zh set's completeness, review evidence and output freshness;
// this suite proves the Chinese words actually render through the production
// selectors: the adapter chains route zh, the discrete forms (numeric timeCap,
// named preview detail) render the Chinese variants, and the composed
// textAudioLine drops its audio tail on an empty list. Deleting the zh
// catalogue or its generated outputs fails here through the missing imports
// and the gate — and every concrete word below fails the moment its data line
// is reverted. Criterion 7 is proven on bytes: the committed zh files carry no
// CJK byte, only \uXXXX escapes that decode to the real glyphs. The selector
// imports live in the shared families helper once (G21.12) — this suite
// imports the helper, it does not clone the import surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { localeFamilies } from './ui-locale-families.mjs';
import { zh as webZh } from '../web/lib/i18n/zh.ts';
import { getUiStrings } from '../web/lib/i18n/index.ts';
import { uiLocaleNativeName } from '../contracts/ui-locales.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the chrome adapter routes zh to the Chinese catalogue', () => {
  const s = localeFamilies('zh').chrome;
  assert.equal(s.back, '\u4E0A\u4E00\u6B65');
  assert.equal(s.currentWalk, '\u5F53\u524D\u6563\u6B65');
  assert.equal(s.catalogUnavailable, '\u76EE\u5F55\u4E0D\u53EF\u7528');
  assert.equal(s.retry, '\u91CD\u8BD5');
  // The registry self-names ride the registry call, never a translation: the
  // ninth language is named from the same one table.
  assert.equal(s.languageSelfNames.zh, '\u7B80\u4F53\u4E2D\u6587');
  assert.equal(s.languageSelfNames.be, 'Беларуская');
  assert.equal(uiLocaleNativeName('zh'), '\u7B80\u4F53\u4E2D\u6587');
});

test('the Chinese discrete forms render over the selector arguments', () => {
  const s = localeFamilies('zh').chrome;
  assert.equal(s.timeCap(30), '\u6700\u591A30\u5206\u949F');
  assert.equal(s.timeCap(60), '\u6700\u591A\u4E00\u5C0F\u65F6');
  assert.equal(s.timeCap(120), '\u6700\u591A\u4E24\u5C0F\u65F6');
  assert.equal(s.timeCap(240), '\u534A\u5929');
  // stop is invariant in numbers — the count line needs no plural or ICU rule.
  assert.equal(s.stopsCount(5), '\u5730\u70B9\uFF1A5');
  assert.equal(s.stopNumber(3), '\u5730\u70B9 3');
  assert.equal(s.durationRange(45, 90), '\u65F6\u95F4\uFF1A45–90\u5206\u949F');
  // The composed text/audio line keeps its tail guarded on a non-empty list.
  assert.equal(s.textAudioLine(['zh'], []), '\u6587\u672C\uFF1Azh');
  assert.equal(s.textAudioLine(['zh'], ['en']), '\u6587\u672C\uFF1Azh\uFF1B\u97F3\u9891\uFF1Aen');
});

test('the Chinese preview detail renders the named kind forms', () => {
  const { preview, previewReasonText } = localeFamilies('zh');
  assert.equal(preview.detail({ kind: 'damaged' }), '\u5185\u5BB9\u5305\u5DF2\u635F\u574F\uFF1A\u9700\u8981\u91CD\u65B0\u4E0B\u8F7D');
  assert.equal(preview.detail({ kind: 'missing-files', count: 2 }), '\u7F3A\u5C11\u6587\u4EF6\uFF1A2');
  assert.equal(preview.detail({ kind: 'stale' }), '\u6709\u53EF\u7528\u66F4\u65B0');
  assert.equal(preview.detail({ kind: 'other' }), '\u5185\u5BB9\u5305\u4E0D\u5B8C\u6574');
  assert.equal(previewReasonText('preview#purchase-required', preview), '\u9700\u8981\u8D2D\u4E70\u3002');
  // An unknown diagnostic renders as-is (the honest runMapReason idiom).
  assert.equal(previewReasonText('preview#unknown', preview), 'preview#unknown');
});

test('every Chinese controller family routes and renders its words', () => {
  const f = localeFamilies('zh');
  assert.equal(f.guideHint.heading, '\u9644\u8FD1\u6709\u5BFC\u89C8…');
  assert.equal(f.guideHint.paid, '\u4ED8\u8D39');
  assert.equal(f.run.endWalk, '\u7ED3\u675F\u6563\u6B65');
  assert.equal(f.runReason('run#package-not-downloaded', f.run), '\u5BFC\u89C8\u672A\u4E0B\u8F7D\u3002');
  assert.equal(f.place.playLabel, '\u8BD5\u542C');
  assert.equal(f.place.stopLabel, '\u505C\u6B62');
  assert.equal(f.nearby.title, '\u9644\u8FD1');
  assert.equal(f.offer.buy, '\u8D2D\u4E70');
  assert.equal(f.offer.dismiss, '\u4EE5\u540E\u518D\u8BF4');
  assert.equal(f.feedback.deleteButton, '\u5220\u9664\u8BC4\u4EF7');
  assert.equal(f.feedback.ratingOf(4), '5\u5206\u4E2D\u76844\u5206');
});

test('the Chinese web catalogue renders through getUiStrings with the same key shape', () => {
  const be = getUiStrings('be');
  const zh = getUiStrings('zh');
  assert.equal(zh, webZh);
  assert.equal(zh.catalogTitle, '\u57CE\u5E02\u5BFC\u89C8');
  assert.equal(zh.nextStop, '\u4E0B\u4E00\u4E2A\u5730\u70B9');
  assert.equal(zh.privacyTitle, '\u9690\u79C1');
  // The generated projection keeps the key shape of the shipped sets.
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(be).sort());
  // No Chinese word is blank (the shape guard's own rule, for zh).
  for (const [key, value] of Object.entries(zh)) {
    if (typeof value === 'string') assert.ok(value.length > 0, `${key}: empty word`);
  }
});

test('criterion 7: the committed zh bytes are CJK-free and decode to real glyphs', () => {
  const CJK = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/u;
  // Every committed file that carries zh words: the catalogue, the registry
  // entry, the glossary terms, each generated projection, the web catalogue
  // and the two zh test files (which pin the glyphs as escapes too).
  const files = [
    'contracts/ui-messages/translations/zh.json',
    'contracts/ui-locales.ts',
    'contracts/ui-messages/glossary.json',
    'components/ui-strings.generated.ts',
    'components/guide-hint-strings.generated.ts',
    'controllers/run/runMap-strings.generated.ts',
    'controllers/catalog/preview-strings.generated.ts',
    'controllers/place/placeDetail-strings.generated.ts',
    'controllers/nearby/nearbySurface-strings.generated.ts',
    'controllers/commerce/commerce-strings.generated.ts',
    'controllers/feedback-strings.generated.ts',
    'web/lib/i18n/zh.ts',
    'app/my-locale-zh.test.tsx',
  ];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    assert.ok(!CJK.test(text), `${file} carries no raw CJK byte (escapes only)`);
  }
  // The escapes are the words: the catalogue decodes to the published glyphs.
  const catalogue = JSON.parse(readFileSync(join(root, 'contracts/ui-messages/translations/zh.json'), 'utf8'));
  const byId = new Map(catalogue.records.map((record) => [record.id, record.value]));
  assert.equal(byId.get('native.chrome.back'), '\u4E0A\u4E00\u6B65');
  assert.equal(byId.get('native.chrome.walk'), '\u6563\u6B65');
  assert.equal(byId.get('native.chrome.catalogUnavailable'), '\u76EE\u5F55\u4E0D\u53EF\u7528');
  assert.equal(byId.get('native.preview.label.download'), '\u4E0B\u8F7D');
});
