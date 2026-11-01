// DQ-12 (#922): the shared mockup preflight check — canon token colors per
// theme, contrast pairs, state names, existing localization keys. The seeded
// fixture carries the two violations of the acceptance criterion; every other
// rule gets an isolated single-violation case, and corrupt inputs must answer
// with diagnostics, not a crash (implementation-rules 14).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMockup, canonStateNames, formatFindings } from './mockup-preflight.mjs';
import { loadCanon } from './design-canon.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const seeded = read('test/fixtures/mockup-preflight-seeded.html');
const canon = loadCanon();
const strings = JSON.parse(read('contracts/ui-messages/source.json')).records;

const lightOnly = (body) =>
  '<html><style>section.theme[data-theme="light"] { ' + body + ' }</style></html>';

test('the seeded mockup fails with readable findings for the off-canon color and the unknown state', () => {
  const findings = checkMockup(seeded, {
    label: 'seeded mockup',
    canon,
    themes: ['light'],
    mappings: { accent: 'color.accent' },
    states: ['enabled'],
  });
  assert.equal(findings.length, 2, formatFindings(findings));
  const [color, state] = findings;
  assert.equal(color.rule, 'canon-token');
  assert.match(color.message, /--accent is #ff00ff/);
  assert.match(color.message, /canon color\.accent is #1d6b4f/);
  assert.equal(state.rule, 'state');
  assert.match(state.message, /unknown state "hover"/);
  assert.match(state.message, /allowed: /);
  // The same text the assert prints — the readable form the criterion asks for.
  assert.match(formatFindings(findings), /\[canon-token\]/);
  assert.match(formatFindings(findings), /\[state\]/);
});

test('an off-canon color is the only finding of the color-only case', () => {
  const findings = checkMockup(lightOnly('--accent: #ff00ff;'), {
    label: 'color-only',
    canon,
    themes: ['light'],
    mappings: { accent: 'color.accent' },
  });
  assert.equal(findings.length, 1, formatFindings(findings));
  assert.equal(findings[0].rule, 'canon-token');
});

test('an unknown state is the only finding of the state-only case', () => {
  const findings = checkMockup(lightOnly('--accent: #1d6b4f;') + '<button data-state="hover">', {
    label: 'state-only',
    canon,
    themes: ['light'],
    mappings: { accent: 'color.accent' },
  });
  assert.equal(findings.length, 1, formatFindings(findings));
  assert.equal(findings[0].rule, 'state');
});

test('a pair below contrast minimum is the only finding of the contrast-only case', () => {
  const findings = checkMockup(lightOnly('--fg: #f2f2f2; --bg: #ffffff;'), {
    label: 'contrast-only',
    canon,
    themes: ['light'],
    contrastPairs: [{ fg: 'fg', bg: 'bg', why: 'label' }],
  });
  assert.equal(findings.length, 1, formatFindings(findings));
  assert.equal(findings[0].rule, 'contrast');
  assert.match(findings[0].message, /1\.12:1 < 4\.5:1 \(label\)/);
});

test('an unknown localization key is the only finding of the key-only case', () => {
  const findings = checkMockup('<p data-key="native.chrome.bogus">тэкст</p>', {
    label: 'key-only',
    canon,
    themes: [],
    strings,
  });
  assert.equal(findings.length, 1, formatFindings(findings));
  assert.equal(findings[0].rule, 'localization-key');
  assert.match(findings[0].message, /"native\.chrome\.bogus" does not exist/);
});

test('canon state names are allowed without any extra list', () => {
  const findings = checkMockup(
    '<span data-state="locked"></span><span data-state="active"></span>',
    { label: 'canon-states', canon, themes: [] },
  );
  assert.deepEqual(findings, []);
  assert.ok(canonStateNames(canon).includes('locked'), 'marker names come from the canon');
  assert.ok(canonStateNames(canon).includes('active'), 'session states come from the canon');
});

test('a mockup can accept component states on top of the canon lists', () => {
  const findings = checkMockup(
    '<span data-state="enabled"></span><span data-state="dragging"></span>',
    {
      label: 'component-states',
      canon,
      themes: [],
      states: ['enabled', 'dragging'],
    },
  );
  assert.deepEqual(findings, []);
});

test('corrupt inputs produce diagnostics, not crashes', () => {
  const empty = checkMockup('   ', { label: 'empty', canon });
  assert.equal(empty.length, 1);
  assert.equal(empty[0].rule, 'html');

  const noBlock = checkMockup('<p>без блока тэмы</p>', { label: 'no-block', canon, themes: ['light'] });
  assert.equal(noBlock.length, 1);
  assert.equal(noBlock[0].rule, 'theme-block');

  const malformed = checkMockup(lightOnly('--accent: #12g45z;'), {
    label: 'malformed', canon, themes: ['light'], mappings: { accent: 'color.accent' },
  });
  assert.equal(malformed.length, 1, formatFindings(malformed));
  assert.match(malformed[0].message, /expected a #rrggbb value of canon color\.accent/);

  const missingVar = checkMockup(lightOnly('--other: #faf7f2;'), {
    label: 'missing-var', canon, themes: ['light'], mappings: { accent: 'color.accent' },
  });
  assert.equal(missingVar.length, 1, formatFindings(missingVar));
  assert.match(missingVar[0].message, /--accent is missing/);

  const unknownToken = checkMockup(lightOnly('--accent: #ff00ff;'), {
    label: 'unknown-token', canon, themes: ['light'], mappings: { accent: 'color.bogus' },
  });
  assert.equal(unknownToken.length, 1, formatFindings(unknownToken));
  assert.match(unknownToken[0].message, /color\.bogus is not a canon token/);

  const noCatalog = checkMockup('<p data-key="any.key">тэкст</p>', {
    label: 'no-catalog', canon, themes: [], strings: null,
  });
  assert.equal(noCatalog.length, 1, formatFindings(noCatalog));
  assert.match(noCatalog[0].message, /catalog is not readable/);

  const corruptRecords = checkMockup('<p data-key="any.key">тэкст</p>', {
    label: 'corrupt-records', canon, themes: [], strings: [null, {}, { id: 42 }],
  });
  assert.equal(corruptRecords.length, 1, formatFindings(corruptRecords));
  assert.equal(corruptRecords[0].rule, 'localization-key');
});

test('a check without the canon reports it instead of throwing', () => {
  const findings = checkMockup('<p>штосьці</p>', { label: 'no-canon' });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'canon');
});
