// APR-08.a (issue #849, criterion 5): the strings the public privacy page
// renders must stay byte-equal to the reviewed ui-messages contract — the be
// base text from source.json and the reviewed translation value in every other
// language. A hand-edited generated catalogue or a contract↔projection drift
// fails here. The absence probes for the unproven stored-aggregate promise live
// in tools/i18n/privacy-disclosure.test.mjs (single owner of that table);
// this test proves the rendered channel carries exactly the reviewed contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPLETE_UI_LOCALES } from '../../../contracts/ui-locales.ts';
import { loadUiMessagesSource } from '../../../contracts/ui-messages/ui-messages.mjs';
import { loadUiMessageTranslations } from '../../../contracts/ui-messages/translations.mjs';
import { getUiStrings } from './index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const sourceDoc = loadUiMessagesSource(join(root, 'contracts/ui-messages/source.json'));

test('every rendered locale carries the reviewed privacyRetention contract text', () => {
  const sourceRecord = sourceDoc.records.find((record) => record.id === 'web.ui.privacyRetention');
  assert.ok(sourceRecord, 'source record web.ui.privacyRetention exists');
  for (const locale of COMPLETE_UI_LOCALES) {
    const rendered = getUiStrings(locale).privacyRetention;
    if (locale === sourceDoc.source_locale) {
      assert.equal(rendered, sourceRecord.source, `${locale}: rendered text = the be base text`);
      continue;
    }
    const set = loadUiMessageTranslations(
      join(root, `contracts/ui-messages/translations/${locale}.json`),
      sourceDoc,
      COMPLETE_UI_LOCALES,
    );
    const record = set.records.find((record) => record.id === 'web.ui.privacyRetention');
    assert.ok(record, `${locale}: translation record web.ui.privacyRetention exists`);
    assert.equal(
      rendered,
      record.value,
      `${locale}: rendered privacyRetention = the reviewed translation value`,
    );
  }
});
