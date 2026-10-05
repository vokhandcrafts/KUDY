// G21.19 (issue #543, criterion 3) — rendered count/number examples through
// the live selectors. The golden matrix (ui-messages-render-golden) pins
// exact strings at 0/1/2/5.5/1000; this suite covers the criterion's value
// set 0/1/2/5/11/21 plus fractional input, the discreteForms boundaries of
// the time-cap selector, and the "no raw placeholder / value always present"
// invariants across every locale the generated catalogue ships. The
// canonical source has no date-typed parameters (day words are pre-formatted
// strings), so rendered date examples are out of the supported surface —
// asserted below, not assumed. Node stdlib only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadUiMessagesSource } from '../contracts/ui-messages/ui-messages.mjs';
import { UI_STRINGS } from '../components/ui-strings.generated.ts';

const here = dirname(fileURLToPath(import.meta.url));

const VALUES = [0, 1, 2, 5, 11, 21, 5.5];
const TIME_CAP_FORMS = { 60: true, 120: true, 240: true };
const TIME_CAP_WORDS = {
  be: { 60: 'Да гадзіны', 120: 'Да дзвюх гадзін', 240: 'На паўдня' },
  en: { 60: 'Up to an hour', 120: 'Up to two hours', 240: 'Half a day' },
  uk: { 60: 'До години', 120: 'До двох годин', 240: 'На пів дня' },
};
const TIME_CAP_BASE = { be: (v) => `Да ${v} хв`, en: (v) => `Up to ${v} min`, uk: (v) => `До ${v} хв` };

const SINGLE_NUMBER_IDS = ['stopsCount', 'freeStopsCount', 'heardCount', 'stopNumber', 'sizeMb', 'durationMinutes'];

test('the canonical source has no date-typed parameters (rendered dates are pre-formatted strings)', () => {
  const sourceDoc = loadUiMessagesSource(join(here, '..', 'contracts/ui-messages/source.json'));
  const dateParams = sourceDoc.records.flatMap((record) => record.parameters ?? []).filter((parameter) => parameter?.type === 'date');
  assert.deepEqual(dateParams, []);
});

for (const [locale, chrome] of Object.entries(UI_STRINGS)) {
  for (const id of SINGLE_NUMBER_IDS) {
    test(`[${locale}] ${id}: values ${VALUES.join('/')} render substituted, never blank or raw`, () => {
      const render = chrome[id];
      assert.equal(typeof render, 'function', `${id}: selector missing`);
      for (const value of VALUES) {
        const out = render(value);
        assert.equal(typeof out, 'string');
        assert.ok(out.trim().length > 0, `${id}(${value}): empty render`);
        assert.ok(!out.includes('${'), `${id}(${value}): raw placeholder left: ${out}`);
        assert.ok(out.includes(String(value)), `${id}(${value}): value missing from: ${out}`);
      }
    });
  }

  test(`[${locale}] durationRange: both bounds are substituted`, () => {
    for (const [min, max] of [[0, 1], [5, 11], [21, 60], [5.5, 21]]) {
      const out = chrome.durationRange(min, max);
      assert.ok(!out.includes('${'), `raw placeholder left: ${out}`);
      assert.ok(out.includes(String(min)) && out.includes(String(max)), `bounds missing from: ${out}`);
    }
  });

  test(`[${locale}] liveRowLine/pastRowLine: heard count and the null finished-day branch`, () => {
    for (const heard of VALUES) {
      const live = chrome.liveRowLine('Жывая', '2026-10-05', heard);
      assert.ok(live.includes(String(heard)) && !live.includes('${'), live);
      const openPast = chrome.pastRowLine('2026-10-04', '2026-10-04', heard);
      assert.ok(openPast.includes(String(heard)), openPast);
      const pendingPast = chrome.pastRowLine('2026-10-04', null, heard);
      assert.ok(pendingPast.includes('—') && pendingPast.includes(String(heard)), pendingPast);
    }
  });

  test(`[${locale}] timeCap: discrete forms switch exactly at 60/120/240, everything else interpolates`, () => {
    for (const value of [...VALUES, 59, 60, 61, 119, 120, 240, 241]) {
      const out = chrome.timeCap(value);
      if (TIME_CAP_FORMS[value]) {
        assert.equal(out, TIME_CAP_WORDS[locale][value], `form boundary ${value}`);
      } else {
        assert.equal(out, TIME_CAP_BASE[locale](value), `non-form value ${value} interpolates verbatim (fractional included)`);
      }
    }
  });
}
