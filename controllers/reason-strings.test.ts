// G06.10 (issue #433) — the one outward formatting rule for the reason
// dictionaries: a reason line reads as a phrase — it starts with a capital
// letter and ends with a period. The technical nouns («пакет», «сховішча»)
// stay out of the rendered lines (the muted detail lines keep the
// diagnostics and are not governed here). Guarded over both locales of every
// source the rule covers — preview's reason map plus the download-failure
// banner, run's reasonText, place's refusalText; the My history line rides
// the same rule in components/ui-strings.test.tsx. Reverting any value to
// the old lowercase or period-less wording fails here
// (implementation-rules 1).
import test from 'node:test';
import assert from 'node:assert/strict';

import { previewStrings } from './catalog/previewController.ts';
import { runMapStrings } from './run/runMap.ts';
import { placeDetailStrings } from './place/placeDetailController.ts';

const PHRASE_RULE = /^[A-ZА-ЯЁЎ].*\.$/;

test('G06.10 #433: preview reason lines read as phrases (be+en)', () => {
  for (const locale of ['be', 'en']) {
    const strings = previewStrings(locale);
    for (const [code, line] of Object.entries(strings.reason)) {
      assert.match(line, PHRASE_RULE, `${locale} ${code}: ${line}`);
    }
    assert.match(
      strings.downloadFailed,
      PHRASE_RULE,
      `${locale} downloadFailed: ${strings.downloadFailed}`,
    );
  }
});

test('G06.10 #433: run reason lines read as phrases (be+en)', () => {
  for (const locale of ['be', 'en']) {
    for (const [code, line] of Object.entries(runMapStrings(locale).reasonText)) {
      assert.match(line, PHRASE_RULE, `${locale} ${code}: ${line}`);
    }
  }
});

test('G06.10 #433: place refusal lines read as phrases (be+en)', () => {
  for (const locale of ['be', 'en']) {
    for (const [code, line] of Object.entries(placeDetailStrings(locale).refusalText)) {
      assert.match(line, PHRASE_RULE, `${locale} ${code}: ${line}`);
    }
  }
});
