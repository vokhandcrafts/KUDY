// G21.25 — the golden render-equivalence test. Before the catalogs became
// generated projections, every message leaf of the hand-maintained catalogs
// was captured (test/ui-messages-render-golden.json): plain words verbatim and
// every template rendered over a fixed argument matrix (numbers, strings with
// quotes/newlines, lists including the empty one, the null fallback, the
// PreviewDetail variants) for every shipped locale. This test re-renders every
// row through the live selectors — now fed by the generated catalogues — and
// demands byte-equal output: the generation replaced the authoring location,
// never the words (issue #558, criterion 5: existing be/en/uk behavior).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { uiStrings } from '../components/ui-strings.ts';
import { previewStrings } from '../controllers/catalog/previewController.ts';
import { runMapStrings } from '../controllers/run/runMap.ts';
import { placeDetailStrings } from '../controllers/place/placeDetailController.ts';
import { nearbyStrings } from '../controllers/nearby/nearbySurfaceController.ts';
import { offerStrings } from '../controllers/commerce/commerceController.ts';
// GuideHintCard.tsx is JSX (node cannot import it); its generated data module
// is pure TS and carries the same be/en words the card's selector returns.
import { GUIDE_HINT_STRINGS } from '../components/guide-hint-strings.generated.ts';

const root = join(dirname(fileURLToPath(import.meta.url)));

const CATALOGS = {
  'native.chrome': (locale) => uiStrings(locale),
  'native.preview': (locale) => previewStrings(locale),
  'native.run': (locale) => runMapStrings(locale),
  'native.place': (locale) => placeDetailStrings(locale),
  'native.nearby': (locale) => nearbyStrings(locale),
  'native.offer': (locale) => offerStrings(locale),
  'native.guideHint': (locale) => GUIDE_HINT_STRINGS[locale] ?? GUIDE_HINT_STRINGS.be,
  'web.ui': null, // web rows ride the generated per-locale data below
};

import { be as webBe } from '../web/lib/i18n/be.ts';
import { en as webEn } from '../web/lib/i18n/en.ts';
import { uk as webUk } from '../web/lib/i18n/uk.ts';
const WEB_LOCALES = { be: webBe, en: webEn, uk: webUk };

function leafByAnchor(catalog, id) {
  let current = catalog;
  for (const part of id.split('.').slice(2)) {
    current = current?.[part];
    if (current === undefined) return undefined;
  }
  return current;
}

const golden = JSON.parse(readFileSync(join(root, 'ui-messages-render-golden.json'), 'utf8'));

test('every captured catalog output re-renders byte-equal from the generated data', () => {
  assert.ok(golden.rows.length > 1000, 'the golden matrix is loaded');
  let rendered = 0;
  for (const row of golden.rows) {
    const out = row.id.startsWith('web.ui.')
      ? leafByAnchor(WEB_LOCALES[row.locale], row.id)
      : (() => {
          const value = leafByAnchor(CATALOGS[row.id.split('.').slice(0, 2).join('.')](row.locale), row.id);
          if (row.args === null) return value;
          return row.id === 'native.preview.detail' ? value(row.args) : value(...row.args);
        })();
    assert.equal(out, row.out, `${row.id} [${row.locale}] ${JSON.stringify(row.args)}`);
    rendered += 1;
  }
  assert.equal(rendered, golden.rows.length);
});
