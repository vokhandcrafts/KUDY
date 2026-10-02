// G06.10 (issue #433) — the one outward formatting rule for the reason
// dictionaries: a reason line reads as a phrase — it starts with a capital
// letter and ends with a period. The technical nouns («пакет», «сховішча»)
// stay out of the rendered lines (the muted detail lines keep the
// diagnostics and are not governed here). Guarded over every locale of every
// source the rule covers — preview's reason map plus the download-failure
// banner, run's reasonText, place's refusalText plus the play-failure line
// and hint (issue #445); the My history line rides
// the same rule in components/ui-strings.test.tsx. G14.04.d (issue #305)
// extends the loop to uk — the capital class carries the Ukrainian І/Ї/Є/Ґ.
// Reverting any value to the old lowercase or period-less wording fails here
// (implementation-rules 1).
import test from 'node:test';
import assert from 'node:assert/strict';

import { previewStrings } from './catalog/previewController.ts';
import { runMapStrings } from './run/runMap.ts';
import { placeDetailStrings } from './place/placeDetailController.ts';

const PHRASE_RULE = /^[A-ZА-ЯЁЎІЇЄҐ].*\.$/;

test('G06.10 #433: preview reason lines read as phrases (be+en+uk)', () => {
  for (const locale of ['be', 'en', 'uk']) {
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

test('G06.10 #433: run reason lines read as phrases (be+en+uk)', () => {
  for (const locale of ['be', 'en', 'uk']) {
    for (const [code, line] of Object.entries(runMapStrings(locale).reasonText)) {
      assert.match(line, PHRASE_RULE, `${locale} ${code}: ${line}`);
    }
  }
});

test('G06.10 #433: place refusal lines read as phrases (be+en+uk)', () => {
  for (const locale of ['be', 'en', 'uk']) {
    const strings = placeDetailStrings(locale);
    for (const [code, line] of Object.entries(strings.refusalText)) {
      assert.match(line, PHRASE_RULE, `${locale} ${code}: ${line}`);
    }
    // Issue #445: the play-failure line and its hint ride the same rule
    // (judge finding on PR #444 — they had lost the periods).
    assert.match(strings.playFailed, PHRASE_RULE, `${locale} playFailed: ${strings.playFailed}`);
    assert.match(
      strings.playFailedHint,
      PHRASE_RULE,
      `${locale} playFailedHint: ${strings.playFailedHint}`,
    );
  }
});
